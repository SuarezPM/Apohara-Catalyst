use super::durable_prompt::{
    unix_millis_now, DurablePromptStore, PermissionRequest, PermissionResponse, PromptDecision,
    PromptScope,
};
use serde_json::json;
use std::time::Duration;
use tempfile::tempdir;

fn req(id: &str) -> PermissionRequest {
    PermissionRequest {
        request_id: id.to_string(),
        tool: "Bash".to_string(),
        input: json!({"command": "npm test"}),
        suggested_pattern: "Bash(npm test:*)".to_string(),
        available_scopes: vec![PromptScope::Once, PromptScope::Session, PromptScope::Always],
        created_at: unix_millis_now(),
    }
}

fn resp(id: &str) -> PermissionResponse {
    PermissionResponse {
        request_id: id.to_string(),
        decision: PromptDecision::Allow,
        scope: Some(PromptScope::Session),
        pattern: Some("Bash(npm test:*)".to_string()),
    }
}

#[tokio::test]
async fn enqueue_then_pending() {
    let s = DurablePromptStore::new();
    s.enqueue_request(req("r1")).await;
    assert!(s.is_pending("r1").await);
    assert_eq!(s.list_pending().await.len(), 1);
}

#[tokio::test]
async fn set_response_clears_pending_flag() {
    let s = DurablePromptStore::new();
    s.enqueue_request(req("r1")).await;
    s.set_response(resp("r1")).await;
    assert!(!s.is_pending("r1").await);
}

#[tokio::test]
async fn wait_returns_response_immediately_when_set() {
    let s = DurablePromptStore::new();
    s.enqueue_request(req("r1")).await;
    s.set_response(resp("r1")).await;
    let r = s
        .wait_for_response("r1", Duration::from_millis(200), Duration::from_millis(20))
        .await;
    assert!(r.is_some());
}

#[tokio::test]
async fn wait_returns_none_on_timeout_and_drops_pending() {
    let s = DurablePromptStore::new();
    s.enqueue_request(req("r1")).await;
    let r = s
        .wait_for_response("r1", Duration::from_millis(50), Duration::from_millis(10))
        .await;
    assert!(r.is_none());
    assert!(!s.is_pending("r1").await);
}

#[tokio::test]
async fn wait_picks_up_late_response() {
    let s = DurablePromptStore::new();
    s.enqueue_request(req("r1")).await;
    let s2 = s.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(30)).await;
        s2.set_response(resp("r1")).await;
    });
    let r = s
        .wait_for_response("r1", Duration::from_millis(500), Duration::from_millis(10))
        .await;
    assert!(r.is_some());
}

#[tokio::test]
async fn ledger_load_recovers_pending_after_restart() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("prompts.jsonl");
    {
        let s = DurablePromptStore::with_ledger_path(path.clone());
        s.enqueue_request(req("r1")).await;
    }
    // Simulate restart with a fresh store pointed at the same ledger.
    let s2 = DurablePromptStore::with_ledger_path(path.clone());
    s2.load().await.unwrap();
    assert!(s2.is_pending("r1").await);
}

#[tokio::test]
async fn ledger_load_recovers_responded_state() {
    let dir = tempdir().unwrap();
    let path = dir.path().join("prompts.jsonl");
    {
        let s = DurablePromptStore::with_ledger_path(path.clone());
        s.enqueue_request(req("r1")).await;
        s.set_response(resp("r1")).await;
    }
    let s2 = DurablePromptStore::with_ledger_path(path.clone());
    s2.load().await.unwrap();
    // After load, the response is recorded so is_pending should be false
    // (request exists but response also exists).
    assert!(!s2.is_pending("r1").await);
}

#[tokio::test]
async fn load_no_op_when_no_ledger() {
    let s = DurablePromptStore::new();
    assert!(s.load().await.is_ok());
}
