//! G7.5.A.10 — wire `apohara_pathsafety::canonicalize_recursive` into the
//! sandbox runner.
//!
//! The Linux runner used to call `std::fs::canonicalize` directly, which
//! collapses three distinct failure modes into a generic `io::Error`:
//!   - dangling symlink (target doesn't exist)
//!   - symlink loop (chain exceeds `MAX_SYMLINK_HOPS`)
//!   - symlink escape (resolved path leaves the workspace root)
//!
//! `canonicalize_recursive` walks the chain hop-by-hop and reports those
//! cases with dedicated `PathSafetyError` variants. These tests prove the
//! sandbox now propagates them as `SandboxError::NamespaceError` with
//! diagnostic strings that name the failure mode.

#![cfg(target_os = "linux")]

use apohara_sandbox::runner::validate_workdir;
use apohara_sandbox::{PermissionTier, SandboxError, SandboxRequest};
use std::os::unix::fs::symlink;
use std::path::PathBuf;
use tempfile::tempdir;

fn req_with(workdir: PathBuf, root: Option<PathBuf>) -> SandboxRequest {
    SandboxRequest {
        command: vec!["/bin/true".into()],
        workdir,
        permission: PermissionTier::ReadOnly,
        timeout: None,
        task_id: None,
        workspace_root: root,
    }
}

#[test]
fn rejects_workdir_symlink_escaping_workspace_root() {
    // Layout:
    //   <root>/ws/              ← workspace_root
    //   <root>/ws/inside/       ← legit child
    //   <root>/ws/escape -> <root>/outside/  ← hostile symlink
    //   <root>/outside/         ← OUTSIDE the workspace
    let tmp = tempdir().unwrap();
    let root = tmp.path().to_path_buf();
    let ws = root.join("ws");
    let outside = root.join("outside");
    std::fs::create_dir_all(&ws).unwrap();
    std::fs::create_dir_all(&outside).unwrap();

    let escape = ws.join("escape");
    symlink(&outside, &escape).unwrap();

    // workspace_root is the canonical real `ws`. workdir is the escape
    // symlink that LOOKS like a child of ws but resolves to `outside`.
    let req = req_with(escape.clone(), Some(ws.clone()));
    let err = validate_workdir(&req).expect_err("symlink escape must be rejected");
    let msg = err.to_string();
    assert!(
        matches!(err, SandboxError::NamespaceError(_)),
        "expected NamespaceError, got: {err:?}"
    );
    assert!(
        msg.contains("symlink") || msg.contains("escapes") || msg.contains("Escape"),
        "error string should name the escape, got: {msg}"
    );
}

#[test]
fn rejects_dangling_symlink_workdir() {
    // <root>/ws/                     ← workspace_root
    // <root>/ws/dangling -> /tmp/nope-does-not-exist-XXXX
    let tmp = tempdir().unwrap();
    let ws = tmp.path().join("ws");
    std::fs::create_dir_all(&ws).unwrap();

    let dangling = ws.join("dangling");
    let target = tmp.path().join("nope-does-not-exist");
    symlink(&target, &dangling).unwrap();

    let req = req_with(dangling.clone(), Some(ws.clone()));
    let err = validate_workdir(&req).expect_err("dangling symlink must be rejected");
    assert!(
        matches!(err, SandboxError::NamespaceError(_)),
        "expected NamespaceError, got: {err:?}"
    );
    let msg = err.to_string();
    assert!(
        msg.contains("dangling") || msg.contains("Dangling"),
        "error should mention dangling, got: {msg}"
    );
}

#[test]
fn rejects_symlink_loop_workdir() {
    // <root>/ws/loop1 -> loop2 -> loop1
    let tmp = tempdir().unwrap();
    let ws = tmp.path().join("ws");
    std::fs::create_dir_all(&ws).unwrap();

    let loop1 = ws.join("loop1");
    let loop2 = ws.join("loop2");
    symlink(&loop2, &loop1).unwrap();
    symlink(&loop1, &loop2).unwrap();

    let req = req_with(loop1.clone(), Some(ws.clone()));
    let err = validate_workdir(&req).expect_err("symlink loop must be rejected");
    assert!(
        matches!(err, SandboxError::NamespaceError(_)),
        "expected NamespaceError, got: {err:?}"
    );
    let msg = err.to_string();
    assert!(
        msg.contains("loop") || msg.contains("Loop") || msg.contains("hops"),
        "error should mention the loop, got: {msg}"
    );
}

#[test]
fn accepts_clean_workdir_under_root() {
    let tmp = tempdir().unwrap();
    let ws = tmp.path().join("ws");
    let sub = ws.join("project");
    std::fs::create_dir_all(&sub).unwrap();

    let req = req_with(sub.clone(), Some(ws.clone()));
    validate_workdir(&req).expect("clean child dir must pass");
}

#[test]
fn accepts_no_workspace_root_legacy_caller() {
    // Forward-compat: callers that don't supply a workspace_root still
    // succeed (the seccomp + ns layer is the only defense — same shape
    // as the legacy serde test in src/runner.rs).
    let tmp = tempdir().unwrap();
    let req = req_with(tmp.path().to_path_buf(), None);
    validate_workdir(&req).expect("no workspace_root should still pass");
}
