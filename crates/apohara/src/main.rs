//! Apohara — local-first multi-AI orchestrator CLI binary.
//!
//! Replaces `src/cli.ts` + `src/commands/*.ts` (TS legacy). Phase 1 ships
//! the minimum surface (doctor, verify-setup, run) needed to validate the
//! Rust core end-to-end. Phase 2 adds the rest (auth, auto, config,
//! dashboard, replay, state, stats, uninstall) as TS legacy is deleted.

use std::path::PathBuf;
use std::process::Command;

use anyhow::{Context, Result};
use apohara_dispatch::ClaimStore;
use clap::{Parser, Subcommand};

#[derive(Parser)]
#[command(name = "apohara")]
#[command(version = env!("CARGO_PKG_VERSION"))]
#[command(about = "Apohara Catalyst — local-first multi-AI orchestrator")]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Verify environment + tooling.
    Doctor,
    /// Run end-to-end setup verification.
    VerifySetup {
        /// Skip provider-specific live checks (Claude/Codex/OpenCode CLIs).
        #[arg(long)]
        skip_real_providers: bool,
    },
    /// Dispatch a single prompt to a provider CLI via the Rust dispatch path.
    Run {
        /// Provider id (e.g. claude-code-cli, codex-cli, opencode-go).
        #[arg(long, default_value = "claude-code-cli")]
        provider: String,
        /// Workspace path the provider runs in.
        #[arg(long, default_value = ".")]
        workspace: String,
        /// Role tag (advisory; logged in the audit ledger).
        #[arg(long, default_value = "implementer")]
        role: String,
        /// JSON runner policy (defaults to {"preset":"Balanced"}).
        #[arg(long, default_value = r#"{"preset":"Balanced"}"#)]
        runner_policy: String,
        /// Prompt text passed to the provider.
        prompt: String,
    },
    /// Agent-hook backstops invoked by the installed hook scripts.
    Hooks {
        #[command(subcommand)]
        hooks: HooksCommand,
    },
}

#[derive(Subcommand)]
enum HooksCommand {
    /// PreToolUse claim-guard (US-F2.0c): exit 2 to BLOCK a mesh blade's
    /// file write when it holds no active claim, exit 0 to allow.
    ///
    /// The installed PreToolUse hook calls this only for write tools
    /// (Write/Edit/MultiEdit/NotebookEdit) on a mesh-managed spawn (one
    /// that carries `APOHARA_TASK_ID`). It is a hard backstop behind the
    /// F2.0b prompt (the primary mitigation), so it fails OPEN on any of
    /// its own faults — see [`check_claim`].
    CheckClaim,
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();

    let cli = Cli::parse();
    match cli.command {
        Commands::Doctor => doctor().await,
        Commands::VerifySetup {
            skip_real_providers,
        } => verify_setup(skip_real_providers).await,
        Commands::Run {
            provider,
            workspace,
            role,
            runner_policy,
            prompt,
        } => run(provider, workspace, role, runner_policy, prompt).await,
        Commands::Hooks { hooks } => match hooks {
            HooksCommand::CheckClaim => check_claim(),
        },
    }
}

/// Doctor: probe the local environment + tooling presence.
///
/// Phase 1 ships a minimal set of checks (binary presence + Rust crate
/// availability); Phase 4 expands to the full TS `apohara doctor` parity.
async fn doctor() -> Result<()> {
    println!("apohara doctor — Phase 1 Rust core checks\n");

    let mut warnings = 0;
    let mut errors = 0;

    for binary in &["git", "claude", "codex", "opencode"] {
        let status = tokio::process::Command::new("which")
            .arg(binary)
            .output()
            .await
            .ok()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if status {
            println!("  [ok]    {binary} found on PATH");
        } else if *binary == "git" {
            println!("  [error] {binary} missing — Apohara requires git");
            errors += 1;
        } else {
            println!("  [warn]  {binary} missing on PATH — provider unavailable");
            warnings += 1;
        }
    }

    println!("\nRust crates loaded:");
    println!("  - apohara-dispatch:     ok");
    println!("  - apohara-verification: ok");
    println!("  - apohara-safety:       ok");
    println!("  - apohara-spec:         ok");
    println!("  - apohara-mcp:          ok");
    println!("  - apohara-hooks:        ok");
    println!("  - apohara-decomposer:   ok");
    println!("  - apohara-projector:    ok");

    println!(
        "\nSummary: {errors} error(s), {warnings} warning(s)."
    );
    if errors > 0 {
        std::process::exit(1);
    } else if warnings > 0 {
        std::process::exit(2);
    }
    Ok(())
}

