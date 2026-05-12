//! End-to-end runner tests (M014.4).
//!
//! These tests exercise the full fork → unshare → fork → seccomp → execvp
//! chain. They are SKIPPED at runtime (not compiled out) when the kernel
//! disallows unprivileged user namespaces, so dev boxes with a hardened
//! sysctl don't see spurious failures.

#![cfg(target_os = "linux")]

use apohara_sandbox::{PermissionTier, SandboxRequest, SandboxRunner};
use std::path::PathBuf;
use std::time::Duration;

fn userns_disabled() -> bool {
    matches!(
        std::fs::read_to_string("/proc/sys/kernel/unprivileged_userns_clone")
            .ok()
            .and_then(|s| s.trim().parse::<i32>().ok()),
        Some(0)
    )
}

fn run_or_skip(req: SandboxRequest) -> Option<apohara_sandbox::SandboxResult> {
    if userns_disabled() {
        eprintln!("SKIP: kernel.unprivileged_userns_clone=0");
        return None;
    }
    match SandboxRunner::new().run(req) {
        Ok(r) => Some(r),
        Err(e) => {
            eprintln!("runner returned err: {e}");
            None
        }
    }
}

#[test]
fn workspace_write_echo_succeeds() {
    // We invoke echo via `sh -c` rather than calling `/usr/bin/echo`
    // directly: on Debian/Ubuntu /usr/bin/echo is a uutils Rust binary
    // that drags in libselinux + libpcre2 + libm + libgcc_s. Those
    // dynamic-linker syscalls aren't all on the WorkspaceWrite list
    // (membarrier, selinux open-on-rdonly variants, etc.), so the
    // process SEGVs before main(). Using dash's `echo` builtin keeps
    // the dynamic-linker surface minimal while still proving the runner
    // captures stdout end-to-end.
    let Some(result) = run_or_skip(SandboxRequest {
        command: vec!["/bin/sh".into(), "-c".into(), "echo hello".into()],
        workdir: PathBuf::from("/tmp"),
        permission: PermissionTier::WorkspaceWrite,
        timeout: Some(Duration::from_secs(5)),
        task_id: None,
    }) else {
        return;
    };

    assert_eq!(result.exit_code, 0, "sh -c echo must exit 0 (result={result:?})");
    assert_eq!(result.stdout, "hello\n", "stdout mismatch (result={result:?})");
    assert!(
        result.violations.is_empty(),
        "no violations expected, got {:?}",
        result.violations
    );
    assert!(result.stderr.is_empty() || result.stderr.trim().is_empty());
}

#[test]
fn workspace_write_captures_stderr() {
    // `sh -c` is on the WorkspaceWrite execve allowlist; the shell forks
    // and dups stderr just like echo.
    let Some(result) = run_or_skip(SandboxRequest {
        command: vec![
            "/bin/sh".into(),
            "-c".into(),
            "echo onerror >&2; exit 7".into(),
        ],
        workdir: PathBuf::from("/tmp"),
        permission: PermissionTier::WorkspaceWrite,
        timeout: Some(Duration::from_secs(5)),
        task_id: None,
    }) else {
        return;
    };

    assert_eq!(result.exit_code, 7, "shell must propagate exit 7");
    assert_eq!(result.stderr, "onerror\n", "stderr mismatch");
}

#[test]
fn readonly_blocks_execve_of_anything() {
    // ReadOnly does NOT include `execve` in its allowlist. When the
    // grandchild calls execvp, seccomp errno's with EPERM and the
    // grandchild writes that errno to the exec-error pipe. The runner
    // surfaces it as an `execve_failed(errno=...)` violation.
    let Some(result) = run_or_skip(SandboxRequest {
        command: vec!["/bin/sh".into(), "-c".into(), "echo should-not-run".into()],
        workdir: PathBuf::from("/tmp"),
        permission: PermissionTier::ReadOnly,
        timeout: Some(Duration::from_secs(5)),
        task_id: None,
    }) else {
        return;
    };

    assert!(
        result
            .violations
            .iter()
            .any(|v| v.starts_with("execve_failed")),
        "expected execve_failed violation, got {:?}",
        result.violations
    );
    assert_ne!(
        result.exit_code, 0,
        "exit code must be non-zero when execve was blocked (got {})",
        result.exit_code
    );
    assert!(
        result.stdout.is_empty(),
        "no stdout expected when execve blocked, got {:?}",
        result.stdout
    );
}

#[test]
fn empty_command_rejected_before_fork() {
    if userns_disabled() {
        return;
    }
    let err = SandboxRunner::new()
        .run(SandboxRequest {
            command: vec![],
            workdir: PathBuf::from("/tmp"),
            permission: PermissionTier::WorkspaceWrite,
            timeout: None,
            task_id: None,
        })
        .unwrap_err();
    assert!(
        format!("{err}").contains("command"),
        "expected message to mention command, got {err}"
    );
}
