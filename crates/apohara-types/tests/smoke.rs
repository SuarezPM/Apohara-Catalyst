use apohara_types::ApoharaVersion;

#[test]
fn apohara_version_is_v1() {
    assert_eq!(ApoharaVersion::CURRENT, "1.0.0-dev");
    assert!(ApoharaVersion::is_compatible("1.0.0"));
    assert!(!ApoharaVersion::is_compatible("0.9.0"));
}
