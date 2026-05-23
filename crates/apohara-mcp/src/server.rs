//! Local-loopback HTTP server hosting MCP tools.
//!
//! Mirrors `src/core/mcp/base/McpServer.ts`. Each server binds 127.0.0.1
//! on the requested port (0 = OS picks free), requires bearer-token
//! auth using constant-time compare, enforces per-server windowed rate
//! limits, bounds the request body, and audits every interaction
//! (auth-denied, rate-limited, unknown tool, OK, server error).
//!
//! Tool handlers are async closures of shape `Map<String, Value> ->
//! Result<Value, McpError>` registered by name. The dispatcher maps
//! `McpValidationError` to HTTP 400 so a caller distinguishes
//! "bad input" from a server-side fault.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;

use axum::{
    body::Bytes,
    extract::State,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde::Deserialize;
use serde_json::{Map, Value};
use subtle::ConstantTimeEq;
use tokio::net::TcpListener;
use tokio::sync::Mutex;
use tokio::task::JoinHandle;

use crate::audit_logger::{AuditEntry, AuditLogger, AuditStatus};
use crate::input_validation::McpValidationError;
use crate::rate_limit::{RateLimitConfig, TokenBucket, DEFAULT_RATE_LIMITS};

const MAX_BODY_BYTES: usize = 64 * 1024;

#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error(transparent)]
    Validation(#[from] McpValidationError),
    #[error("{0}")]
    Other(String),
}

impl McpError {
    pub fn other(msg: impl Into<String>) -> Self {
        Self::Other(msg.into())
    }
}

pub type ToolHandler = Arc<
    dyn Fn(Map<String, Value>) -> futures::future::BoxFuture<'static, Result<Value, McpError>>
        + Send
        + Sync,
>;

pub struct ToolRegistration {
    pub name: String,
    pub handler: ToolHandler,
}

#[derive(Clone)]
pub struct McpServerConfig {
    pub server_name: String,
    pub port: u16,
    pub bearer_token: String,
    pub audit_log_path: std::path::PathBuf,
    pub rate_limits: RateLimitConfig,
}

impl McpServerConfig {
    pub fn new(
        server_name: impl Into<String>,
        port: u16,
        bearer_token: impl Into<String>,
        audit_log_path: impl Into<std::path::PathBuf>,
    ) -> Self {
        Self {
            server_name: server_name.into(),
            port,
            bearer_token: bearer_token.into(),
            audit_log_path: audit_log_path.into(),
            rate_limits: DEFAULT_RATE_LIMITS,
        }
    }
}

/// Inner shared state passed to axum handlers.
struct InnerState {
    config: McpServerConfig,
    tools: HashMap<String, ToolHandler>,
    bucket: Mutex<TokenBucket>,
    audit: AuditLogger,
}

#[derive(Deserialize)]
struct ToolCall {
    tool: Option<String>,
    #[serde(default)]
    input: Option<Value>,
}

pub struct RunningServer {
    pub bound: SocketAddr,
    handle: JoinHandle<()>,
    shutdown: tokio::sync::oneshot::Sender<()>,
}

impl RunningServer {
    pub fn port(&self) -> u16 {
        self.bound.port()
    }

    pub async fn stop(self) {
        let _ = self.shutdown.send(());
        let _ = self.handle.await;
    }
}

pub struct McpServer {
    config: McpServerConfig,
    tools: HashMap<String, ToolHandler>,
}

impl McpServer {
    pub fn new(config: McpServerConfig) -> Self {
        Self {
            config,
            tools: HashMap::new(),
        }
    }

    pub fn register(&mut self, tool: ToolRegistration) -> &mut Self {
        self.tools.insert(tool.name, tool.handler);
        self
    }

    pub async fn start(self) -> std::io::Result<RunningServer> {
        let audit = AuditLogger::new(self.config.audit_log_path.clone());
        let bucket = Mutex::new(TokenBucket::new(self.config.rate_limits));
        let state = Arc::new(InnerState {
            config: self.config.clone(),
            tools: self.tools,
            bucket,
            audit,
        });

        let router = Router::new()
            .route("/", post(dispatch))
            .with_state(state);

        let addr: SocketAddr = format!("127.0.0.1:{}", self.config.port).parse().unwrap();
        let listener = TcpListener::bind(addr).await?;
        let bound = listener.local_addr()?;

        let (tx, rx) = tokio::sync::oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(async move {
                    let _ = rx.await;
                })
                .await;
        });

        Ok(RunningServer {
            bound,
            handle,
            shutdown: tx,
        })
    }
}

