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
}
