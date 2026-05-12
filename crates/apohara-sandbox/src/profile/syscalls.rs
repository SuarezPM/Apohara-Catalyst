//! Per-tier syscall allowlists for the Linux seccomp-bpf profile.
//!
//! Researched via MiniMax 2.7 2026-05-12 against gvisor / firejail / bubblewrap
//! conventions. Each list is intentionally narrow — fail-closed is the default
//! ([`crate::profile::Profile`] returns SIGKILL on any unlisted syscall).
//!
//! Source notes: `.claude/specs/m014/SECCOMP_RESEARCH_NOTES.md`.

/// Tier 1: ReadOnly. Pure-allow syscalls (no argument conditions). Approx 45
/// entries covering read I/O, fd management, memory, signals, time, entropy,
/// process info, and clean exits.
pub const READONLY_PURE_ALLOW: &[&str] = &[
    // Read I/O
    "read",
    "pread64",
    "readv",
    "preadv2",
    // File descriptor management
    "close",
    "dup",
    "dup2",
    "dup3",
    "lseek",
    // Memory
    "mmap",
    "munmap",
    "mremap",
    "brk",
    "mprotect",
    "madvise",
    // Process info
    "getpid",
    "getppid",
    "gettid",
    "getuid",
    "getgid",
    "geteuid",
    "getegid",
    "getcwd",
    "prlimit64",
    "tgkill",
    // Signals
    "rt_sigprocmask",
    "rt_sigaction",
    "rt_sigreturn",
    "sigaltstack",
    // Time. `clock_gettime64` deliberately omitted — it's a 32-bit ABI
    // compatibility syscall, absent on x86_64/aarch64 64-bit kernels and
    // rejected by `seccompiler::compile_from_json` as unknown.
    "clock_gettime",
    "gettimeofday",
    "nanosleep",
    "clock_nanosleep",
    // Entropy
    "getrandom",
    // Process control
    "prctl",
    "arch_prctl",
    // Exit
    "exit",
    "exit_group",
    // Stat family
    "newfstatat",
    "statx",
    "fstat",
    "lstat",
    "faccessat",
    "faccessat2",
    "readlinkat",
    "fstatfs",
    "statfs",
];

/// Tier 1: ReadOnly. Syscalls with argument-level constraints.
///
/// Each entry is `(syscall_name, constraint_description)`. The actual BPF
/// condition is built by the filter constructor — this constant is just the
/// declarative manifest used for the build + for documentation.
pub const READONLY_CONDITIONAL: &[(&str, &str)] = &[(
    "openat",
    "flags must be subset of O_RDONLY|O_CLOEXEC|O_NOFOLLOW|O_DIRECTORY|O_PATH|O_NONBLOCK",
)];

/// Tier 2: WorkspaceWrite ADDITIONS — what's on top of Tier 1.
///
/// Pure-allow extensions for write I/O, path mutation, fd lifecycle,
/// ownership, *and* the syscalls a normal program needs to start at all
/// (execve, execveat, wait*, child fork): a sandboxed agent's primary
/// purpose is to invoke `bun test`, `cargo build`, etc., so we have to
/// let it `exec`. Path-level enforcement comes from the M014.3 mount
/// namespace, not from seccomp.
pub const WORKSPACE_WRITE_ADDITIONS_PURE_ALLOW: &[&str] = &[
    // Process startup + spawn — required so the grandchild can transfer
    // control to the target binary and so that binary can in turn run
    // its build tools.
    "execve",
    "execveat",
    "wait4",
    "waitid",
    "clone",
    "clone3",
    "set_robust_list",
    "rseq",
    "set_tid_address",
    "uname",
    // Write I/O
    "write",
    "pwrite64",
    "writev",
    "pwritev2",
    // Path mutation
    "creat",
    "mkdirat",
    "unlinkat",
    "renameat2",
    "linkat",
    "symlinkat",
    // Truncation
    "ftruncate",
    "truncate",
    // Metadata. `futimens` deliberately omitted — there's no dedicated
    // x86_64/aarch64 syscall for it; glibc implements it via `utimensat(fd,
    // NULL, ts, 0)`, so `utimensat` covers both call shapes.
    "fchmodat",
    "chmod",
    "utimensat",
    // Pipes
    "pipe2",
    // Working directory
    "fchdir",
    "chdir",
    // Directory iteration
    "getdents64",
    "getdents",
    // File copy primitives
    "copy_file_range",
    "sendfile",
    // Ownership
    "fchown",
    "fchownat",
    "lchown",
    // Storage hints / sync
    "fallocate",
    "fsync",
    "fdatasync",
    "sync_file_range",
];