fn bearer_equals(provided: &str, expected: &str) -> bool {
    // Pad to the longer of the two so a wrong-length guess is
    // indistinguishable from a wrong-content guess. ConstantTimeEq
    // does the constant-time bit dance.
    let a = provided.as_bytes();
    let b = expected.as_bytes();
    let max_len = a.len().max(b.len());
    let mut pad_a = vec![0u8; max_len];
    let mut pad_b = vec![0u8; max_len];
    pad_a[..a.len()].copy_from_slice(a);
    pad_b[..b.len()].copy_from_slice(b);
    let equal: bool = pad_a.ct_eq(&pad_b).into();
    equal && a.len() == b.len()
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

async fn audit_log(state: &InnerState, tool: &str, status: AuditStatus, detail: Option<String>) {
    let _ = state
        .audit
        .log(&AuditEntry {
            ts: now_ms(),
            server: state.config.server_name.clone(),
            tool: tool.to_string(),
            status,
            detail,
        })
        .await;
}

async fn dispatch(
    State(state): State<Arc<InnerState>>,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    // Bearer auth gate (constant-time compare).
    let auth = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    if !auth.starts_with("Bearer ") || !bearer_equals(&auth[7..], &state.config.bearer_token) {
        audit_log(&state, "<auth>", AuditStatus::Denied, None).await;
        return (StatusCode::UNAUTHORIZED, "Unauthorized").into_response();
    }

    // Rate-limit gate.
    {
        let mut bucket = state.bucket.lock().await;
        if !bucket.try_consume(now_ms()) {
            drop(bucket);
            audit_log(&state, "<rate>", AuditStatus::RateLimited, None).await;
            return (StatusCode::TOO_MANY_REQUESTS, "Rate Limited").into_response();
        }
    }

    if body.len() > MAX_BODY_BYTES {
        return (StatusCode::PAYLOAD_TOO_LARGE, "Payload Too Large").into_response();
    }

    let call: ToolCall = match serde_json::from_slice(&body) {
        Ok(c) => c,
        Err(_) => return (StatusCode::BAD_REQUEST, "Invalid JSON").into_response(),
    };

    let tool_name = match call.tool {
        Some(ref t) if !t.is_empty() => t.clone(),
        _ => {
            audit_log(
                &state,
                "<unknown>",
                AuditStatus::Denied,
                Some("missing tool".to_string()),
            )
            .await;
            return (StatusCode::NOT_FOUND, "Unknown tool").into_response();
        }
    };

    let Some(handler) = state.tools.get(&tool_name).cloned() else {
        audit_log(
            &state,
            &tool_name,
            AuditStatus::Denied,
            Some("unknown tool".to_string()),
        )
        .await;
        return (StatusCode::NOT_FOUND, "Unknown tool").into_response();
    };

    let input_map: Map<String, Value> = match call.input {
        Some(Value::Object(m)) => m,
        Some(Value::Null) | None => Map::new(),
        _ => return (StatusCode::BAD_REQUEST, "input must be object").into_response(),
    };

    match handler(input_map).await {
        Ok(result) => {
            audit_log(&state, &tool_name, AuditStatus::Ok, None).await;
            Json(serde_json::json!({ "result": result })).into_response()
        }
        Err(e) => {
            let (status, detail) = match &e {
                McpError::Validation(v) => (StatusCode::BAD_REQUEST, v.0.clone()),
                McpError::Other(s) => (StatusCode::INTERNAL_SERVER_ERROR, s.clone()),
            };
            audit_log(
                &state,
                &tool_name,
                AuditStatus::Error,
                Some(detail.clone()),
            )
            .await;
            (status, Json(serde_json::json!({ "error": detail }))).into_response()
        }
    }
}

/// Sugar to build a `ToolHandler` from any async closure.
pub fn tool_handler<F, Fut>(f: F) -> ToolHandler
where
    F: Fn(Map<String, Value>) -> Fut + Send + Sync + 'static,
    Fut: std::future::Future<Output = Result<Value, McpError>> + Send + 'static,
{
    Arc::new(move |input| Box::pin(f(input)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use tempfile::TempDir;

    async fn start_test_server(audit_dir: &TempDir) -> (RunningServer, String) {
        let token = "secret".to_string();
        let audit_path = audit_dir.path().join("audit.jsonl");
        let cfg = McpServerConfig::new("apohara.test", 0, &token, audit_path);
        let mut server = McpServer::new(cfg);
        server.register(ToolRegistration {
            name: "echo".to_string(),
            handler: tool_handler(|input| async move { Ok(Value::Object(input)) }),
        });
        server.register(ToolRegistration {
            name: "boom".to_string(),
            handler: tool_handler(|_input| async move { Err(McpError::other("kaboom")) }),
        });
        server.register(ToolRegistration {
            name: "needs_x".to_string(),
            handler: tool_handler(|input| async move {
                let _ = crate::input_validation::require_string(&input, "x")?;
                Ok(json!({"ok": true}))
            }),
        });
        let running = server.start().await.unwrap();
        (running, token)
    }

    async fn post_json(
        url: &str,
        token: Option<&str>,
        body: Value,
    ) -> (StatusCode, String) {
        let client = reqwest::Client::new();
        let mut req = client.post(url).body(body.to_string());
        if let Some(t) = token {
            req = req.header("authorization", format!("Bearer {t}"));
        }
        let resp = req.send().await.unwrap();
        let status = resp.status();
        let text = resp.text().await.unwrap();
        (
            StatusCode::from_u16(status.as_u16()).unwrap(),
            text,
        )
    }

    #[tokio::test]
    async fn rejects_missing_bearer() {
        let tmp = TempDir::new().unwrap();
        let (server, _token) = start_test_server(&tmp).await;
        let url = format!("http://{}/", server.bound);
        let (status, _body) = post_json(&url, None, json!({"tool": "echo"})).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        server.stop().await;
    }

    #[tokio::test]
    async fn rejects_wrong_bearer() {
        let tmp = TempDir::new().unwrap();
        let (server, _token) = start_test_server(&tmp).await;
        let url = format!("http://{}/", server.bound);
        let (status, _) = post_json(&url, Some("nope"), json!({"tool": "echo"})).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        server.stop().await;
    }

    #[tokio::test]
    async fn accepts_correct_bearer_and_echoes() {
        let tmp = TempDir::new().unwrap();
        let (server, token) = start_test_server(&tmp).await;
        let url = format!("http://{}/", server.bound);
        let (status, body) =
            post_json(&url, Some(&token), json!({"tool": "echo", "input": {"a": 1}})).await;
        assert_eq!(status, StatusCode::OK);
        let parsed: Value = serde_json::from_str(&body).unwrap();
        assert_eq!(parsed["result"]["a"], 1);
        server.stop().await;
    }

    #[tokio::test]
    async fn unknown_tool_404s() {
        let tmp = TempDir::new().unwrap();
        let (server, token) = start_test_server(&tmp).await;
        let url = format!("http://{}/", server.bound);
        let (status, _) =
            post_json(&url, Some(&token), json!({"tool": "ghost", "input": {}})).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        server.stop().await;
    }

    #[tokio::test]
    async fn missing_tool_field_404s() {
        let tmp = TempDir::new().unwrap();
        let (server, token) = start_test_server(&tmp).await;
        let url = format!("http://{}/", server.bound);
        let (status, _) = post_json(&url, Some(&token), json!({})).await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        server.stop().await;
    }

    #[tokio::test]
    async fn handler_validation_error_maps_to_400() {
        let tmp = TempDir::new().unwrap();
        let (server, token) = start_test_server(&tmp).await;
        let url = format!("http://{}/", server.bound);
        // needs_x requires x; omitting it yields McpValidationError → 400.
        let (status, body) =
            post_json(&url, Some(&token), json!({"tool": "needs_x", "input": {}})).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(body.contains("expected string 'x'"));
        server.stop().await;
    }

    #[tokio::test]
    async fn handler_other_error_maps_to_500() {
        let tmp = TempDir::new().unwrap();
        let (server, token) = start_test_server(&tmp).await;
        let url = format!("http://{}/", server.bound);
        let (status, body) =
            post_json(&url, Some(&token), json!({"tool": "boom", "input": {}})).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert!(body.contains("kaboom"));
        server.stop().await;
    }

    #[tokio::test]
    async fn invalid_json_returns_400() {
        let tmp = TempDir::new().unwrap();
        let (server, token) = start_test_server(&tmp).await;
        let url = format!("http://{}/", server.bound);
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("authorization", format!("Bearer {}", token))
            .body("not json {")
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status().as_u16(), 400);
        server.stop().await;
    }

    #[tokio::test]
    async fn oversized_body_returns_413() {
        let tmp = TempDir::new().unwrap();
        let (server, token) = start_test_server(&tmp).await;
        let url = format!("http://{}/", server.bound);
        let huge = "x".repeat(MAX_BODY_BYTES + 1);
        let client = reqwest::Client::new();
        let resp = client
            .post(&url)
            .header("authorization", format!("Bearer {}", token))
            .body(huge)
            .send()
            .await
            .unwrap();
        assert_eq!(resp.status().as_u16(), 413);
        server.stop().await;
    }

    #[test]
    fn bearer_equals_constant_time_basics() {
        assert!(bearer_equals("abc", "abc"));
        assert!(!bearer_equals("abc", "abcd"));
        assert!(!bearer_equals("abc", "abd"));
        assert!(!bearer_equals("", "x"));
        assert!(bearer_equals("", ""));
    }
}
