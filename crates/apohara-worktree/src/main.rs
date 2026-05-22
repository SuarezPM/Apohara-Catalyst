use clap::{Parser, Subcommand};
use serde::Serialize;
use std::process::Command;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Creates a new git worktree
    Create {
        /// Path to the new worktree
        path: String,
        /// Branch name for the worktree
        branch: String,
    },
    /// Destroys an existing git worktree
    Destroy {
        /// Path to the worktree to remove
        path: String,
    },
}

#[derive(Serialize)]
struct Output {
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

fn print_success(message: &str) {
    let output = Output {
        status: "success".to_string(),
        message: Some(message.to_string()),
        error: None,
    };
    println!("{}", serde_json::to_string(&output).unwrap());
}

fn print_error(error: &str) {
    let output = Output {
        status: "error".to_string(),
        message: None,
        error: Some(error.to_string()),
    };
    println!("{}", serde_json::to_string(&output).unwrap());
    std::process::exit(1);
}

fn run_git_command(args: &[&str]) -> Result<(), String> {
    let output = Command::new("git")
        .args(args)
        .output()
        .map_err(|e| format!("Failed to execute git: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Git command failed: {}", stderr.trim()));
    }

    Ok(())
}

fn main() {
    let cli = Cli::parse();

    match &cli.command {
        Commands::Create { path, branch } => {
            // Use git worktree add -b <branch> <path>
            match run_git_command(&["worktree", "add", "-b", branch, path]) {
                Ok(_) => print_success(&format!("Worktree created at {}", path)),
                Err(e) => print_error(&e),
            }
        }
        Commands::Destroy { path } => {
            // First remove the worktree
            match run_git_command(&["worktree", "remove", "--force", path]) {
                Ok(_) => print_success(&format!("Worktree at {} destroyed", path)),
                Err(e) => print_error(&e),
            }
        }
    }
}
