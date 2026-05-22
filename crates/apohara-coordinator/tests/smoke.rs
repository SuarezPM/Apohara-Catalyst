#[test]
fn version_is_non_empty() {
    assert!(!apohara_coordinator::version().is_empty());
}
