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
use std::sync::{Arc, LazyLock, Mutex};

/// Process-global registry of per-binary FIFO locks (`runSerialized`).
///
/// Past incident: two concurrent `claude` children spawned from the SAME
/// process contend on the CLI's internal `~/.claude/` session locks; the second
/// blocks until our timeout SIGKILLs it (~120s hang) and may bill the wrong
/// account. The TS `cli-driver.ts::runSerialized(binary, task)` queued calls
/// FIFO per binary name to avoid this; the Rust port reinstates that invariant
/// here.
///
/// Keyed by binary BASENAME so `/usr/bin/claude` and a bare `claude` share one
/// lock (same on-disk CLI ⇒ same internal-lock contention). Each value is an
/// async `tokio::sync::Mutex` whose guard is held for the whole dispatch, so
/// two dispatches of the same binary serialize while DIFFERENT binaries (e.g.
/// `claude` vs `codex`) still run in parallel. The outer `std::sync::Mutex`
/// only guards the brief get-or-insert of the map and is never held across an
/// `.await`.
static BINARY_LOCKS: LazyLock<Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>> =
    LazyLock::new(Default::default);

/// Reduce a provider id / path to the key used in [`BINARY_LOCKS`]: its file
/// name (`/usr/bin/claude` → `claude`), falling back to the whole string when
/// there is no file-name component (so it is never silently dropped).
fn binary_key(provider_id: &str) -> String {
    Path::new(provider_id)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(provider_id)
        .to_string()
}

/// Get-or-insert the per-binary FIFO lock for `provider_id`, keyed by basename.
/// Cloning the `Arc` lets the caller hold the async guard across the dispatch
/// without keeping the registry `Mutex` locked. `pub(crate)` so the driver
/// tests can prove the per-binary keying (same basename ⇒ same `Arc`).
pub(crate) fn binary_lock(provider_id: &str) -> Arc<tokio::sync::Mutex<()>> {
    let key = binary_key(provider_id);
    let mut map = BINARY_LOCKS
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    Arc::clone(map.entry(key).or_default())
}

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

/// Correlation identifiers the agent-hooks scripts need to build their event
/// envelope. Exported on the spawned CLI's env as `APOHARA_PANE_KEY` /
/// `APOHARA_TASK_ID` / `APOHARA_WORKTREE_ID`. The event `type` is NOT exported
/// here — the same hook script handles every event, so it derives the type
/// from the `hook_event_name` field on the CLI's stdin payload per-invocation.
/// All are `APOHARA_*`, so the §0.4 allowlist below already permits them — no
/// host secret leaks.
///
/// `pane_key` is required for correlation; the other two are optional and
/// simply omitted from the env when `None`.
#[derive(Debug, Clone, Default)]
pub struct HookContext {
    pub pane_key: String,
    pub task_id: Option<String>,
    pub worktree_id: Option<String>,
    /// US-S4 — the mesh-workflow phase of this blade's node (`plan`/`exec`/
    /// `review`), exported as `APOHARA_PHASE` so the F2.0c CLI claim-guard can
    /// deny PLAN-phase mutations (read-only). `None` for non-mesh/bake-off
    /// spawns → the guard adds no new denial.
    pub phase: Option<String>,
}

