//! Behavioural parity tests for the installer. Mirrors the implicit
//! contract documented in `src/core/hooks/installer.ts` (TS has no unit
//! tests for this module — the wire contract is the SSoT).

use super::installer::{compute_hook_hash, install_hook, InstallReason};
use std::fs;

#[test]
fn hash_is_deterministic() {
    assert_eq!(compute_hook_hash("hello"), compute_hook_hash("hello"));
    assert_ne!(compute_hook_hash("hello"), compute_hook_hash("HELLO"));
}

#[test]
fn fresh_install_writes_new_file() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("nested/hook.sh");
    let res = install_hook(&path, "#!/bin/sh\necho hi\n").unwrap();
    assert!(res.installed);
    assert_eq!(res.reason, InstallReason::WroteNew);
    assert!(res.backup_path.is_none());
    let content = fs::read_to_string(&path).unwrap();
    assert!(content.contains("echo hi"));
}

#[test]
fn idempotent_install_skips_on_hash_match() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("hook.sh");
    let body = "same content\n";
    install_hook(&path, body).unwrap();
    let res = install_hook(&path, body).unwrap();
    assert!(!res.installed);
    assert_eq!(res.reason, InstallReason::SkippedHashMatch);
    assert!(res.backup_path.is_none());
}

#[test]
fn overwriting_creates_backup() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("hook.sh");
    install_hook(&path, "v1\n").unwrap();
    let res = install_hook(&path, "v2\n").unwrap();
    assert!(res.installed);
    assert_eq!(res.reason, InstallReason::OverwroteWithBackup);
    let backup = res.backup_path.expect("backup path must be present");
    let backup_content = fs::read_to_string(&backup).unwrap();
    assert_eq!(backup_content, "v1\n");
    let new_content = fs::read_to_string(&path).unwrap();
    assert_eq!(new_content, "v2\n");
}

#[cfg(unix)]
#[test]
fn sh_files_get_chmod_755_on_unix() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("exec.sh");
    install_hook(&path, "#!/bin/sh\n").unwrap();
    let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o755, "got mode {:o}", mode);
}

#[cfg(unix)]
#[test]
fn non_sh_files_keep_default_mode() {
    use std::os::unix::fs::PermissionsExt;
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("data.json");
    install_hook(&path, "{}\n").unwrap();
    let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    // We don't pin an exact value (umask varies) — just assert we did
    // NOT bump it to 0o755 like .sh.
    assert_ne!(mode, 0o755, "non-sh files must not be chmod-ed");
}

#[test]
fn install_creates_missing_parent_dirs() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("a/b/c/hook.sh");
    let res = install_hook(&path, "x\n").unwrap();
    assert!(res.installed);
    assert!(path.exists());
}
