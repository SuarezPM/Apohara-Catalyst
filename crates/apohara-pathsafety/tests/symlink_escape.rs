use apohara_pathsafety::{canonicalize_recursive, safe_identifier, validate_cwd, PathSafetyError};
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
