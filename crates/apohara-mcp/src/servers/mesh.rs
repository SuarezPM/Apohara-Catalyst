//! apohara.mesh MCP server (US-F0.2).
//!
//! Exposes the BYOC mesh bus as six tools: get_tasks / claim_task /
//! release_task / report_result / send_message / check_inbox. Heterogeneous
//! CLI blades (claude / codex / opencode) are separate OS processes that
//! coordinate through this loopback bus instead of a shared in-process state.
//!
//! Backed by a trait so this crate stays decoupled from the orchestration
//! claim store (`apohara-dispatch`). The cli/desktop binary wires a concrete
//! adapter in F1.4 that maps `ClaimOutcome::Acquired{token}` → `Some(token)`,
//! `AlreadyClaimed` → `None`, `ReportOutcome::Accepted/StaleToken` →
//! `true`/`false` — the trait shape below makes that mapping trivial.

use std::sync::Arc;

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use serde_json::json;

use crate::input_validation::{optional_string, require_string};
use crate::server::{tool_handler, McpError, ToolRegistration};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MeshTask {
    pub id: String,
    pub title: String,
    pub state: String,
    pub deps: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct MeshMessage {
    pub from: String,
    pub to: String,
    pub body: String,
    pub ts: i64,
}

#[async_trait]
pub trait MeshBackend: Send + Sync {
    async fn get_tasks(&self) -> Result<Vec<MeshTask>, String>;

    /// Atomic cross-process claim. `Ok(Some(token))` = this caller won the
    /// race and must carry the token forward to `report_result`; `Ok(None)`
    /// = another blade already holds the task (a clean signal, not an error).
    async fn claim_task(&self, task_id: &str, blade: &str) -> Result<Option<String>, String>;

    async fn release_task(&self, task_id: &str) -> Result<(), String>;

    /// Report a result against the claim identified by `token`. `Ok(true)` =
    /// the token matched the live claim and the result is authoritative;
    /// `Ok(false)` = stale token (the claimer was reaped and the task
    /// re-claimed), so a zombie cannot overwrite the current claimer's work.
    async fn report_result(
        &self,
        task_id: &str,
        token: &str,
        success: bool,
        output: Option<String>,
    ) -> Result<bool, String>;

    async fn send_message(&self, msg: MeshMessage) -> Result<(), String>;

    async fn check_inbox(&self, blade: &str) -> Result<Vec<MeshMessage>, String>;
}

pub fn build_mesh_tools(backend: Arc<dyn MeshBackend>) -> Vec<ToolRegistration> {
    let b1 = Arc::clone(&backend);
    let b2 = Arc::clone(&backend);
    let b3 = Arc::clone(&backend);
    let b4 = Arc::clone(&backend);
    let b5 = Arc::clone(&backend);
    let b6 = Arc::clone(&backend);
    vec![
        ToolRegistration {
            name: "get_tasks".to_string(),
            handler: tool_handler(move |_input| {
                let backend = Arc::clone(&b1);
                async move {
                    let tasks = backend.get_tasks().await.map_err(McpError::other)?;
                    Ok(json!({ "tasks": tasks }))
                }
            }),
        },
        ToolRegistration {
            name: "claim_task".to_string(),
            handler: tool_handler(move |input| {
                let backend = Arc::clone(&b2);
                async move {
                    let task_id = require_string(&input, "taskId")?;
                    let blade = require_string(&input, "blade")?;
                    let token = backend
                        .claim_task(&task_id, &blade)
                        .await
                        .map_err(McpError::other)?;
                    Ok(json!({
                        "acquired": token.is_some(),
                        "token": token,
                    }))
                }
            }),
        },
        ToolRegistration {
            name: "release_task".to_string(),
            handler: tool_handler(move |input| {
                let backend = Arc::clone(&b3);
                async move {
                    let task_id = require_string(&input, "taskId")?;
                    backend
                        .release_task(&task_id)
                        .await
                        .map_err(McpError::other)?;
                    Ok(json!({ "released": true }))
                }
            }),
        },
        ToolRegistration {
            name: "report_result".to_string(),
            handler: tool_handler(move |input| {
                let backend = Arc::clone(&b4);
                async move {
                    let task_id = require_string(&input, "taskId")?;
                    let token = require_string(&input, "token")?;
                    let success = require_bool(&input, "success")?;
                    let output = optional_string(&input, "output")?;
                    let accepted = backend
                        .report_result(&task_id, &token, success, output)
                        .await
                        .map_err(McpError::other)?;
                    Ok(json!({ "accepted": accepted }))
                }
            }),
        },
        ToolRegistration {
            name: "send_message".to_string(),
            handler: tool_handler(move |input| {
                let backend = Arc::clone(&b5);
                async move {
                    let from = require_string(&input, "from")?;
                    let to = require_string(&input, "to")?;
                    let body = require_string(&input, "body")?;
                    // Mint the timestamp server-side so callers can't forge
                    // ordering (mirrors `server.rs::now_ms`).
                    let msg = MeshMessage {
                        from,
                        to,
                        body,
                        ts: chrono::Utc::now().timestamp_millis(),
                    };
                    backend.send_message(msg).await.map_err(McpError::other)?;
                    Ok(json!({ "sent": true }))
                }
            }),
        },
        ToolRegistration {
            name: "check_inbox".to_string(),
            handler: tool_handler(move |input| {
                let backend = Arc::clone(&b6);
                async move {
                    let blade = require_string(&input, "blade")?;
                    let messages = backend.check_inbox(&blade).await.map_err(McpError::other)?;
                    Ok(json!({ "messages": messages }))
                }
            }),
        },
    ]
}

/// Require a boolean field. Mirrors `input_validation::require_string` —
/// rejects missing, null, and non-bool. Kept local because `success` is the
/// only boolean argument across the built-in servers.
fn require_bool(
    obj: &serde_json::Map<String, serde_json::Value>,
    key: &str,
) -> Result<bool, McpError> {
    match obj.get(key) {
        Some(serde_json::Value::Bool(b)) => Ok(*b),
        _ => Err(McpError::Validation(
            crate::input_validation::McpValidationError::new(format!("expected bool '{key}'")),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{Map, Value};
    use std::collections::HashMap;
    use std::sync::Mutex;

    /// In-memory mesh backend modeling the real claim/inbox semantics:
    /// a task can be claimed once (2nd claim of the same id → None),
    /// `report_result` accepts only the matching token, and each recipient
    /// has a drainable inbox.
    #[derive(Default)]
    struct StubMesh {
        tasks: Mutex<Vec<MeshTask>>,
        /// task_id → live claim token.
        claims: Mutex<HashMap<String, String>>,
        /// recipient blade → queued messages.
        inboxes: Mutex<HashMap<String, Vec<MeshMessage>>>,
    }

    #[async_trait]
    impl MeshBackend for StubMesh {
        async fn get_tasks(&self) -> Result<Vec<MeshTask>, String> {
            Ok(self.tasks.lock().unwrap().clone())
        }

        async fn claim_task(&self, task_id: &str, _blade: &str) -> Result<Option<String>, String> {
            let mut claims = self.claims.lock().unwrap();
            if claims.contains_key(task_id) {
                return Ok(None);
            }
            let token = format!("tok-{task_id}");
            claims.insert(task_id.to_string(), token.clone());
            Ok(Some(token))
        }

        async fn release_task(&self, task_id: &str) -> Result<(), String> {
            self.claims.lock().unwrap().remove(task_id);
            Ok(())
        }

        async fn report_result(
            &self,
            task_id: &str,
            token: &str,
            _success: bool,
            _output: Option<String>,
        ) -> Result<bool, String> {
            let claims = self.claims.lock().unwrap();
            Ok(claims.get(task_id).map(|t| t == token).unwrap_or(false))
        }

        async fn send_message(&self, msg: MeshMessage) -> Result<(), String> {
            self.inboxes
                .lock()
                .unwrap()
                .entry(msg.to.clone())
                .or_default()
                .push(msg);
            Ok(())
        }

        async fn check_inbox(&self, blade: &str) -> Result<Vec<MeshMessage>, String> {
            Ok(self
                .inboxes
                .lock()
                .unwrap()
                .remove(blade)
                .unwrap_or_default())
        }
    }

    fn find<'a>(tools: &'a [ToolRegistration], name: &str) -> &'a ToolRegistration {
        tools.iter().find(|t| t.name == name).unwrap()
    }

    // ---- Unit-level: call the handlers directly (like ledger's tests) ----

    #[tokio::test]
    async fn claim_task_requires_taskid_and_blade() {
        let tools = build_mesh_tools(Arc::new(StubMesh::default()));
        let claim = find(&tools, "claim_task");
        let err = (claim.handler)(Map::new()).await.unwrap_err();
        assert!(matches!(err, McpError::Validation(_)));
    }

    #[tokio::test]
    async fn claim_task_acquires_then_rejects_second_claim() {
        let tools = build_mesh_tools(Arc::new(StubMesh::default()));
        let claim = find(&tools, "claim_task");

        let mut input = Map::new();
        input.insert("taskId".into(), Value::String("t1".into()));
        input.insert("blade".into(), Value::String("codex".into()));

        let first = (claim.handler)(input.clone()).await.unwrap();
        assert_eq!(first["acquired"], true);
        assert!(first["token"].is_string());

        // Second claim of the same task is a clean "already claimed".
        let second = (claim.handler)(input).await.unwrap();
        assert_eq!(second["acquired"], false);
        assert!(second["token"].is_null());
    }

    #[tokio::test]
    async fn report_result_requires_success_bool() {
        let tools = build_mesh_tools(Arc::new(StubMesh::default()));
        let report = find(&tools, "report_result");
        let mut input = Map::new();
        input.insert("taskId".into(), Value::String("t1".into()));
        input.insert("token".into(), Value::String("tok".into()));
        // `success` omitted → validation error.
        let err = (report.handler)(input).await.unwrap_err();
        assert!(matches!(err, McpError::Validation(_)));
    }

    #[tokio::test]
    async fn report_result_rejects_stale_token() {
        let backend = Arc::new(StubMesh::default());
        let tools = build_mesh_tools(backend);
        let claim = find(&tools, "claim_task");
        let report = find(&tools, "report_result");

        let mut claim_in = Map::new();
        claim_in.insert("taskId".into(), Value::String("t1".into()));
        claim_in.insert("blade".into(), Value::String("codex".into()));
        let claimed = (claim.handler)(claim_in).await.unwrap();
        let token = claimed["token"].as_str().unwrap().to_string();

        // Matching token is accepted.
        let mut ok_in = Map::new();
        ok_in.insert("taskId".into(), Value::String("t1".into()));
        ok_in.insert("token".into(), Value::String(token));
        ok_in.insert("success".into(), Value::Bool(true));
        let ok = (report.handler)(ok_in).await.unwrap();
        assert_eq!(ok["accepted"], true);

        // A wrong token (stale/reaped claimer) is rejected.
        let mut stale_in = Map::new();
        stale_in.insert("taskId".into(), Value::String("t1".into()));
        stale_in.insert("token".into(), Value::String("WRONG".into()));
        stale_in.insert("success".into(), Value::Bool(true));
        let stale = (report.handler)(stale_in).await.unwrap();
        assert_eq!(stale["accepted"], false);
    }

    #[tokio::test]
    async fn send_message_then_check_inbox_roundtrips() {
        let backend = Arc::new(StubMesh::default());
        let tools = build_mesh_tools(backend);
        let send = find(&tools, "send_message");
        let inbox = find(&tools, "check_inbox");

        let mut send_in = Map::new();
        send_in.insert("from".into(), Value::String("codex".into()));
        send_in.insert("to".into(), Value::String("claude".into()));
        send_in.insert("body".into(), Value::String("hi".into()));
        let sent = (send.handler)(send_in).await.unwrap();
        assert_eq!(sent["sent"], true);

        let mut inbox_in = Map::new();
        inbox_in.insert("blade".into(), Value::String("claude".into()));
        let out = (inbox.handler)(inbox_in).await.unwrap();
        let msgs = out["messages"].as_array().unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0]["from"], "codex");
        assert_eq!(msgs[0]["body"], "hi");
        // Timestamp was minted server-side.
        assert!(msgs[0]["ts"].as_i64().unwrap() > 0);
    }

    // ---- HTTP-level: drive a real bound McpServer over reqwest ----

    async fn start_mesh_server(
        audit_dir: &tempfile::TempDir,
    ) -> (crate::server::RunningServer, String) {
        use crate::server::{McpServer, McpServerConfig};
        let token = "secret".to_string();
        let audit_path = audit_dir.path().join("audit.jsonl");
        let cfg = McpServerConfig::new("apohara.mesh", 0, &token, audit_path);
        let mut server = McpServer::new(cfg);
        for tool in build_mesh_tools(Arc::new(StubMesh::default())) {
            server.register(tool);
        }
        let running = server.start().await.unwrap();
        (running, token)
    }

    async fn post_json(url: &str, token: &str, body: Value) -> (u16, Value) {
        let client = reqwest::Client::new();
        let resp = client
            .post(url)
            .header("authorization", format!("Bearer {token}"))
            .body(body.to_string())
            .send()
            .await
            .unwrap();
        let status = resp.status().as_u16();
        let parsed: Value = serde_json::from_str(&resp.text().await.unwrap()).unwrap();
        (status, parsed)
    }

    #[tokio::test]
    async fn http_claim_send_inbox_and_stale_token_flow() {
        let tmp = tempfile::TempDir::new().unwrap();
        let (server, token) = start_mesh_server(&tmp).await;
        let url = format!("http://{}/", server.bound);

        // (a) Claim a task → acquired + non-null token.
        let (status, body) = post_json(
            &url,
            &token,
            json!({"tool": "claim_task", "input": {"taskId": "t1", "blade": "codex"}}),
        )
        .await;
        assert_eq!(status, 200);
        assert_eq!(body["result"]["acquired"], true);
        let claim_token = body["result"]["token"].as_str().unwrap().to_string();
        assert!(!claim_token.is_empty());

        // Same task claimed again → acquired == false.
        let (_, body) = post_json(
            &url,
            &token,
            json!({"tool": "claim_task", "input": {"taskId": "t1", "blade": "claude"}}),
        )
        .await;
        assert_eq!(body["result"]["acquired"], false);

        // (b) Send a message and the recipient receives it via check_inbox.
        let (_, body) = post_json(
            &url,
            &token,
            json!({"tool": "send_message", "input": {"from": "codex", "to": "claude", "body": "hi"}}),
        )
        .await;
        assert_eq!(body["result"]["sent"], true);

        let (_, body) = post_json(
            &url,
            &token,
            json!({"tool": "check_inbox", "input": {"blade": "claude"}}),
        )
        .await;
        let msgs = body["result"]["messages"].as_array().unwrap();
        assert_eq!(msgs.len(), 1);
        assert_eq!(msgs[0]["body"], "hi");

        // (c) report_result with a WRONG token is rejected as stale.
        let (status, body) = post_json(
            &url,
            &token,
            json!({"tool": "report_result", "input": {"taskId": "t1", "token": "WRONG", "success": true}}),
        )
        .await;
        assert_eq!(status, 200);
        assert_eq!(body["result"]["accepted"], false);

        server.stop().await;
    }
}
