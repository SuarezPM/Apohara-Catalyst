#[test]
fn version_is_non_empty() {
    assert!(!apohara_anti_thrash::version().is_empty());
}
