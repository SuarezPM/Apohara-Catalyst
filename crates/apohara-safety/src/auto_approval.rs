//! Auto-approval heuristic for dynamic tool calls — ports
//! `src/core/safety/auto-approval.ts` (symphony #9, G5.G.6).
//!
//! Default-deny: only return `Allow` when we positively confirm a call
//! is in the safe subset. Everything else returns `Prompt`. There is no
//! "probably ok" heuristic — false positives are too expensive (data
//! loss / network egress with secrets).

use crate::bash_compound::split_compound;
use crate::patterns::ToolInvocation;
use std::collections::HashSet;
use std::sync::OnceLock;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AutoApprovalDecision {
    Allow { reason: String },
    Prompt { reason: String },
    Deny { reason: String },
}

impl AutoApprovalDecision {
    pub fn is_allow(&self) -> bool {
        matches!(self, AutoApprovalDecision::Allow { .. })
    }
}

fn read_only_tools() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| {
        ["Read", "Glob", "Grep", "LS", "NotebookRead"]
            .into_iter()
            .collect()
    })
}

fn safe_bash_commands() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| {
        [
            "ls", "pwd", "cd", "echo", "cat", "head", "tail", "wc", "file", "stat", "which",
            "whoami", "hostname", "uname", "date", "env", "true", "false",
        ]
        .into_iter()
        .collect()
    })
}

fn safe_git_subcommands() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| {
        [
            "status", "log", "diff", "show", "branch", "remote", "config", "rev-parse",
            "ls-files", "ls-tree", "blame", "describe", "reflog", "stash", "tag", "shortlog",
            "name-rev", "cat-file",
        ]
        .into_iter()
        .collect()
    })
}

fn hard_deny_tokens() -> &'static HashSet<&'static str> {
    static SET: OnceLock<HashSet<&'static str>> = OnceLock::new();
    SET.get_or_init(|| {
        [
            "rm", "sudo", "dd", "mkfs", "reboot", "shutdown", "halt", "poweroff", "chmod",
            "chown", "mv", "cp", "curl", "wget", "nc", "ncat", "telnet", "ssh", "scp", "rsync",
        ]
        .into_iter()
        .collect()
    })
}

fn classify_bash_leg(cmd: &str) -> AutoApprovalDecision {
    let tokens: Vec<&str> = cmd.split_whitespace().collect();
    if tokens.is_empty() {
        return AutoApprovalDecision::Prompt {
            reason: "empty command, not auto-approvable".to_string(),
        };
    }
    let head = tokens[0];

    if hard_deny_tokens().contains(head) {
        return AutoApprovalDecision::Prompt {
            reason: format!(
                "command starts with \"{head}\", a destructive or network-mutating token"
            ),
        };
    }

    if safe_bash_commands().contains(head) {
        return AutoApprovalDecision::Allow {
            reason: format!("\"{head}\" is read-only / inert"),
        };
    }

    if head == "git" {
        let sub = tokens.get(1).copied().unwrap_or("");
        if safe_git_subcommands().contains(sub) {
            return AutoApprovalDecision::Allow {
                reason: format!("git {sub} is read-only"),
            };
        }
        return AutoApprovalDecision::Prompt {
            reason: format!("git subcommand \"{sub}\" is not in the safe-list"),
        };
    }

    AutoApprovalDecision::Prompt {
        reason: format!("command \"{head}\" is not in the safe-list (default-deny)"),
    }
}

/// Classify a tool call. Compound bash NEVER auto-approves (INV-bash-scope
/// scope-clamp protection — see `permission_service` for context).
pub fn classify_tool_for_auto_approval(inv: &ToolInvocation) -> AutoApprovalDecision {
    if read_only_tools().contains(inv.tool.as_str()) {
        return AutoApprovalDecision::Allow {
            reason: format!("{} is a read-only tool", inv.tool),
        };
    }

    if inv.tool == "Bash" {
        let command = inv
            .input
            .get("command")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if command.is_empty() {
            return AutoApprovalDecision::Prompt {
                reason: "Bash call has no command".to_string(),
            };
        }
        // INV-bash-scope: compound never auto-approves even if every leg
        // is safe. `allow` would short-circuit the scope-clamp in
        // `permission_service::check`.
        let legs = split_compound(command);
        if legs.len() > 1 {
            return AutoApprovalDecision::Prompt {
                reason: "compound bash skipped from auto-approval (INV-bash-scope clamp)"
                    .to_string(),
            };
        }
        if legs.is_empty() {
            return AutoApprovalDecision::Prompt {
                reason: "Bash call is empty after splitting".to_string(),
            };
        }
        return classify_bash_leg(&legs[0]);
    }

    AutoApprovalDecision::Prompt {
        reason: format!("tool \"{}\" is mutating or unknown", inv.tool),
    }
}
