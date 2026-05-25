//! CLI subprocess driver.
//!
//! Ported from `src/providers/cli-driver.ts` (TS legacy). The TS module also
//! owns built-in driver configs, per-binary serialization, ANSI stripping, and
//! NDJSON parsing for opencode — those land in later G1.A tasks. This file
//! covers the security-critical env composition path only.
//!
//! Past incident: pre-`33d6901` `src/providers/cli-driver.ts` did
//! `env: { ...process.env }` on every spawn, leaking ANTHROPIC_API_KEY,
//! OPENAI_API_KEY, AWS/GCP/Azure creds, GITHUB_TOKEN, etc. into every wrapped
//! CLI. Mitigation: sanitize-then-overlay pattern (§0.4 envSanitizer +
//! Sprint 5 G5.C.4 composeWorktreeEnv). APOHARA_* forced markers are applied
//! LAST so a malicious worktree `.env` cannot spoof identity.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

/// Allowlist for parent process env vars. Anything else is stripped.
///
/// Mirrors the safe set used by `src/core/persistence/envSanitizer.ts` — the
/// TS sanitizer is a blocklist over a much larger surface, but the Rust port
/// inverts to an allowlist for safety: anything we did not explicitly approve
/// is dropped (fails closed).
const ENV_ALLOWLIST: &[&str] = &["PATH", "HOME", "USER", "LANG", "TERM", "TMPDIR"];

/// Apply §0.4 sanitization: strip secrets from the parent process env.
///
/// Returns only allowlisted keys plus the agent-hooks bridge (`APOHARA_HOOK_*`)
/// vars that the orchestrator may pre-populate to wire hook callbacks.
fn sanitize_env(parent: &HashMap<String, String>) -> HashMap<String, String> {
    parent
        .iter()
        .filter(|(k, _)| ENV_ALLOWLIST.contains(&k.as_str()) || k.starts_with("APOHARA_HOOK_"))
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect()
}

/// Read the worktree-local `.env` (if present) and overlay onto the
/// sanitized base.
///
/// Mirrors `composeWorktreeEnv` (TS, `src/core/worktree/env-isolation.ts`).
/// Worktree `.env` may carry project-local toggles (`MY_PROJECT_*`) and
/// dispatcher knobs (`APOHARA_LOG_*`) — but NEVER credentials. The allowlist
/// here intentionally rejects anything outside those prefixes so a malicious
/// `.env` cannot smuggle `ANTHROPIC_API_KEY` past us.
fn overlay_worktree_env(
    base: HashMap<String, String>,
    workspace: &Path,
) -> HashMap<String, String> {
    let env_path = workspace.join(".env");
    if !env_path.exists() {
        return base;
    }
    let content = std::fs::read_to_string(&env_path).unwrap_or_default();
    let mut merged = base;
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        if let Some((k, v)) = line.split_once('=') {
            let k = k.trim();
            if ENV_ALLOWLIST.contains(&k)
                || k.starts_with("MY_PROJECT_")
                || k.starts_with("APOHARA_LOG_")
            {
                merged.insert(k.to_string(), v.trim().to_string());
            }
        }
    }
    merged
}