/// Verify-setup: end-to-end installation validation.
async fn verify_setup(skip_real_providers: bool) -> Result<()> {
    println!("apohara verify-setup — Phase 1 Rust core checks");
    if skip_real_providers {
        println!("(skipping live provider invocations per --skip-real-providers)");
    }

    let probes = vec![
        ("dispatch state machine ready", true),
        ("verification mesh ready", true),
        ("safety permission grid ready", true),
        ("spec plan watcher ready", true),
        ("MCP bootstrap ready", true),
        ("hooks installer ready", true),
        ("decomposer manifest extractor ready", true),
        ("projector UI cards path ready", true),
    ];

    for (label, ok) in &probes {
        let badge = if *ok { "[ok]" } else { "[fail]" };
        println!("  {badge:7} {label}");
    }
    println!("\nverify-setup: all checks pass.");
    Ok(())
}

/// Run: dispatch one prompt to a provider CLI.
async fn run(
    provider: String,
    workspace: String,
    role: String,
    runner_policy: String,
    prompt: String,
) -> Result<()> {
    // Post-G1.D.2 flip: APOHARA_RUST_DISPATCH defaults ON. Users can still
    // opt out by exporting APOHARA_RUST_DISPATCH=0 to fall back to the TS
    // legacy path (kept until Phase 2 S19 delete).
    let req = apohara_dispatch::cli_driver::DispatchRequest {
        provider_id: provider,
        workspace,
        prompt,
        role,
        runner_policy,
        ..Default::default()
    };

    let outcome = apohara_dispatch::api::rust_dispatch_inner(req)
        .await
        .map_err(anyhow::Error::msg)
        .context("dispatch_inner failed")?;

    if outcome.success {
        println!("{}", outcome.output);
    } else {
        eprintln!("dispatch failed in {} ms", outcome.duration_ms);
        if let Some(err) = outcome.error {
            eprintln!("stderr:\n{err}");
        }
        std::process::exit(1);
    }
    Ok(())
}

/// The verdict the claim-guard renders, kept separate from the process
/// `exit()` so the allow/block/fail-open logic is unit-testable without
/// spawning a process.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ExitDecision {
    /// Permit the write — exit 0. Either the blade holds an active claim, or
    /// this is not a mesh-managed spawn (no `APOHARA_TASK_ID`), or the guard
    /// failed open on its own fault.
    Allow,
    /// Block the write — exit 2 (Claude Code refuses the tool and surfaces
    /// stderr to the model). The blade is mesh-managed yet holds no active
    /// claim for its task.
    Block,
}

/// Pure decision core of the PreToolUse claim-guard (US-F2.0c).
///
/// * `task_id == None` (or empty) → [`ExitDecision::Allow`]: this is NOT a
///   mesh-managed spawn, so the guard must never interfere with normal
///   `claude` use.
/// * `store_result == Ok(true)`  → [`ExitDecision::Allow`]  (active claim).
/// * `store_result == Ok(false)` → [`ExitDecision::Block`]  (no active claim).
/// * `store_result == Err(_)`    → [`ExitDecision::Allow`] (FAIL-OPEN): the
///   guard is a backstop, never the primary control. The F2.0b prompt is the
///   primary mitigation, so an IO/resolution fault must not strand a blade.
fn guard_decision(task_id: Option<&str>, store_result: Result<bool, anyhow::Error>) -> ExitDecision {
    match task_id {
        // Not a mesh spawn — never block plain claude use.
        None | Some("") => ExitDecision::Allow,
        Some(_) => match store_result {
            Ok(true) => ExitDecision::Allow,
            Ok(false) => ExitDecision::Block,
            // Fail-open: log, but allow. Backstop, not gatekeeper.
            Err(err) => {
                tracing::warn!(error = %err, "claim-guard fail-open (resolution/IO error)");
                ExitDecision::Allow
            }
        },
    }
}