/// Tier 2: WorkspaceWrite ADDITIONS — syscalls with argument-level constraints.
///
/// `openat` here is the unrestricted variant (replaces the Tier-1 entry). The
/// filter constructor uses the Tier-2 entry when building Workspace.
pub const WORKSPACE_WRITE_ADDITIONS_CONDITIONAL: &[(&str, &str)] = &[
    ("openat", "all flags allowed"),
    (
        "fcntl",
        "cmd must be F_GETFL|F_SETFL|F_DUPFD|F_DUPFD_CLOEXEC (block F_SETOWN, F_NOTIFY)",
    ),
    (
        "ioctl",
        "request must be TIOCGWINSZ|FIOCLEX|FIONCLEX (block FIBMAP, TUNSET*, SIOCSIFADDR)",
    ),
];

/// Returns the full list of pure-allow syscall names for a given tier.
/// Useful for building the BPF filter or for diagnostics.
pub fn pure_allow_for(tier: crate::permission::PermissionTier) -> Vec<&'static str> {
    use crate::permission::PermissionTier;
    match tier {
        PermissionTier::ReadOnly => READONLY_PURE_ALLOW.to_vec(),
        PermissionTier::WorkspaceWrite => {
            let mut v = READONLY_PURE_ALLOW.to_vec();
            v.extend_from_slice(WORKSPACE_WRITE_ADDITIONS_PURE_ALLOW);
            v
        }
        PermissionTier::DangerFullAccess => Vec::new(), // no filter applied
    }
}

/// Returns the conditional syscall constraints for a given tier.
pub fn conditional_for(
    tier: crate::permission::PermissionTier,
) -> Vec<(&'static str, &'static str)> {
    use crate::permission::PermissionTier;
    match tier {
        PermissionTier::ReadOnly => READONLY_CONDITIONAL.to_vec(),
        // Workspace's openat replaces ReadOnly's restricted variant
        PermissionTier::WorkspaceWrite => WORKSPACE_WRITE_ADDITIONS_CONDITIONAL.to_vec(),
        PermissionTier::DangerFullAccess => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::permission::PermissionTier;

    #[test]
    fn readonly_pure_allow_nonempty() {
        assert!(!READONLY_PURE_ALLOW.is_empty());
        assert!(READONLY_PURE_ALLOW.len() >= 40);
    }

    #[test]
    fn workspace_strictly_extends_readonly() {
        let readonly: std::collections::HashSet<_> =
            READONLY_PURE_ALLOW.iter().copied().collect();
        let workspace: std::collections::HashSet<_> =
            pure_allow_for(PermissionTier::WorkspaceWrite)
                .into_iter()
                .collect();
        assert!(
            readonly.is_subset(&workspace),
            "WorkspaceWrite must include every ReadOnly syscall"
        );
        assert!(
            workspace.len() > readonly.len(),
            "WorkspaceWrite must add at least one syscall"
        );
    }

    #[test]
    fn danger_returns_empty_lists() {
        assert!(pure_allow_for(PermissionTier::DangerFullAccess).is_empty());
        assert!(conditional_for(PermissionTier::DangerFullAccess).is_empty());
    }

    #[test]
    fn no_pure_allow_duplicates_per_tier() {
        for tier in [
            PermissionTier::ReadOnly,
            PermissionTier::WorkspaceWrite,
        ] {
            let list = pure_allow_for(tier);
            let unique: std::collections::HashSet<_> = list.iter().copied().collect();
            assert_eq!(unique.len(), list.len(), "tier {:?} has duplicate syscalls", tier);
        }
    }

    #[test]
    fn dangerous_syscalls_never_in_any_pure_allow_list() {
        // Hard-coded guardrail: these stay blocked across every tier.
        // execve / clone / wait4 are *not* on this list — a sandboxed
        // agent's job is to spawn build tools (bun, cargo, …) and those
        // need normal process lifecycle syscalls. Path-level restrictions
        // come from the M014.3 mount namespace, not from seccomp.
        let forbidden = [
            "ptrace",
            "process_vm_readv",
            "process_vm_writev",
            "perf_event_open",
            "unshare",
            "setns",
            "fork",
            "vfork",
            "kexec_load",
            "kexec_file_load",
            "init_module",
            "finit_module",
            "delete_module",
            "reboot",
            "mount",
            "umount2",
            "pivot_root",
            "sethostname",
            "setdomainname",
            "swapon",
            "swapoff",
        ];
        for tier in [
            PermissionTier::ReadOnly,
            PermissionTier::WorkspaceWrite,
        ] {
            let list = pure_allow_for(tier);
            for f in &forbidden {
                assert!(
                    !list.contains(f),
                    "tier {:?} must NOT allow {}",
                    tier,
                    f
                );
            }
        }
    }

    #[test]
    fn readonly_openat_is_conditional_not_pure() {
        // ReadOnly tier must NOT have openat in pure-allow (it's
        // conditional). Confirms the gating works.
        assert!(!READONLY_PURE_ALLOW.contains(&"openat"));
        let cond = conditional_for(PermissionTier::ReadOnly);
        assert!(cond.iter().any(|(name, _)| *name == "openat"));
    }
}
