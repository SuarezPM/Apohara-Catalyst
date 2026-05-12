//! Linux seccomp-bpf profile builder.
//!
//! M014.2 scope (this commit): canonical syscall lists per tier (sourced from
//! [`super::syscalls`]) compiled into a real BPF program via the `seccompiler`
//! crate. [`LinuxProfile::install`] now calls `seccompiler::apply_filter` to
//! enforce the policy on the *calling* process — so the caller must already
//! be inside a forked child (post-`unshare` in M014.3+).
//!
//! Filter shape:
//!   - **Default action** (mismatch): `errno(EPERM)` — the child observes a
//!     normal failure for any unlisted syscall, rather than dying with SIGSYS.
//!     This gives the orchestrator a chance to surface a recoverable violation
//!     event instead of a SIGSYS-killed worker.
//!   - **Match action**: `allow`.
//!   - **Conditional rules**: ReadOnly's `openat` is constrained to access
//!     mode `O_RDONLY` (bits 0..1 must be zero). WorkspaceWrite allows
//!     `openat` unconditionally, narrows `fcntl` to a safe `cmd` allowlist,
//!     and narrows `ioctl` to a safe `request` allowlist.
//!   - **DangerFullAccess**: no filter is installed — the process inherits
//!     ambient permissions.

use seccompiler::{apply_filter, BpfMap, BpfProgram};
use serde_json::{json, Map, Value};

use crate::error::{Result, SandboxError};
use crate::permission::PermissionTier;
use super::Profile;
use super::syscalls;

pub struct LinuxProfile {
    tier: PermissionTier,
}

impl LinuxProfile {
    pub fn new(tier: PermissionTier) -> Self {
        Self { tier }
    }

    /// Return the full list of allowed syscalls for this tier (pure-allow only).
    pub fn pure_allow_syscalls(&self) -> Vec<&'static str> {
        syscalls::pure_allow_for(self.tier)
    }

    /// Return the list of syscalls with argument-level constraints.
    pub fn conditional_syscalls(&self) -> Vec<(&'static str, &'static str)> {
        syscalls::conditional_for(self.tier)
    }

    /// Compile this profile into a BPF program ready for `seccompiler::apply_filter`.
    ///
    /// Returns `None` for DangerFullAccess (no filter is installed for that tier).
    pub fn build_filter(&self) -> Result<Option<BpfProgram>> {
        if matches!(self.tier, PermissionTier::DangerFullAccess) {
            return Ok(None);
        }

        let arch: seccompiler::TargetArch = std::env::consts::ARCH
            .try_into()
            .map_err(|e| SandboxError::SeccompError(format!("target arch: {e}")))?;

        let json_spec = self.build_json_spec();
        let json_bytes = serde_json::to_vec(&json_spec)
            .map_err(|e| SandboxError::SeccompError(format!("json serialize: {e}")))?;

        let map: BpfMap = seccompiler::compile_from_json(json_bytes.as_slice(), arch)
            .map_err(|e| SandboxError::SeccompError(format!("compile_from_json: {e}")))?;

        let program = map
            .get("main_thread")
            .ok_or_else(|| {
                SandboxError::SeccompError("compiled map missing 'main_thread'".into())
            })?
            .clone();

        Ok(Some(program))
    }

    /// Build the seccompiler JSON spec for this tier. Exposed for tests and
    /// for the `apohara-sandbox dry-run` diagnostic path.
    pub fn build_json_spec(&self) -> Value {
        let mut filter_rules: Vec<Value> = Vec::new();

        for syscall in self.pure_allow_syscalls() {
            // Skip syscalls that have a tier-specific conditional rule below;
            // an unconditional allow would shadow the constraint.
            if conditional_overrides_pure(self.tier, syscall) {
                continue;
            }
            filter_rules.push(json!({ "syscall": syscall }));
        }

        for rule in self.conditional_rules() {
            filter_rules.push(rule);
        }

        let mut main_thread = Map::new();
        main_thread.insert(
            "mismatch_action".into(),
            json!({ "errno": libc::EPERM as u32 }),
        );
        main_thread.insert("match_action".into(), Value::String("allow".into()));
        main_thread.insert("filter".into(), Value::Array(filter_rules));

        let mut root = Map::new();
        root.insert("main_thread".into(), Value::Object(main_thread));
        Value::Object(root)
    }

    /// Build the seccompiler JSON rules for argument-level constraints, per tier.
    fn conditional_rules(&self) -> Vec<Value> {
        match self.tier {
            PermissionTier::ReadOnly => {
                // ReadOnly: openat must have access mode RDONLY (bits 0..1 zero).
                // seccompiler's `masked_eq` carries the mask inside the op
                // value: `(arg[2] & MASK) == val`.
                vec![json!({
                    "syscall": "openat",
                    "args": [{
                        "index": 2,
                        "type": "dword",
                        "op": { "masked_eq": libc::O_ACCMODE as u64 },
                        "val": 0u64,
                    }]
                })]
            }
            PermissionTier::WorkspaceWrite => {
                let mut rules = vec![json!({ "syscall": "openat" })];

                for cmd in [libc::F_GETFL, libc::F_SETFL, libc::F_DUPFD, libc::F_DUPFD_CLOEXEC] {
                    rules.push(json!({
                        "syscall": "fcntl",
                        "args": [{
                            "index": 1,
                            "type": "dword",
                            "op": "eq",
                            "val": cmd as u64,
                        }]
                    }));
                }

                for req in [libc::TIOCGWINSZ, libc::FIOCLEX, libc::FIONCLEX] {
                    rules.push(json!({
                        "syscall": "ioctl",
                        "args": [{
                            "index": 1,
                            "type": "dword",
                            "op": "eq",
                            "val": req as u64,
                        }]
                    }));
                }

                rules
            }
            PermissionTier::DangerFullAccess => Vec::new(),
        }
    }
}

