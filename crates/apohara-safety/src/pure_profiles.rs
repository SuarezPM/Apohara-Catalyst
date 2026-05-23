//! Pure profiles for safety / eval runs — ports
//! `src/core/safety/pure-profiles.ts` (G5.A.11, vibe-kanban inspiration).
//!
//! A "pure" profile constrains a session to a defined subset of
//! side-effecting operations. The permission service consumes the
//! decision when deciding whether to authorize a tool call.

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PureProfileName {
    Strict,
    ReadOnly,
    Eval,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum PureAction {
    FileRead,
    FileWrite,
    ShellExec,
    GitCommit,
    NetworkEgress,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PureProfile {
    pub name: PureProfileName,
    pub description: &'static str,
    pub file_read: bool,
    pub file_write: bool,
    pub shell_exec: bool,
    pub git_commit: bool,
    pub network_egress: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct SafetyDecision {
    pub allowed: bool,
    pub reason: String,
}

#[derive(Debug, Error)]
pub enum PureProfileError {
    #[error("unknown pure profile: {0}")]
    Unknown(String),
}

const STRICT: PureProfile = PureProfile {
    name: PureProfileName::Strict,
    description: "Read-only — no writes, no shell, no git, no network.",
    file_read: true,
    file_write: false,
    shell_exec: false,
    git_commit: false,
    network_egress: false,
};

const READ_ONLY: PureProfile = PureProfile {
    name: PureProfileName::ReadOnly,
    description: "Read + network allowed; no writes / no commits.",
    file_read: true,
    file_write: false,
    shell_exec: false,
    git_commit: false,
    network_egress: true,
};

const EVAL: PureProfile = PureProfile {
    name: PureProfileName::Eval,
    description: "Eval runs — writes (typically tmp); no commits, no network.",
    file_read: true,
    file_write: true,
    shell_exec: true,
    git_commit: false,
    network_egress: false,
};

pub fn get_pure_profile(name: PureProfileName) -> &'static PureProfile {
    match name {
        PureProfileName::Strict => &STRICT,
        PureProfileName::ReadOnly => &READ_ONLY,
        PureProfileName::Eval => &EVAL,
    }
}

pub fn is_allowed(name: PureProfileName, action: PureAction) -> bool {
    let p = get_pure_profile(name);
    match action {
        PureAction::FileRead => p.file_read,
        PureAction::FileWrite => p.file_write,
        PureAction::ShellExec => p.shell_exec,
        PureAction::GitCommit => p.git_commit,
        PureAction::NetworkEgress => p.network_egress,
    }
}

pub fn apply_pure_profile(name: PureProfileName, action: PureAction) -> SafetyDecision {
    let allowed = is_allowed(name, action);
    let label = match name {
        PureProfileName::Strict => "strict",
        PureProfileName::ReadOnly => "read_only",
        PureProfileName::Eval => "eval",
    };
    let action_label = match action {
        PureAction::FileRead => "file_read",
        PureAction::FileWrite => "file_write",
        PureAction::ShellExec => "shell_exec",
        PureAction::GitCommit => "git_commit",
        PureAction::NetworkEgress => "network_egress",
    };
    let reason = if allowed {
        format!("pure-profile:{label} permits {action_label}")
    } else {
        format!("pure-profile:{label} denies {action_label}")
    };
    SafetyDecision { allowed, reason }
}
