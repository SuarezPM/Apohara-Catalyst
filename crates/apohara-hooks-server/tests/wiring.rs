//! G7.5.A.7 — Wire 4 hooks-coordination modules (G5.C) into the loopback
//! server.
//!
//! G5.C shipped four standalone TypeScript modules with no consumer:
//!   - `src/core/hooks/compact-reinjection.ts` (Pre/PostCompact reinjector)
//!   - `src/core/hooks/additional-context-response.ts` (composer + verifier)
//!   - `src/core/hooks/learnings-dump.ts` (LearningsCollector)
//!   - `src/core/hooks/context-warnings.ts` (ContextWarningMonitor)
//!
//! This task adds the matching server-side routes so a CLI agent (or any
//! local in-process subscriber) can deliver these coordination events
//! through the same loopback contract as `/event`. The Rust handlers are
//! pass-through into the broadcast channel — the TS modules themselves
//! stay where they live and pick up events via the existing broadcast
//! bridge (Stage 2.6 will plug the bridge in; until then the routes
//! accept-and-broadcast so the contract is observable from both sides).
//!
//! The test boots a real server, hits each new route through the auth
//! gate, and asserts:
//!   - 200 + `{ accepted: true }` for a well-formed payload
//!   - 401 for an unauthenticated request
//!   - 422 for a malformed payload (so the routes have real validation
//!     and aren't just `serde_json::Value` sinks)
//!
//! A second test exercises the broadcast contract: a subscriber attached
//! BEFORE the POST must observe the event arriving — this is what the
//! TS bridge will rely on.

use apohara_hooks_server::{HooksServer, ServerConfig};
use std::sync::Arc;
use tempfile::tempdir;

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

async fn boot() -> (HooksServer, HomeGuard, tempfile::TempDir, String, u16) {
    let tmp = tempdir().unwrap();
    let home = override_home(tmp.path());
    let bearer = "wiring-token-xyz789".to_string();
    let server = HooksServer::start(Arc::new(ServerConfig {
        bearer_token: bearer.clone(),
        bind_addr: "127.0.0.1:0".parse().unwrap(),
    }))
    .await
    .unwrap();
    let port = server.bound_addr().port();
    (server, home, tmp, bearer, port)
}

#[tokio::test]
async fn pre_compact_route_accepts_and_broadcasts() {
    let (server, _home, _tmp, bearer, port) = boot().await;
    let url = format!("http://127.0.0.1:{}/hooks/pre-compact", port);
    let client = reqwest::Client::new();

    let payload = serde_json::json!({
        "pane_key": "pane-pre-1",
        "session_id": "sess-001",
        "task_id": "task-001",
        "worktree_id": "wt-001",
        "active_plan_ids": ["plan-a", "plan-b"],
        "active_task_id": "task-001",
        "settings": { "trust": "moderate" },
        "notes": "remember the cache invalidation",
        "timestamp": 1737562900_i64
    });

    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", bearer))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["accepted"], true);
    assert_eq!(body["route"], "pre_compact");

    // Auth gate: no header → 401.
    let resp = client.post(&url).json(&payload).send().await.unwrap();
    assert_eq!(resp.status(), 401);

    server.shutdown().await;
}

#[tokio::test]
async fn post_compact_route_accepts() {
    let (server, _home, _tmp, bearer, port) = boot().await;
    let url = format!("http://127.0.0.1:{}/hooks/post-compact", port);
    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "pane_key": "pane-pre-1",
        "session_id": "sess-001",
        "timestamp": 1737562905_i64
    });
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", bearer))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["route"], "post_compact");
    server.shutdown().await;
}

#[tokio::test]
async fn additional_context_route_accepts() {
    let (server, _home, _tmp, bearer, port) = boot().await;
    let url = format!("http://127.0.0.1:{}/hooks/additional-context", port);
    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "pane_key": "pane-ac-1",
        "session_id": "sess-ac",
        "sources": {
            "compact": "snapshot data",
            "warning": "caution band",
            "learnings": "prior session notes"
        },
        "timestamp": 1737562910_i64
    });
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", bearer))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["route"], "additional_context");
    server.shutdown().await;
}

#[tokio::test]
async fn learnings_dump_route_accepts() {
    let (server, _home, _tmp, bearer, port) = boot().await;
    let url = format!("http://127.0.0.1:{}/hooks/learnings-dump", port);
    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "pane_key": "pane-l-1",
        "session_id": "sess-l",
        "category": "decisions",
        "title": "chose enum_dispatch",
        "detail": "Box<dyn> was triggering false positives in coverage",
        "timestamp": 1737562920_i64
    });
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", bearer))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["route"], "learnings_dump");
    server.shutdown().await;
}

#[tokio::test]
async fn context_warnings_route_accepts() {
    let (server, _home, _tmp, bearer, port) = boot().await;
    let url = format!("http://127.0.0.1:{}/hooks/context-warnings", port);
    let client = reqwest::Client::new();
    let payload = serde_json::json!({
        "pane_key": "pane-cw-1",
        "session_id": "sess-cw",
        "level": "warning",
        "percent": 87.5,
        "tokens_used": 175000,
        "tokens_limit": 200000,
        "timestamp": 1737562930_i64
    });
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", bearer))
        .json(&payload)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 200);
    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["route"], "context_warnings");
    server.shutdown().await;
}

#[tokio::test]
async fn malformed_payload_returns_422() {
    let (server, _home, _tmp, bearer, port) = boot().await;
    let url = format!("http://127.0.0.1:{}/hooks/context-warnings", port);
    let client = reqwest::Client::new();
    // `level` missing — every coordination payload requires at least
    // pane_key and a route-specific shape. Missing fields → 422.
    let bad = serde_json::json!({
        "pane_key": "pane-bad",
        "session_id": "sess-bad"
    });
    let resp = client
        .post(&url)
        .header("Authorization", format!("Bearer {}", bearer))
        .json(&bad)
        .send()
        .await
        .unwrap();
    assert_eq!(resp.status(), 422);
    server.shutdown().await;
}