fn conditional_overrides_pure(tier: PermissionTier, syscall: &str) -> bool {
    matches!(
        (tier, syscall),
        (PermissionTier::ReadOnly, "openat") | (PermissionTier::WorkspaceWrite, "openat")
    )
}

impl Profile for LinuxProfile {
    fn install(&self) -> Result<()> {
        let filter = match self.build_filter()? {
            None => {
                tracing::warn!("DangerFullAccess: no seccomp filter installed");
                return Ok(());
            }
            Some(f) => f,
        };

        tracing::info!(
            tier = %self.tier,
            "installing seccomp-bpf filter into calling process"
        );

        apply_filter(&filter)
            .map_err(|e| SandboxError::SeccompError(format!("apply_filter: {e}")))?;

        Ok(())
    }

    fn name(&self) -> &str {
        match self.tier {
            PermissionTier::ReadOnly => "linux-seccomp-readonly",
            PermissionTier::WorkspaceWrite => "linux-seccomp-workspace_write",
            PermissionTier::DangerFullAccess => "linux-seccomp-passthrough",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_per_tier() {
        assert_eq!(
            LinuxProfile::new(PermissionTier::ReadOnly).name(),
            "linux-seccomp-readonly"
        );
        assert_eq!(
            LinuxProfile::new(PermissionTier::WorkspaceWrite).name(),
            "linux-seccomp-workspace_write"
        );
    }

    #[test]
    fn readonly_resolves_substantial_allowlist() {
        let p = LinuxProfile::new(PermissionTier::ReadOnly);
        let list = p.pure_allow_syscalls();
        assert!(list.len() >= 40, "expected ≥40 syscalls, got {}", list.len());
        assert!(list.contains(&"read"));
        assert!(list.contains(&"exit"));
        assert!(!list.contains(&"write"));
    }

    #[test]
    fn workspace_extends_readonly_with_write_syscalls() {
        let p = LinuxProfile::new(PermissionTier::WorkspaceWrite);
        let list = p.pure_allow_syscalls();
        assert!(list.contains(&"read"));
        assert!(list.contains(&"write"));
        assert!(list.contains(&"mkdirat"));
    }

    #[test]
    fn danger_has_no_syscall_filter() {
        let p = LinuxProfile::new(PermissionTier::DangerFullAccess);
        assert!(p.pure_allow_syscalls().is_empty());
    }

    #[test]
    fn build_filter_returns_none_for_danger() {
        let p = LinuxProfile::new(PermissionTier::DangerFullAccess);
        let f = p.build_filter().expect("danger build_filter ok");
        assert!(f.is_none(), "DangerFullAccess must not produce a filter");
    }

    #[test]
    fn build_filter_compiles_for_readonly() {
        let p = LinuxProfile::new(PermissionTier::ReadOnly);
        let f = p
            .build_filter()
            .expect("ReadOnly profile must compile cleanly");
        assert!(f.is_some(), "ReadOnly must produce a real BpfProgram");
    }

    #[test]
    fn build_filter_compiles_for_workspace_write() {
        let p = LinuxProfile::new(PermissionTier::WorkspaceWrite);
        let f = p
            .build_filter()
            .expect("WorkspaceWrite profile must compile cleanly");
        assert!(f.is_some());
    }

    #[test]
    fn json_spec_has_expected_shape() {
        let p = LinuxProfile::new(PermissionTier::ReadOnly);
        let spec = p.build_json_spec();
        let main = spec
            .get("main_thread")
            .expect("spec must contain main_thread");
        assert_eq!(
            main.get("match_action").and_then(|v| v.as_str()),
            Some("allow")
        );
        let mismatch = main
            .get("mismatch_action")
            .and_then(|v| v.get("errno"))
            .and_then(|v| v.as_u64())
            .expect("mismatch action must be errno");
        assert_eq!(mismatch, libc::EPERM as u64);
        let filter = main
            .get("filter")
            .and_then(|v| v.as_array())
            .expect("filter must be an array");
        let names: Vec<&str> = filter
            .iter()
            .filter_map(|r| r.get("syscall").and_then(|s| s.as_str()))
            .collect();
        assert!(names.contains(&"read"));
        assert!(!names.contains(&"write"));
        assert!(names.contains(&"openat"));
    }
}