/// Build the env handed to a spawned CLI subprocess.
///
/// Composition order is load-bearing:
///   1. `sanitize_env` removes secrets from the parent process env.
///   2. `overlay_worktree_env` adds the workspace-local `.env`.
///   3. `APOHARA_DRIVEN` + `APOHARA_RUNNER_POLICY` + `APOHARA_WORKTREE_PATH` +
///      the `APOHARA_PANE_KEY` / `APOHARA_TASK_ID` / `APOHARA_WORKTREE_ID`
///      hook-correlation markers win LAST — a malicious worktree `.env` cannot
///      spoof orchestrator identity.
///   4. `CLAUDE_CONFIG_DIR` (per-blade isolation) is injected absolutely last,
///      after sanitization, because it is deliberately NOT in `ENV_ALLOWLIST`
///      (see `config_isolation` below).
pub fn build_spawn_env(
    parent: &HashMap<String, String>,
    workspace: &str,
    runner_policy: &str,
    hooks: Option<&HookContext>,
    config_isolation: Option<&str>,
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
    // Hook correlation identifiers. The hook scripts read these to build the
    // envelope they POST to the loopback server; without `APOHARA_PANE_KEY`
    // the server can't correlate the event to a pane, so we always export it.
    if let Some(h) = hooks {
        env.insert("APOHARA_PANE_KEY".to_string(), h.pane_key.clone());
        if let Some(task_id) = &h.task_id {
            env.insert("APOHARA_TASK_ID".to_string(), task_id.clone());
        }
        if let Some(worktree_id) = &h.worktree_id {
            env.insert("APOHARA_WORKTREE_ID".to_string(), worktree_id.clone());
        }
        // US-S4 — the blade's mesh phase, read by the F2.0c CLI claim-guard to
        // deny PLAN-phase mutations. `APOHARA_*` so the §0.4 allowlist permits
        // it; the blade cannot mutate its own already-spawned process env.
        if let Some(phase) = &h.phase {
            env.insert("APOHARA_PHASE".to_string(), phase.clone());
        }
    }
    // Per-blade isolation, injected LAST and intentionally outside the
    // allowlist:
    //
    // why CLAUDE_CONFIG_DIR (and NOT HOME): the `claude` CLI keeps per-process
    // state — auth tokens, session/history files, internal file locks — under a
    // config dir. Two blades sharing that dir contend on those locks (the 120s
    // SIGKILL hang) and, worse, can route to the wrong logged-in account.
    // Pointing each blade at its own CLAUDE_CONFIG_DIR isolates that state
    // WITHOUT touching HOME. Overriding HOME is the auth/billing danger zone:
    // a wrong HOME makes the CLI re-resolve credentials from a foreign tree and
    // bill someone else's plan (the published "wrong-account-billed" incident).
    // So we isolate the config dir only and leave the sanitized HOME intact.
    //
    // It is NOT in `ENV_ALLOWLIST` on purpose — the allowlist sanitizes the
    // *parent* env (fail-closed), but this value is orchestrator-minted, not
    // inherited, so we inject it here after sanitization rather than widening
    // the inherited surface.
    if let Some(dir) = config_isolation {
        env.insert("CLAUDE_CONFIG_DIR".to_string(), dir.to_string());
    }
    env
}

/// Which provider CLI a [`DispatchRequest`] targets — the canonical roster id
/// resolved to a closed enum so the command-builder can pick the right headless
/// dialect (US-S1). Resolved from `ActiveProvider.id` at the call-site, NOT from
/// the binary basename (symlinks / wrappers / `paru`-shims make basename
/// inference fragile — the roster id is the authoritative source).
///
/// Defined HERE in `apohara-dispatch`, deliberately NOT reusing
/// `apohara_mcp::ProviderId`: the dep-graph is `apohara-mcp → apohara-dispatch`
/// (never the reverse), so importing the mcp enum would create a cycle.
/// Duplicating the three canonical ids is the necessary cost of staying acyclic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ProviderKind {
    Claude,
    Codex,
    Opencode,
}

