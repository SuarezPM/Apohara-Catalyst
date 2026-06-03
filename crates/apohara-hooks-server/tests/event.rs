use apohara_hooks_server::{HooksServer, ServerConfig};
use std::sync::Arc;

#[tokio::test]
async fn accepts_pre_tool_use_event() {
    let config = ServerConfig {
        bearer_token: "t".to_string(),
        bind_addr: "127.0.0.1:0".parse().unwrap(),
        mailbox_root: None,
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

/// The native handshake: the hook scripts derive `type` from Claude Code's
/// `hook_event_name` and forward CC's *raw* stdin object as the nested
/// `payload`. That payload carries `session_id`/`cwd`/`hook_event_name`,
/// names the field `tool_response` (not `tool_output`), and omits
/// `duration_ms`/`timestamp`. This must validate to 200 — not the 422 the
/// review caught — so we exercise the exact envelopes the scripts POST.
#[tokio::test]
async fn accepts_native_claude_code_handshake_payloads() {
    let config = ServerConfig {
        bearer_token: "t".to_string(),
        bind_addr: "127.0.0.1:0".parse().unwrap(),
        mailbox_root: None,
    };
    let server = HooksServer::start(Arc::new(config)).await.unwrap();
    let url = format!("http://{}/event", server.bound_addr());
    let client = reqwest::Client::new();

    // PreToolUse — derived type "pre_tool_use", payload is CC's raw stdin.
    let pre_tool_use = serde_json::json!({
        "type": "pre_tool_use",
        "pane_key": "pane-1",
        "task_id": "",
        "worktree_id": "",
        "payload": {
            "session_id": "abc123",
            "transcript_path": "/home/u/.claude/projects/x/transcript.jsonl",
            "cwd": "/home/u/proj",
            "permission_mode": "default",
            "hook_event_name": "PreToolUse",
            "tool_name": "Bash",
            "tool_input": { "command": "npm test" }
        }
    });

    // PostToolUse — CC names the result `tool_response` and ships neither
    // `duration_ms` nor `timestamp`. This is the shape that produced the 422.
    let post_tool_use = serde_json::json!({
        "type": "post_tool_use",
        "pane_key": "pane-1",
        "task_id": "",
        "worktree_id": "",
        "payload": {
            "session_id": "abc123",
            "cwd": "/home/u/proj",
            "hook_event_name": "PostToolUse",
            "tool_name": "Bash",
            "tool_input": { "command": "git status" },
            "tool_response": { "stdout": "clean", "stderr": "", "exit_code": 0 }
        }
    });

    // Stop — CC sends no `reason`/`timestamp`.
    let stop = serde_json::json!({
        "type": "stop",
        "pane_key": "pane-1",
        "task_id": "",
        "worktree_id": "",
        "payload": {
            "session_id": "abc123",
            "hook_event_name": "Stop"
        }
    });

    // UserPromptSubmit — only `prompt` guaranteed.
    let user_prompt = serde_json::json!({
        "type": "user_prompt_submit",
        "pane_key": "pane-1",
        "task_id": "",
        "worktree_id": "",
        "payload": {
            "session_id": "abc123",
            "hook_event_name": "UserPromptSubmit",
            "prompt": "build the thing"
        }
    });

    for body in [pre_tool_use, post_tool_use, stop, user_prompt] {
        let event_type = body["type"].as_str().unwrap().to_string();
        let resp = client
            .post(&url)
            .header("Authorization", "Bearer t")
            .json(&body)
            .send()
            .await
            .unwrap();
        assert_eq!(
            resp.status(),
            200,
            "native handshake for {event_type} must be accepted (200), not 422"
        );
        let body: serde_json::Value = resp.json().await.unwrap();
        assert_eq!(body["accepted"], true);
    }

    server.shutdown().await;
}

#[tokio::test]
async fn rejects_unknown_event_type() {
    let config = ServerConfig {
        bearer_token: "t".to_string(),
        bind_addr: "127.0.0.1:0".parse().unwrap(),
        mailbox_root: None,
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

/// US-F2.3: with a mailbox configured, a PreToolUse event peeks the blade's
/// inbox and returns the pending messages as `additionalContext` (push path),
/// WITHOUT draining them (ack-before-clear) — the poll fallback still works.
#[tokio::test]
async fn pre_tool_use_returns_mailbox_push_context() {
    let dir = tempfile::tempdir().unwrap();
    let mailbox_root = dir.path().join("mailbox");

    // Seed a message addressed to the blade whose pane_key the hook carries.
    let mailbox = apohara_dispatch::Mailbox::new(&mailbox_root);
    mailbox
        .send(apohara_dispatch::Message {
            id: String::new(),
            from: "codex".to_string(),
            to: "claude-blade".to_string(),
            body: "rebase onto my refactor".to_string(),
            ts: 1,
        })
        .unwrap();

    let config = ServerConfig {
        bearer_token: "t".to_string(),
        bind_addr: "127.0.0.1:0".parse().unwrap(),
        mailbox_root: Some(mailbox_root.clone()),
    };
    let server = HooksServer::start(Arc::new(config)).await.unwrap();
    let url = format!("http://{}/event", server.bound_addr());

    let body = serde_json::json!({
        "type": "pre_tool_use",
        "pane_key": "claude-blade",
        "payload": { "tool_name": "Edit", "tool_input": {} }
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .header("Authorization", "Bearer t")
        .json(&body)
        .send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let resp_body: serde_json::Value = resp.json().await.unwrap();
    assert_eq!(resp_body["accepted"], true);
    let ctx = resp_body["additionalContext"].as_str().expect("push additionalContext present");
    assert!(ctx.contains("rebase onto my refactor"), "push must carry the mesh message");
    assert!(resp_body["pendingMessageIds"].as_array().unwrap().len() == 1);

    // ack-before-clear: peek did NOT drain — the poll fallback still delivers.
    let still_there = mailbox.check_inbox("claude-blade").unwrap();
    assert_eq!(still_there.len(), 1, "push peek must not drain (poll fallback intact)");

    server.shutdown().await;
}

/// US-S5: the F2.3 push fires under the live mesh body's SINGLE IDENTITY (D5) —
/// the recipient and the PreToolUse `pane_key` are both the DAG NODE ID (e.g.
/// `impl-src-auth-rs`), not `{provider}-{seq}`. A message addressed to the node
/// id comes back as `additionalContext` on that node's PreToolUse, and a lost
/// push (peek, no ack) still drains via `check_inbox` (poll fallback).
#[tokio::test]
async fn mesh_push_delivered_under_node_id_identity() {
    let dir = tempfile::tempdir().unwrap();
    // The mesh layout: the mailbox lives at `<repo>/.apohara/mailbox`, the SAME
    // root the dispatch loop + FsMeshBackend use (hooks_bridge.rs convention).
    let mailbox_root = dir.path().join(".apohara").join("mailbox");
    // The single identity: a real master-plan DAG node id.
    let node_id = "impl-src-auth-rs";

    let mailbox = apohara_dispatch::Mailbox::new(&mailbox_root);
    mailbox
        .send(apohara_dispatch::Message {
            id: String::new(),
            from: "integrate".to_string(),
            to: node_id.to_string(),
            body: "the shared types landed; rebase your slice".to_string(),
            ts: 7,
        })
        .unwrap();

    let config = ServerConfig {
        bearer_token: "t".to_string(),
        bind_addr: "127.0.0.1:0".parse().unwrap(),
        mailbox_root: Some(mailbox_root.clone()),
    };
    let server = HooksServer::start(Arc::new(config)).await.unwrap();
    let url = format!("http://{}/event", server.bound_addr());

    // PreToolUse with pane_key == the DAG node id (what spawn_blade sets).
    let body = serde_json::json!({
        "type": "pre_tool_use",
        "pane_key": node_id,
        "payload": { "tool_name": "Edit", "tool_input": {} }
    });
    let resp = reqwest::Client::new()
        .post(&url)
        .header("Authorization", "Bearer t")
        .json(&body)
        .send().await.unwrap();
    assert_eq!(resp.status(), 200);
    let resp_body: serde_json::Value = resp.json().await.unwrap();
    let ctx = resp_body["additionalContext"]
        .as_str()
        .expect("push additionalContext present under the node-id identity");
    assert!(ctx.contains("rebase your slice"), "the node's message must be pushed");
    assert_eq!(
        resp_body["pendingMessageIds"].as_array().unwrap().len(),
        1,
        "exactly one pending message id for this node"
    );

    // Lost push (peek, no ack) → check_inbox still drains it (poll fallback).
    let drained = mailbox.check_inbox(node_id).unwrap();
    assert_eq!(drained.len(), 1, "a lost push is recovered by the poll fallback");
    assert_eq!(drained[0].body, "the shared types landed; rebase your slice");

    server.shutdown().await;
}
