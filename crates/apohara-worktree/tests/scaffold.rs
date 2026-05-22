use apohara_worktree::version;

#[test]
fn lib_compiles_and_exposes_version() {
    assert!(version().starts_with("1.0"));
}
