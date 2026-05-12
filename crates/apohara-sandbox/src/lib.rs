//! Apohara Sandbox — syscall-level isolation for worktree agents.
//!
//! Three permission tiers exposed via [`PermissionTier`]:
//! - `ReadOnly`: open(2) read-only, stat/fstat, exit. No write, no fork, no network.
//! - `WorkspaceWrite`: ReadOnly + write/create/unlink within the worktree path.
//! - `DangerFullAccess`: bypass (requires `--i-know-what-im-doing` at the orchestrator).
//!
//! On Linux, enforcement is via seccomp-bpf (per-syscall allowlist) plus mount + PID
//! namespaces (per-worktree isolation). On other platforms, the sandbox is a no-op
//! and the runner returns an [`SandboxError::Unavailable`] that the orchestrator can
//! gate behind explicit user consent.
//!
//! M014.1: scaffold + deps. M014.2: seccomp-bpf compiled per tier.
//! M014.3: user+mount+PID namespace bundle via [`namespace::enter_isolated_namespaces`].
//! M014.4-.6: spawn integration, violation events, non-Linux fallback wiring.

pub mod error;
#[cfg(target_os = "linux")]
pub mod namespace;
pub mod permission;
pub mod profile;
pub mod runner;

pub use error::SandboxError;
#[cfg(target_os = "linux")]
pub use namespace::enter_isolated_namespaces;
pub use permission::PermissionTier;
pub use runner::{SandboxRunner, SandboxRequest, SandboxResult};
