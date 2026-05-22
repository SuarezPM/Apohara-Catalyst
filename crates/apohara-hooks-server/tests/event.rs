use apohara_hooks_server::{HooksServer, ServerConfig};
use std::sync::Arc;

#[tokio::test]
async fn accepts_pre_tool_use_event() {
    let config = ServerConfig {
        bearer_token: "t".to_string(),
        bind_addr: "127.0.0.1:0".parse().unwrap(),
    };
    let server = HooksServer::start(Arc::new(config)).await.unwrap();
    let url = format!("http://{}/event", server.bound_addr());

    let body = serde_json::json!({
        "type": "pre_tool_use",
        "pane_key": "pane-1",
        "task_id": "task-42",
        "worktree_id": "swift-falcon-a3f9c2",
        "payload": {
            "tool_name": "Bash",
            "tool_input": { "command": "ls" },
            "timestamp": 1737562800
        }
    });

    let resp = reqwest::Client::new()
        .post(&url)
        .header("Authorization", "Bearer t")
        .json(&body)
        .send().await.unwrap();
    assert_eq!(resp.status(), 200);

    let body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(body["accepted"], true);

    server.shutdown().await;
}

#[tokio::test]
async fn rejects_unknown_event_type() {
    let config = ServerConfig {
        bearer_token: "t".to_string(),
        bind_addr: "127.0.0.1:0".parse().unwrap(),
    };
    let server = HooksServer::start(Arc::new(config)).await.unwrap();
    let url = format!("http://{}/event", server.bound_addr());

    let body = serde_json::json!({
        "type": "never_heard_of_this",
        "pane_key": "pane-1",
        "payload": {}
    });

    let resp = reqwest::Client::new()
        .post(&url)
        .header("Authorization", "Bearer t")
        .json(&body)
        .send().await.unwrap();
    assert_eq!(resp.status(), 422);

    server.shutdown().await;
}
