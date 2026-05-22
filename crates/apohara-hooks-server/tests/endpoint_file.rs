//! Endpoint-file atomic-write tests per spec §3.5 + §0.8.
//!
//! Hook scripts read `~/.apohara/sockets/hooks-endpoint.json` on every
//! invocation to refresh PORT/TOKEN. The write must be atomic (tmp +
//! rename) and the file must be 0600 so other local users can't read
//! the bearer token.

use apohara_hooks_server::endpoint_file::{
    delete_if_exists, write_atomic, EndpointDescriptor,
};
use std::os::unix::fs::PermissionsExt;
use tempfile::tempdir;

#[test]
fn write_atomic_creates_file_with_0600_perms() {
    let tmp = tempdir().unwrap();
    let path = tmp.path().join("endpoint.json");
    let desc = EndpointDescriptor {
        port: 12345,
        token: "abc".to_string(),
        started_at: 1000,
    };
    write_atomic(&path, &desc).unwrap();

    let meta = std::fs::metadata(&path).unwrap();
    assert_eq!(meta.permissions().mode() & 0o777, 0o600);

    let content = std::fs::read_to_string(&path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed["port"], 12345);
    assert_eq!(parsed["token"], "abc");
    assert_eq!(parsed["started_at"], 1000);
}

#[test]
fn write_atomic_replaces_existing_atomically() {
    let tmp = tempdir().unwrap();
    let path = tmp.path().join("endpoint.json");
    write_atomic(
        &path,
        &EndpointDescriptor {
            port: 1,
            token: "old".to_string(),
            started_at: 1,
        },
    )
    .unwrap();
    write_atomic(
        &path,
        &EndpointDescriptor {
            port: 2,
            token: "new".to_string(),
            started_at: 2,
        },
    )
    .unwrap();

    let content = std::fs::read_to_string(&path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed["token"], "new");
    assert_eq!(parsed["port"], 2);
    assert_eq!(parsed["started_at"], 2);

    // Replacement must preserve 0600.
    let meta = std::fs::metadata(&path).unwrap();
    assert_eq!(meta.permissions().mode() & 0o777, 0o600);
}

#[test]
fn delete_if_exists_is_idempotent() {
    let tmp = tempdir().unwrap();
    let path = tmp.path().join("endpoint.json");

    // Delete on missing — no error.
    delete_if_exists(&path).unwrap();

    write_atomic(
        &path,
        &EndpointDescriptor {
            port: 1,
            token: "t".to_string(),
            started_at: 0,
        },
    )
    .unwrap();
    delete_if_exists(&path).unwrap();
    assert!(!path.exists());

    // Idempotent — second delete also a no-op.
    delete_if_exists(&path).unwrap();
}

#[tokio::test]
async fn hooks_server_writes_endpoint_file_on_start() {
    use apohara_hooks_server::{HooksServer, ServerConfig};
    use std::sync::Arc;

    let tmp = tempdir().unwrap();
    let old_home = std::env::var("HOME").ok();
    // SAFETY: tests in this binary touch HOME serially because Rust runs
    // `#[tokio::test]`s on a single thread per test by default and we only
    // have one async test in this file. Other tests in this file don't read
    // HOME, so they are not affected.
    std::env::set_var("HOME", tmp.path());

    let config = ServerConfig {
        bearer_token: "secret".to_string(),
        bind_addr: "127.0.0.1:0".parse().unwrap(),
    };
    let server = HooksServer::start(Arc::new(config)).await.unwrap();
    let path = tmp.path().join(".apohara/sockets/hooks-endpoint.json");
    assert!(path.exists(), "endpoint file should be created on start");

    let content = std::fs::read_to_string(&path).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&content).unwrap();
    assert_eq!(parsed["port"], server.bound_addr().port());
    assert_eq!(parsed["token"], "secret");
    assert!(parsed["started_at"].is_i64());

    server.shutdown().await;
    assert!(!path.exists(), "endpoint file should be deleted on shutdown");

    if let Some(h) = old_home {
        std::env::set_var("HOME", h);
    } else {
        std::env::remove_var("HOME");
    }
}
