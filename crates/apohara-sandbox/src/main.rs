//! `apohara-sandbox` binary — CLI entry point invoked by the TS orchestrator
//! (`src/core/sandbox.ts`) via subprocess. Reads CLI flags, runs the request,
//! prints JSON result on stdout. M014.1 returns Unavailable so the TS wrapper
//! sees a clean signal until M014.2+ lands real seccomp + namespaces.

use anyhow::Context;
use clap::Parser;
use std::path::PathBuf;
use std::time::Duration;

use apohara_sandbox::{PermissionTier, SandboxRequest, SandboxResult, SandboxRunner};

#[derive(Parser, Debug)]
#[command(
    name = "apohara-sandbox",
    version,
    about = "Syscall-sandboxed process runner for Apohara worktree agents"
)]
struct Args {
    /// Permission tier: read_only | workspace_write | danger_full_access
    #[arg(short, long, default_value = "workspace_write")]
    permission: String,

    /// Working directory inside the sandbox
    #[arg(short, long)]
    workdir: PathBuf,

    /// Optional timeout in milliseconds
    #[arg(short, long)]
    timeout_ms: Option<u64>,

    /// Optional task id for ledger correlation
    #[arg(long)]
    task_id: Option<String>,

    /// The command to run (everything after `--`)
    #[arg(trailing_var_arg = true, required = true)]
    command: Vec<String>,
}

fn main() -> anyhow::Result<()> {
    let args = Args::parse();

    let permission: PermissionTier = args
        .permission
        .parse()
        .with_context(|| format!("invalid --permission value: {}", args.permission))?;

    let req = SandboxRequest {
        command: args.command,
        workdir: args.workdir,
        permission,
        timeout: args.timeout_ms.map(Duration::from_millis),
        task_id: args.task_id,
    };

    let runner = SandboxRunner::new();
    let result = match runner.run(req) {
        Ok(r) => r,
        Err(apohara_sandbox::SandboxError::Unavailable) => SandboxResult {
            exit_code: 99,
            stdout: String::new(),
            stderr: "apohara-sandbox: not yet implemented (M014.1 scaffold)".into(),
            duration_ms: 0,
            violations: vec!["unavailable".into()],
        },
        Err(e) => return Err(anyhow::anyhow!("sandbox runner failed: {}", e)),
    };

    println!(
        "{}",
        serde_json::to_string(&result).context("failed to serialize result")?
    );
    std::process::exit(result.exit_code);
}
