//! Stage §10.7 — End-to-end agent-hooks integration test.
//!
//! This is the full loopback path a real hook script would walk:
//! 1. Server boots on a random port and publishes the endpoint-discovery
//!    file (`~/.apohara/sockets/hooks-endpoint.json`) atomically with 0600.
//! 2. A "hook script" simulator parses that file to recover `{ port, token }`
//!    — i.e. discovery is exercised, not hardcoded.
//! 3. Several event flavours (PreToolUse, PostToolUse, Stop) get POSTed
//!    to `/event` with the discovered bearer token. Each must return 200
//!    and `{ accepted: true }`.
//! 4. An unauthenticated POST must be rejected with 401 — this is the
//!    auth gate the spec §3.5 requires for the 127.0.0.1 sidecar.
//! 5. Shutdown cleans up the endpoint file (no leftover stale token).
//!
//! Why a cargo integration test (not a `bun:test` spawning the binary):
//! `apohara-hooks-server` is library-only — no `[[bin]]` target exists in
//! its `Cargo.toml`. Spawning would require adding a binary just for the
//! test, which is more surface area without buying coverage. Exercising
//! the library API + a real `reqwest` client over the actual TCP socket
//! covers the same code path with less moving parts (same approach the
//! existing `tests/auth.rs` and `tests/event.rs` use).

use apohara_hooks_server::{HooksServer, ServerConfig};
use std::sync::Arc;
use tempfile::tempdir;

/// Helper: restore `HOME` to its prior value (or unset it) — so this test
/// doesn't leak its tempdir into other tests in the same binary.
struct HomeGuard(Option<std::ffi::OsString>);
impl Drop for HomeGuard {
    fn drop(&mut self) {
        match self.0.take() {
            Some(h) => std::env::set_var("HOME", h),
            None => std::env::remove_var("HOME"),
        }
    }
}
fn override_home(p: &std::path::Path) -> HomeGuard {
    let prev = std::env::var_os("HOME");
    std::env::set_var("HOME", p);
    HomeGuard(prev)
}

#[tokio::test]
async fn end_to_end_hook_event_with_discovery_and_auth_gate() {
    // ---- 1. Boot server with HOME pointing at a tempdir so the endpoint
    //         file lands in an isolated location we can read back.
    let tmp = tempdir().unwrap();
    let _home = override_home(tmp.path());

    let bearer = "e2e-token-abc123";
    let config = ServerConfig {
        bearer_token: bearer.to_string(),
        bind_addr: "127.0.0.1:0".parse().unwrap(),
    };
    let server = HooksServer::start(Arc::new(config)).await.unwrap();

    // ---- 2. Simulate a hook script discovering the endpoint via the
    //         published JSON file. This exercises the discovery contract
    //         end-to-end (server writes → client reads → client connects).
    let endpoint_path = server
        .endpoint_file_path()
        .expect("endpoint file should be published when HOME is set")
        .to_path_buf();
    assert!(
        endpoint_path.exists(),
        "endpoint file must exist on disk after server start"
    );

    let raw = std::fs::read_to_string(&endpoint_path).unwrap();
    let descriptor: serde_json::Value = serde_json::from_str(&raw).unwrap();
    let discovered_port = descriptor["port"].as_u64().expect("port must be a number") as u16;
    let discovered_token = descriptor["token"]
        .as_str()
        .expect("token must be a string")
        .to_string();

    // Discovery must agree with the bound socket + configured token —
    // otherwise hook scripts would connect to the wrong port or fail auth.
    assert_eq!(discovered_port, server.bound_addr().port());
    assert_eq!(discovered_token, bearer);

    let base_url = format!("http://127.0.0.1:{}", discovered_port);
    let client = reqwest::Client::new();

    // ---- 3. Send a PostToolUse event (the most relevant for orchestration
    //         — captures Bash/Read/etc completion in the host CLI agent).
    let post_tool_use = serde_json::json!({
        "type": "post_tool_use",
        "pane_key": "pane-e2e-1",
        "task_id": "task-e2e-001",
        "worktree_id": "swift-falcon-e2e",
        "payload": {
            "tool_name": "Bash",
            "tool_output": { "stdout": "hello\n", "exit_code": 0 },
            "duration_ms": 42,
            "timestamp": 1737562800
        }
    });
    let resp = client
        .post(format!("{}/event", base_url))
        .header("Authorization", format!("Bearer {}", discovered_token))
        .json(&post_tool_use)
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        200,
        "PostToolUse event must be accepted with valid token"
    );
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["accepted"], true);

    // Also exercise PreToolUse and Stop so the test confirms more than
    // one event flavour parses correctly through the tagged-enum path.
    let pre_tool_use = serde_json::json!({
        "type": "pre_tool_use",
        "pane_key": "pane-e2e-1",
        "task_id": "task-e2e-001",
        "worktree_id": "swift-falcon-e2e",
        "payload": {
            "tool_name": "Read",
            "tool_input": { "file_path": "/tmp/foo" },
            "timestamp": 1737562801
        }
    });
    let resp = client
        .post(format!("{}/event", base_url))
        .header("Authorization", format!("Bearer {}", discovered_token))
        .json(&pre_tool_use)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    let stop = serde_json::json!({
        "type": "stop",
        "pane_key": "pane-e2e-1",
        "task_id": "task-e2e-001",
        "worktree_id": "swift-falcon-e2e",
        "payload": {
            "reason": "completed",
            "timestamp": 1737562802
        }
    });
    let resp = client
        .post(format!("{}/event", base_url))
        .header("Authorization", format!("Bearer {}", discovered_token))
        .json(&stop)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);

    // ---- 4. Auth gate: unauthenticated POST must be rejected. This is the
    //         security boundary §3.5 mandates — without it, any local proc
    //         could inject fake hook events into the orchestration stream.
    let resp = client
        .post(format!("{}/event", base_url))
        .json(&post_tool_use)
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        401,
        "auth gate must reject events with no Authorization header"
    );

    let resp = client
        .post(format!("{}/event", base_url))
        .header("Authorization", "Bearer wrong-token")
        .json(&post_tool_use)
        .send()
        .await
        .unwrap();
    assert_eq!(
        resp.status(),
        401,
        "auth gate must reject events with a bogus token"
    );

    // ---- 5. Shutdown must remove the endpoint file so a subsequent boot
    //         doesn't observe a stale token.
    server.shutdown().await;
    assert!(
        !endpoint_path.exists(),
        "endpoint file must be cleaned up on shutdown"
    );
}
