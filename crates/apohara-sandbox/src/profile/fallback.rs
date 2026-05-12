//! No-op profile for non-Linux platforms. The runner reports Unavailable but
//! the orchestrator can opt to continue with explicit user consent.

use crate::error::{Result, SandboxError};
use crate::permission::PermissionTier;
use super::Profile;

pub struct FallbackProfile {
    tier: PermissionTier,
}

impl FallbackProfile {
    pub fn new(tier: PermissionTier) -> Self {
        Self { tier }
    }
}

impl Profile for FallbackProfile {
    fn install(&self) -> Result<()> {
        Err(SandboxError::Unavailable)
    }

    fn name(&self) -> &str {
        match self.tier {
            PermissionTier::ReadOnly => "fallback-readonly",
            PermissionTier::WorkspaceWrite => "fallback-workspace_write",
            PermissionTier::DangerFullAccess => "fallback-passthrough",
        }
    }
}
