//! Linux namespace isolation (M014.3).
//!
//! Establishes a PID + mount + user namespace bundle so a sandboxed
//! subprocess can't see host PIDs or affect host mounts. Combined with the
//! seccomp-bpf filter from [`crate::profile::linux`], a sandboxed worktree
//! agent that calls `kill(pid, ...)` on the orchestrator simply can't
//! resolve the orchestrator's PID — it isn't visible.
//!
//! ## Unprivileged design
//!
//! Plain `unshare(CLONE_NEWPID|CLONE_NEWNS)` requires `CAP_SYS_ADMIN` on
//! every modern Linux kernel. Apohara workers run as the invoking user, so
//! we bundle a user namespace (`CLONE_NEWUSER`) in the same `unshare(2)`
//! call: an unprivileged process gets the new user-ns, and the bundled
//! PID + mount namespaces become writable inside it without root.
//!
//! After `unshare`, the kernel requires three writes before the new
//! namespace is fully usable:
//!   1. `/proc/self/setgroups` ← `"deny"` (must precede gid_map; security)
//!   2. `/proc/self/uid_map`  ← `"0 <host_uid> 1"`
//!   3. `/proc/self/gid_map`  ← `"0 <host_gid> 1"`
//!
//! ## When to call
//!
//! [`enter_isolated_namespaces`] must run inside a forked child, **before**
//! the seccomp filter is applied. The PID-namespace reparenting only takes
//! effect for *future* children of the caller, so the canonical sequence
//! is: parent forks → child A unshares → child A forks → child B is PID 1
//! in the new namespace.

#![cfg(target_os = "linux")]

use nix::sched::{unshare, CloneFlags};
use nix::unistd::{getgid, getuid};
use std::fs::OpenOptions;
use std::io::Write;

use crate::error::{Result, SandboxError};

/// Enter an isolated bundle of namespaces (user + mount + PID).
///
/// On return:
///   - The process owns a fresh user namespace where uid 0 maps to the
///     caller's host uid and gid 0 maps to the caller's host gid.
///   - The process owns a fresh mount namespace (mounts here don't affect
///     the host).
///   - Subsequent `fork(2)` calls put children into a fresh PID namespace
///     where the first forked child has PID 1.
///
/// Errors are reported as [`SandboxError::NamespaceError`] with the
/// underlying errno or I/O message attached.
pub fn enter_isolated_namespaces() -> Result<()> {
    let host_uid = getuid().as_raw();
    let host_gid = getgid().as_raw();

    let flags =
        CloneFlags::CLONE_NEWUSER | CloneFlags::CLONE_NEWNS | CloneFlags::CLONE_NEWPID;

    unshare(flags).map_err(|e| {
        SandboxError::NamespaceError(format!(
            "unshare(CLONE_NEWUSER|CLONE_NEWNS|CLONE_NEWPID) failed: {e}. \
             Hint: requires kernel.unprivileged_userns_clone=1 and \
             user.max_user_namespaces > 0 (sysctl)."
        ))
    })?;

    write_proc_self("setgroups", "deny")?;
    write_proc_self("uid_map", &format!("0 {host_uid} 1"))?;
    write_proc_self("gid_map", &format!("0 {host_gid} 1"))?;

    Ok(())
}

/// Overwrite a `/proc/self/<name>` mapping file. These files accept exactly
/// one write of the mapping line and reject subsequent attempts, so we use
/// `OpenOptions::write(true).truncate(true)` rather than `append`.
fn write_proc_self(name: &str, contents: &str) -> Result<()> {
    let path = format!("/proc/self/{name}");
    let mut f = OpenOptions::new()
        .write(true)
        .truncate(true)
        .open(&path)
        .map_err(|e| {
            SandboxError::NamespaceError(format!("open {path}: {e}"))
        })?;
    f.write_all(contents.as_bytes()).map_err(|e| {
        SandboxError::NamespaceError(format!("write {path}: {e}"))
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn write_proc_self_rejects_nonexistent() {
        // Sanity: writing to a /proc/self path that doesn't exist must
        // surface as a NamespaceError (not panic). We use this to confirm
        // the error wrapper covers the I/O failure path.
        let err = write_proc_self("apohara_bogus_xyz", "anything").unwrap_err();
        match err {
            SandboxError::NamespaceError(msg) => {
                assert!(
                    msg.contains("apohara_bogus_xyz"),
                    "expected error to name the path, got: {msg}"
                );
            }
            other => panic!("expected NamespaceError, got {other:?}"),
        }
    }
}