impl ProviderKind {
    /// Map a roster id (`ActiveProvider.id`) to its kind. `None` for an
    /// unknown/legacy id → the dispatch falls back to the legacy argv `--print`
    /// path (backward-compatible).
    pub fn from_roster_id(id: &str) -> Option<Self> {
        match id {
            "claude-code-cli" => Some(Self::Claude),
            "codex-cli" => Some(Self::Codex),
            "opencode-go" => Some(Self::Opencode),
            _ => None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct DispatchRequest {
    pub provider_id: String,
    pub workspace: String,
    pub prompt: String,
    pub role: String,
    pub runner_policy: String,
    /// Pane key for agent-hooks correlation. Exported to the spawned CLI as
    /// `APOHARA_PANE_KEY` so its hook scripts can tag events back to this run.
    /// Defaults to empty when the caller has no pane context (e.g. headless
    /// dispatch); the hook scripts still POST, just with an empty pane.
    #[serde(default)]
    pub pane_key: String,
    /// Optional task / worktree identifiers, also exported for hook
    /// correlation when present.
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub worktree_id: Option<String>,
    /// Per-blade isolated `CLAUDE_CONFIG_DIR` path. When `Some`, it is injected
    /// onto the spawned CLI's env LAST (post-sanitization) so each blade keeps
    /// its own claude state (auth/session/locks) without entering the HOME
    /// auth/billing zone. `None` for headless/legacy callers that share the
    /// host's default config dir. Additive + `serde(default)` → existing wire
    /// payloads deserialize unchanged.
    #[serde(default)]
    pub config_isolation: Option<String>,
    /// US-S4 — the mesh phase of this blade's node (`plan`/`exec`/`review`),
    /// exported as `APOHARA_PHASE` for the CLI claim-guard's PLAN-read-only gate.
    /// `None` for non-mesh/bake-off dispatch. Additive + `serde(default)`.
    #[serde(default)]
    pub phase: Option<String>,
    /// US-S1 — which provider CLI this targets, resolved from the roster id at
    /// the call-site (NOT the binary basename). Drives the per-provider headless
    /// dialect in the command-builder (US-S2/S3). `None` → the legacy argv
    /// `--print` path (backward-compatible). Additive + `serde(default)` → existing
    /// wire payloads deserialize unchanged.
    #[serde(default)]
    pub provider_kind: Option<ProviderKind>,
}

impl DispatchRequest {
    /// The hook-correlation context derived from this request, or `None` when
    /// no pane/task/worktree identifiers were supplied (nothing to export).
    fn hook_context(&self) -> Option<HookContext> {
        if self.pane_key.is_empty() && self.task_id.is_none() && self.worktree_id.is_none() {
            return None;
        }
        Some(HookContext {
            pane_key: self.pane_key.clone(),
            task_id: self.task_id.clone(),
            worktree_id: self.worktree_id.clone(),
            phase: self.phase.clone(),
        })
    }
}

/// US-S2 — the fully-resolved spawn command for one provider: a `program`, its
/// `args`, and an optional `stdin` payload. The executor (US-S3) only RUNS this;
/// every per-provider headless dialect lives in [`build_command_spec`], so the
/// dialect is asserted by bytes in unit tests without any real CLI on the box.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub program: String,
    pub args: Vec<String>,
    /// Payload written to the child's stdin and then closed — the headless
    /// dialect for claude (stream-json envelope) and codex (`exec … -`). `None`
    /// when the prompt rides argv instead (legacy `--print`, opencode `run`).
    pub stdin: Option<String>,
}

/// US-S2 — build the headless-with-write command for `kind`. PURE: no env, no
/// spawn, no I/O — the per-provider dialect is fully determined by `kind` + the
/// request fields, so it is unit-testable by byte-assertion without a real CLI.
///
/// `None` reproduces the legacy argv `--print` path BYTE-FOR-BYTE — it is both
/// the backward-compat case and the `APOHARA_DIALECT_LEGACY` rollback target
/// (US-S3), so the bake-off's existing behaviour is preserved exactly.
///
/// Dialects verified against `upstream-source` + `upstream-source`
/// (versions: claude 2.1.159 / codex-cli 0.57.0 / opencode 1.15.13):
///
/// ```text
/// claude:   -p --output-format stream-json --input-format stream-json --verbose
///           --permission-mode bypassPermissions --disallowedTools AskUserQuestion
///           prompt via stdin envelope. --disallowedTools AskUserQuestion avoids
///           the headless hang where the model asks an unanswerable question.
/// codex:    exec --skip-git-repo-check --sandbox workspace-write -
///           prompt via stdin. ALWAYS exec (bare codex opens a TUI that hangs
///           with no TTY); NEVER --full-auto (deprecated).
/// opencode: run --format json --dangerously-skip-permissions --dir <ws> <prompt>
///           prompt as the trailing positional arg.
/// ```
///
/// SECURITY (US-S4/M6): the claude stdin envelope is built ONLY from
/// `req.prompt` and the literal `"user"` role — NO environment value is ever
/// interpolated, so a secret stripped by `build_spawn_env` cannot re-enter the
/// child via stdin.
pub fn build_command_spec(kind: Option<ProviderKind>, req: &DispatchRequest) -> CommandSpec {
    fn argv(parts: &[&str]) -> Vec<String> {
        parts.iter().map(|s| s.to_string()).collect()
    }
    let program = req.provider_id.clone();
    match kind {
        // Legacy / rollback / unknown id → byte-identical to the pre-S2 spawn.
        None => CommandSpec {
            program,
            args: vec!["--print".to_string(), req.prompt.clone()],
            stdin: None,
        },
        Some(ProviderKind::Claude) => {
            // Built with serde_json so a prompt containing quotes/newlines/
            // unicode is escaped correctly. Only prompt + the literal role go in.
            let envelope = serde_json::json!({
                "type": "user",
                "message": {
                    "role": "user",
                    "content": [{ "type": "text", "text": req.prompt }],
                },
            })
            .to_string();
            CommandSpec {
                program,
                args: argv(&[
                    "-p",
                    "--output-format",
                    "stream-json",
                    "--input-format",
                    "stream-json",
                    "--verbose",
                    "--permission-mode",
                    "bypassPermissions",
                    "--disallowedTools",
                    "AskUserQuestion",
                ]),
                stdin: Some(format!("{envelope}\n")),
            }
        }
        Some(ProviderKind::Codex) => CommandSpec {
            program,
            args: argv(&[
                "exec",
                "--skip-git-repo-check",
                "--sandbox",
                "workspace-write",
                "-",
            ]),
            stdin: Some(req.prompt.clone()),
        },
        Some(ProviderKind::Opencode) => {
            let mut args = argv(&[
                "run",
                "--format",
                "json",
                "--dangerously-skip-permissions",
                "--dir",
            ]);
            args.push(req.workspace.clone());
            // Prompt is the trailing POSITIONAL arg (opencode reads it from argv,
            // not stdin). Kept last so it is unambiguously the message.
            args.push(req.prompt.clone());
            CommandSpec {
                program,
                args,
                stdin: None,
            }
        }
    }
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
        let hooks = req.hook_context();
        let env = build_spawn_env(
            &parent_env,
            &req.workspace,
            &req.runner_policy,
            hooks.as_ref(),
            req.config_isolation.as_deref(),
        );

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
        let hooks = req.hook_context();
        let env = build_spawn_env(
            &parent_env,
            &req.workspace,
            &req.runner_policy,
            hooks.as_ref(),
            req.config_isolation.as_deref(),
        );

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

    /// Like [`CliDriver::dispatch_streaming`], but serialized per binary
    /// (`runSerialized`): two dispatches of the SAME binary basename can never
    /// run concurrently; DIFFERENT binaries still run in parallel.
    ///
    /// This is the DEFAULT invariant for any live dispatch — serialization is
    /// not opt-in. Past incident: two concurrent `claude` children from the
    /// same process contend on the CLI's internal `~/.claude/` session locks;
    /// the second blocks until the 120s timeout SIGKILLs it (and can route to
    /// the wrong account). Acquiring the per-binary [`binary_lock`] guard and
    /// holding it for the whole inner dispatch closes that race deterministically
    /// — the second same-binary caller queues FIFO behind the first instead of
    /// racing it. Relaxing this (per-binary parallelism) would require a future
    /// green non-contention proof, so there is intentionally no skip path.
    pub async fn dispatch_streaming_serialized(
        req: DispatchRequest,
        on_line: impl FnMut(String) + Send + 'static,
    ) -> Result<DispatchOutcome> {
        let lock = binary_lock(&req.provider_id);
        // Hold the guard for the ENTIRE dispatch: the FIFO ordering and mutual
        // exclusion only hold while the guard is alive, so it must outlive the
        // spawned child, not just the spawn call.
        let _guard = lock.lock().await;
        Self::dispatch_streaming(req, on_line).await
    }
}
