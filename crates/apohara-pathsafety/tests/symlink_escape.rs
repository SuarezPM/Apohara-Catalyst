use apohara_pathsafety::{canonicalize_recursive, safe_identifier, validate_cwd, PathSafetyError};
use std::path::PathBuf;
use tempfile::tempdir;

#[test]
fn safe_identifier_sanitizes_unsafe_chars() {
    assert_eq!(safe_identifier("feat/foo bar:baz"), "feat_foo_bar_baz");
    assert_eq!(safe_identifier("a.b-c_d"), "a.b-c_d");
}

#[test]
fn validate_cwd_accepts_subpath() {
    let root = tempdir().unwrap();
    let sub = root.path().join("sub");
    std::fs::create_dir(&sub).unwrap();
    assert!(validate_cwd(&sub, root.path()).is_ok());
}

#[test]
fn validate_cwd_rejects_outside_root() {
    let root = tempdir().unwrap();
    let other = tempdir().unwrap();
    let err = validate_cwd(other.path(), root.path()).unwrap_err();
    assert!(matches!(err, PathSafetyError::EscapesRoot { .. }));
}

#[test]
fn validate_cwd_rejects_root_equal_to_workspace() {
    let root = tempdir().unwrap();
    let err = validate_cwd(root.path(), root.path()).unwrap_err();
    assert!(matches!(err, PathSafetyError::EqualToRoot));
}

#[test]
#[cfg(unix)]
fn validate_cwd_detects_symlink_escape() {
    let root = tempdir().unwrap();
    let other = tempdir().unwrap();
    let evil = root.path().join("evil");
    std::os::unix::fs::symlink(other.path(), &evil).unwrap();
    let err = validate_cwd(&evil, root.path()).unwrap_err();
    match err {
        PathSafetyError::SymlinkEscape { .. } | PathSafetyError::EscapesRoot { .. } => (),
        other => panic!("expected symlink/escape error, got {:?}", other),
    }
}

// Keep `canonicalize_recursive` reachable from tests so the helper has a public
// caller even before downstream integrations (Stage 4) wire it up.
#[allow(dead_code)]
fn _canonicalize_recursive_is_used(p: &std::path::Path) -> Result<std::path::PathBuf, PathSafetyError> {
    canonicalize_recursive(p, 8)
}

// ---------------------------------------------------------------------
// G5.G.3 — completed symlink-escape edge cases
// ---------------------------------------------------------------------

#[test]
#[cfg(unix)]
fn validate_cwd_detects_relative_symlink_escape() {
    // `evil` is a *relative* symlink to `../outside`. The relative form
    // is the most common attacker payload (no absolute path leaks).
    let root = tempdir().unwrap();
    let outside_dir = tempdir().unwrap();
    let evil = root.path().join("evil");
    // Build a relative path that bubbles up to `outside_dir`.
    let rel = std::path::PathBuf::from("..").join(
        outside_dir
            .path()
            .file_name()
            .expect("outside dir has a name"),
    );
    let outside_target = root
        .path()
        .parent()
        .unwrap()
        .join(outside_dir.path().file_name().unwrap());
    // Sanity: the resolved target points outside the root.
    std::os::unix::fs::symlink(&rel, &evil).unwrap();
    let _ = outside_target; // suppress unused if path doesn't exist
    let res = validate_cwd(&evil, root.path());
    assert!(
        res.is_err(),
        "relative symlink escape MUST be rejected, got {:?}",
        res
    );
}

#[test]
#[cfg(unix)]
fn validate_cwd_rejects_dangling_symlink() {
    let root = tempdir().unwrap();
    let evil = root.path().join("dangling");
    std::os::unix::fs::symlink("/no/such/path/here", &evil).unwrap();
    let err = validate_cwd(&evil, root.path()).unwrap_err();
    assert!(
        matches!(err, PathSafetyError::DanglingSymlink { .. } | PathSafetyError::Io(_)),
        "expected DanglingSymlink, got {:?}",
        err
    );
}

#[test]
#[cfg(unix)]
fn canonicalize_recursive_detects_symlink_loop() {
    let root = tempdir().unwrap();
    let a = root.path().join("a");
    let b = root.path().join("b");
    // a → b → a → b → ... forever.
    std::os::unix::fs::symlink(&b, &a).unwrap();
    std::os::unix::fs::symlink(&a, &b).unwrap();
    let err = canonicalize_recursive(&a, 8).unwrap_err();
    assert!(
        matches!(err, PathSafetyError::SymlinkLoop { .. } | PathSafetyError::Io(_)),
        "expected SymlinkLoop, got {:?}",
        err
    );
}

#[test]
#[cfg(unix)]
fn canonicalize_recursive_caps_at_max_hops() {
    // Build a chain of 5 hops; max_depth=2 must fail.
    let root = tempdir().unwrap();
    let real = root.path().join("real");
    std::fs::write(&real, b"contents").unwrap();
    let mut prev = real.clone();
    let mut chain: Vec<PathBuf> = vec![];
    for i in 0..5 {
        let next = root.path().join(format!("hop{i}"));
        std::os::unix::fs::symlink(&prev, &next).unwrap();
        chain.push(next.clone());
        prev = next;
    }
    let top = chain.last().unwrap();
    // max_depth=2 < 5 hops needed → SymlinkLoop.
    let err = canonicalize_recursive(top, 2).unwrap_err();
    assert!(
        matches!(err, PathSafetyError::SymlinkLoop { .. }),
        "expected SymlinkLoop, got {:?}",
        err
    );
}

#[test]
fn validate_cwd_rejects_dotdot_traversal() {
    let root = tempdir().unwrap();
    // String-level traversal: workspace = root/sub/../sub. The path
    // resolves back into root, but the intent is suspicious enough that
    // we hard-reject `..` segments outright (defense in depth).
    let sub = root.path().join("sub");
    std::fs::create_dir(&sub).unwrap();
    let evil = sub.join("..").join("sub");
    let err = validate_cwd(&evil, root.path()).unwrap_err();
    assert!(
        matches!(err, PathSafetyError::ParentTraversal(_)),
        "expected ParentTraversal, got {:?}",
        err
    );
}

#[test]
fn max_symlink_hops_matches_posix_minimum() {
    // POSIX guarantees at least 8; we set 32. Lock the constant so a
    // future bump is intentional and visible in code review.
    assert_eq!(apohara_pathsafety::MAX_SYMLINK_HOPS, 32);
}
