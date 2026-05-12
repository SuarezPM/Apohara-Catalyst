//! seccomp-bpf profile generation per [`PermissionTier`].
//!
//! Concrete profiles live in [`linux`] (real seccomp filter) and [`fallback`]
//! (no-op for non-Linux platforms). The orchestrator selects via target_os at
//! compile time.

use crate::permission::PermissionTier;

pub mod syscalls;

#[cfg(target_os = "linux")]
pub mod linux;

#[cfg(not(target_os = "linux"))]
pub mod fallback;

/// Common trait for any platform's syscall enforcement profile.
pub trait Profile {
    /// Install the profile into the calling process. Subsequent syscalls are
    /// then governed by this profile until the process exits.
    fn install(&self) -> crate::error::Result<()>;

    /// Human-readable name for logging.
    fn name(&self) -> &str;
}

/// Resolve the platform-appropriate profile for a permission tier.
#[cfg(target_os = "linux")]
pub fn for_tier(tier: PermissionTier) -> Box<dyn Profile> {
    Box::new(linux::LinuxProfile::new(tier))
}

#[cfg(not(target_os = "linux"))]
pub fn for_tier(tier: PermissionTier) -> Box<dyn Profile> {
    Box::new(fallback::FallbackProfile::new(tier))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_resolves_for_each_tier() {
        for tier in [
            PermissionTier::ReadOnly,
            PermissionTier::WorkspaceWrite,
            PermissionTier::DangerFullAccess,
        ] {
            let p = for_tier(tier);
            assert!(!p.name().is_empty());
        }
    }
}
