use serde::{Deserialize, Serialize};
use std::str::FromStr;

use crate::error::{Result, SandboxError};

/// Three-tier permission system for sandboxed processes. Matches the design in
/// the Apohara orchestrator's `src/core/sandbox.ts` PermissionTier type.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PermissionTier {
    /// Read files, stat, exit. No write, no exec of external bins, no network.
    /// Used for: test introspection, code reading, dry-run analysis.
    ReadOnly,

    /// ReadOnly + write/create/unlink within the worktree path. Bin exec allowed
    /// only for an allowlist (cargo, bun, git, etc.). No network.
    /// Used for: most agent work — write code in the assigned worktree.
    WorkspaceWrite,

    /// No syscall restrictions. Requires explicit `--i-know-what-im-doing` flag
    /// at the orchestrator. Only used for self-improve mode and similar.
    DangerFullAccess,
}

impl PermissionTier {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ReadOnly => "read_only",
            Self::WorkspaceWrite => "workspace_write",
            Self::DangerFullAccess => "danger_full_access",
        }
    }
}

impl FromStr for PermissionTier {
    type Err = SandboxError;

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "read_only" | "readonly" => Ok(Self::ReadOnly),
            "workspace_write" => Ok(Self::WorkspaceWrite),
            "danger_full_access" | "danger" => Ok(Self::DangerFullAccess),
            other => Err(SandboxError::InvalidPermission(other.to_string())),
        }
    }
}

impl std::fmt::Display for PermissionTier {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_roundtrip() {
        for t in [
            PermissionTier::ReadOnly,
            PermissionTier::WorkspaceWrite,
            PermissionTier::DangerFullAccess,
        ] {
            let s = t.to_string();
            let back = PermissionTier::from_str(&s).unwrap();
            assert_eq!(t, back);
        }
    }

    #[test]
    fn parse_aliases() {
        assert_eq!(
            PermissionTier::from_str("readonly").unwrap(),
            PermissionTier::ReadOnly
        );
        assert_eq!(
            PermissionTier::from_str("danger").unwrap(),
            PermissionTier::DangerFullAccess
        );
    }

    #[test]
    fn parse_invalid() {
        assert!(PermissionTier::from_str("bogus").is_err());
    }

    #[test]
    fn serde_json_roundtrip() {
        let t = PermissionTier::WorkspaceWrite;
        let json = serde_json::to_string(&t).unwrap();
        assert_eq!(json, "\"workspace_write\"");
        let back: PermissionTier = serde_json::from_str(&json).unwrap();
        assert_eq!(t, back);
    }
}
