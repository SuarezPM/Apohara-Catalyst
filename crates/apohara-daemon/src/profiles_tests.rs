use super::profiles::{Profile, ProfileError};
use std::io::Write;
use tempfile::tempdir;

#[test]
fn default_profile_has_known_name() {
    let p = Profile::default_profile();
    assert_eq!(p.name, "default");
    assert_eq!(p.log_level, "info");
}

#[test]
fn validate_name_accepts_alnum_dash_underscore() {
    Profile::validate_name("dev").unwrap();
    Profile::validate_name("staging-eu").unwrap();
    Profile::validate_name("prod_2").unwrap();
}

#[test]
fn validate_name_rejects_path_traversal_and_whitespace() {
    assert!(matches!(
        Profile::validate_name("../etc/passwd"),
        Err(ProfileError::InvalidName(_))
    ));
    assert!(matches!(
        Profile::validate_name("with space"),
        Err(ProfileError::InvalidName(_))
    ));
    assert!(matches!(
        Profile::validate_name(""),
        Err(ProfileError::InvalidName(_))
    ));
    assert!(matches!(
        Profile::validate_name(&"a".repeat(65)),
        Err(ProfileError::InvalidName(_))
    ));
}

#[test]
fn load_from_path_parses_json_and_forces_name() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("staging.json");
    {
        let mut f = std::fs::File::create(&path).unwrap();
        // Deliberately mismatched name field — loader should override.
        writeln!(
            f,
            r#"{{"name":"bogus","http_poll_port":12345,"log_level":"debug"}}"#
        )
        .unwrap();
    }
    let p = Profile::load_from_path(&path, "staging").unwrap();
    assert_eq!(p.name, "staging");
    assert_eq!(p.http_poll_port, Some(12345));
    assert_eq!(p.log_level, "debug");
}

#[test]
fn load_from_path_reports_notfound() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("missing.json");
    let err = Profile::load_from_path(&path, "missing").unwrap_err();
    assert!(matches!(err, ProfileError::NotFound(_)));
}

#[test]
fn socket_path_honors_override() {
    let p = Profile {
        name: "x".into(),
        socket_path_override: Some("/tmp/custom.sock".into()),
        http_poll_port: None,
        log_level: "info".into(),
    };
    assert_eq!(p.socket_path().to_string_lossy(), "/tmp/custom.sock");
}

#[test]
fn socket_path_differs_by_profile_name() {
    let a = Profile {
        name: "dev".into(),
        socket_path_override: None,
        http_poll_port: None,
        log_level: "info".into(),
    };
    let b = Profile {
        name: "staging".into(),
        socket_path_override: None,
        http_poll_port: None,
        log_level: "info".into(),
    };
    assert_ne!(a.socket_path(), b.socket_path());
}

#[test]
fn http_poll_port_is_deterministic_and_distinct_per_name() {
    let a = Profile {
        name: "dev".into(),
        socket_path_override: None,
        http_poll_port: None,
        log_level: "info".into(),
    };
    let b = Profile {
        name: "prod".into(),
        socket_path_override: None,
        http_poll_port: None,
        log_level: "info".into(),
    };
    assert_eq!(a.effective_http_poll_port(), a.effective_http_poll_port());
    assert_ne!(a.effective_http_poll_port(), b.effective_http_poll_port());
    assert!(a.effective_http_poll_port() >= 49152);
}

#[test]
fn explicit_http_poll_port_wins() {
    let p = Profile {
        name: "x".into(),
        socket_path_override: None,
        http_poll_port: Some(31337),
        log_level: "info".into(),
    };
    assert_eq!(p.effective_http_poll_port(), 31337);
}

#[test]
fn profiles_root_honors_apohara_home() {
    std::env::set_var("APOHARA_HOME", "/tmp/apohara-test-home");
    let root = Profile::profiles_root().unwrap();
    assert_eq!(root.to_string_lossy(), "/tmp/apohara-test-home/profiles");
    std::env::remove_var("APOHARA_HOME");
}