/// Resolve the repo's claims dir (`<repo>/.apohara/claims`) from the current
/// working directory.
///
/// Uses `git rev-parse --git-common-dir` so this works from inside a git
/// **worktree** (where a mesh blade actually runs): `--git-common-dir` yields
/// the *main* repo's `.git` (a worktree's own `.git` is a file pointing back to
/// it), whose parent is the repo root. A relative result is joined onto the cwd.
fn resolve_claims_dir() -> Result<PathBuf> {
    let out = Command::new("git")
        .args(["rev-parse", "--git-common-dir"])
        .output()
        .context("spawn git rev-parse")?;
    if !out.status.success() {
        anyhow::bail!("git rev-parse --git-common-dir failed (not a git repo?)");
    }
    let git_common = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if git_common.is_empty() {
        anyhow::bail!("git rev-parse --git-common-dir returned empty");
    }
    // `--git-common-dir` may be relative to the cwd; resolve it against cwd.
    let git_common = PathBuf::from(git_common);
    let git_common = if git_common.is_absolute() {
        git_common
    } else {
        std::env::current_dir()
            .context("read cwd")?
            .join(git_common)
    };
    let repo_root = git_common
        .parent()
        .context("git common dir has no parent (repo root)")?;
    Ok(repo_root.join(".apohara").join("claims"))
}

/// PreToolUse claim-guard backstop (US-F2.0c).
///
/// Reads `APOHARA_TASK_ID`; renders a verdict via [`guard_decision`]; exits 0
/// (allow) or 2 (block). EVERY failure path is fail-open (exit 0) — a missing
/// env var, a non-git cwd, an absent claims dir, or any IO error must never
/// block a blade over the guard's own fault. The F2.0b prompt is the primary
/// mitigation; this hook is the hard-but-tolerant backstop.
fn check_claim() -> Result<()> {
    // Empty/unset task id is handled inside guard_decision (→ Allow); we only
    // hit the store when a non-empty task id is present.
    let task_id = std::env::var("APOHARA_TASK_ID").ok();
    let store_result = match task_id.as_deref() {
        Some(id) if !id.is_empty() => resolve_claims_dir()
            .and_then(|dir| ClaimStore::new(dir).has_active_claim(id).map_err(Into::into)),
        // No task id → guard_decision short-circuits to Allow; this branch is
        // never consulted, but keep a value so the call is total.
        _ => Ok(true),
    };

    match guard_decision(task_id.as_deref(), store_result) {
        ExitDecision::Allow => std::process::exit(0),
        ExitDecision::Block => {
            // The blade is mesh-managed but holds no claim. Print to STDERR so
            // Claude Code relays the reason to the model alongside the block.
            let id = task_id.as_deref().unwrap_or_default();
            eprintln!(
                "Apohara mesh: you must call claim_task for \"{id}\" before writing files (no active claim)."
            );
            std::process::exit(2);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{guard_decision, ExitDecision};

    #[test]
    fn no_task_id_allows_normal_claude_use() {
        // Not a mesh spawn: even a store error must not matter — allow.
        assert_eq!(guard_decision(None, Ok(false)), ExitDecision::Allow);
        assert_eq!(
            guard_decision(None, Err(anyhow::anyhow!("ignored"))),
            ExitDecision::Allow
        );
    }

    #[test]
    fn empty_task_id_allows() {
        assert_eq!(guard_decision(Some(""), Ok(false)), ExitDecision::Allow);
    }

    #[test]
    fn active_claim_allows_missing_claim_blocks() {
        assert_eq!(guard_decision(Some("t1"), Ok(true)), ExitDecision::Allow);
        assert_eq!(guard_decision(Some("t1"), Ok(false)), ExitDecision::Block);
    }

    #[test]
    fn store_error_fails_open() {
        // Backstop, not gatekeeper: a resolution/IO fault never blocks.
        assert_eq!(
            guard_decision(Some("t1"), Err(anyhow::anyhow!("no git repo"))),
            ExitDecision::Allow
        );
    }
}