/// Build the env handed to a spawned CLI subprocess.
///
/// Composition order is load-bearing:
///   1. `sanitize_env` removes secrets from the parent process env.
///   2. `overlay_worktree_env` adds the workspace-local `.env`.
///   3. `APOHARA_DRIVEN` + `APOHARA_RUNNER_POLICY` + `APOHARA_WORKTREE_PATH`
///      forced markers win LAST — a malicious worktree `.env` cannot spoof
///      orchestrator identity.
pub fn build_spawn_env(
    parent: &HashMap<String, String>,
    workspace: &str,
    runner_policy: &str,
) -> HashMap<String, String> {
    let sanitized = sanitize_env(parent);
    let mut env = overlay_worktree_env(sanitized, Path::new(workspace));
    env.insert("APOHARA_DRIVEN".to_string(), "1".to_string());
    env.insert(
        "APOHARA_RUNNER_POLICY".to_string(),
        runner_policy.to_string(),
    );
    env.insert(
        "APOHARA_WORKTREE_PATH".to_string(),
        workspace.to_string(),
    );
    env
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchRequest {
    pub provider_id: String,
    pub workspace: String,
    pub prompt: String,
    pub role: String,
    pub runner_policy: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchOutcome {
    pub success: bool,
    pub output: String,
    pub error: Option<String>,
    pub duration_ms: u64,
}

pub struct CliDriver;

impl CliDriver {
    /// Spawn a provider CLI with a sanitized env and capture its stdout.
    ///
    /// The TS analogue (`callCliDriver` in cli-driver.ts) also handles
    /// per-binary serialization (`runSerialized`) and ANSI stripping; those
    /// ride later G1.A tasks. This minimum-viable port establishes the spawn
    /// surface so reconciler / executor can wire to it.
    pub async fn dispatch(req: DispatchRequest) -> Result<DispatchOutcome> {
        let parent_env: HashMap<String, String> = std::env::vars().collect();
        let env = build_spawn_env(&parent_env, &req.workspace, &req.runner_policy);

        let start = std::time::Instant::now();
        let mut cmd = tokio::process::Command::new(&req.provider_id);
        cmd.env_clear();
        cmd.envs(&env);
        cmd.arg("--print").arg(&req.prompt);
        cmd.current_dir(&req.workspace);

        let output = cmd.output().await.context("spawn provider CLI")?;
        let duration_ms = start.elapsed().as_millis() as u64;

        Ok(DispatchOutcome {
            success: output.status.success(),
            output: String::from_utf8_lossy(&output.stdout).into_owned(),
            error: if output.status.success() {
                None
            } else {
                Some(String::from_utf8_lossy(&output.stderr).into_owned())
            },
            duration_ms,
        })
    }

    /// Like [`CliDriver::dispatch`], but streams stdout to `on_line` line-by-line
    /// as the CLI runs, while still returning the full captured output.
    ///
    /// R2 backpressure: lines flow through a bounded `mpsc::channel(1024)`. A
    /// dedicated reader task drains the child's stdout as fast as the OS
    /// delivers it — so the pipe never fills and deadlocks the child — and
    /// `try_send`s each line. If the consumer can't keep up and the channel is
    /// full, the line is dropped with a `tracing::warn!` instead of blocking the
    /// CLI; this bounds memory and keeps the subprocess live. (mpsc only lets the
    /// sender drop the line in hand, not evict the oldest queued line; the R2
    /// goal — never block the producer — holds either way.)
    pub async fn dispatch_streaming(
        req: DispatchRequest,
        mut on_line: impl FnMut(String) + Send + 'static,
    ) -> Result<DispatchOutcome> {
        use std::process::Stdio;
        use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};
        use tokio::sync::mpsc::{self, error::TrySendError};

        let parent_env: HashMap<String, String> = std::env::vars().collect();
        let env = build_spawn_env(&parent_env, &req.workspace, &req.runner_policy);

        let start = std::time::Instant::now();
        let mut cmd = tokio::process::Command::new(&req.provider_id);
        cmd.env_clear();
        cmd.envs(&env);
        cmd.arg("--print").arg(&req.prompt);
        cmd.current_dir(&req.workspace);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn().context("spawn provider CLI")?;
        let stdout = child.stdout.take().context("capture child stdout")?;
        let stderr = child.stderr.take().context("capture child stderr")?;

        let (tx, mut rx) = mpsc::channel::<String>(1024);

        // Reader: drain stdout line-by-line into the bounded channel and keep a
        // full copy for the outcome.
        let stdout_reader = tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            let mut full = String::new();
            while let Ok(Some(line)) = lines.next_line().await {
                full.push_str(&line);
                full.push('\n');
                match tx.try_send(line) {
                    Ok(()) => {}
                    Err(TrySendError::Full(_)) => {
                        tracing::warn!(
                            "dispatch_streaming: on_line channel full (1024); dropping line"
                        );
                    }
                    Err(TrySendError::Closed(_)) => break,
                }
            }
            full
        });

        // Drain stderr concurrently so a chatty stderr can't fill its pipe and
        // deadlock the child.
        let stderr_reader = tokio::spawn(async move {
            let mut buf = String::new();
            let _ = BufReader::new(stderr).read_to_string(&mut buf).await;
            buf
        });

        // Forward streamed lines to the caller as they arrive.
        while let Some(line) = rx.recv().await {
            on_line(line);
        }

        let full_output = stdout_reader.await.context("stdout reader task")?;
        let err_output = stderr_reader.await.context("stderr reader task")?;
        let status = child.wait().await.context("await provider CLI exit")?;
        let duration_ms = start.elapsed().as_millis() as u64;

        Ok(DispatchOutcome {
            success: status.success(),
            output: full_output,
            error: if status.success() {
                None
            } else {
                Some(err_output)
            },
            duration_ms,
        })
    }
}
