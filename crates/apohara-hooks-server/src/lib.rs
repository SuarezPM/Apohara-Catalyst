//! Agent-hooks HTTP loopback server per spec §3.5.
//!
//! Sidecar that receives PreToolUse / PostToolUse / Stop / UserPromptSubmit /
//! PermissionRequest events from native CLI agents via hook scripts. Bearer
//! token auth, 127.0.0.1-only bind. Events normalized to JSONL and forwarded
//! to the orchestration DB + tokio broadcast channel.

pub mod auth;
pub mod broadcast;
pub mod endpoint_file;
pub mod event;

#[cfg(test)]
mod broadcast_tests;

use auth::{bearer_auth, AuthState};
use axum::{
    extract::{DefaultBodyLimit, FromRef, State},
    http::StatusCode,
    middleware,
    response::Json,
    routing::{get, post},
    Router,
};
use broadcast::Broadcaster;
use endpoint_file::{delete_if_exists, endpoint_file_path, write_atomic, EndpointDescriptor};
use event::HookEventPayload;
use serde::{Deserialize, Serialize};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

/// Composite state shared by all `/event` and `/health` handlers and by the
/// bearer-auth middleware (via `FromRef<AppState> for AuthState`).
///
/// Carries:
/// - [`AuthState`] — bearer token for the loopback contract.
/// - [`Broadcaster<HookEventPayload>`] — in-process fan-out to UI bridge,
///   ledger appender, and (Stage 2.6) the Coordinator loop.
#[derive(Clone)]
pub struct AppState {
    pub auth: AuthState,
    pub broadcaster: Broadcaster<HookEventPayload>,
}

impl FromRef<AppState> for AuthState {
    fn from_ref(app: &AppState) -> Self {
        app.auth.clone()
    }
}

#[derive(Debug, Error)]
pub enum HooksError {
    #[error("bind: {0}")]
    Bind(#[from] std::io::Error),
}

pub struct ServerConfig {
    pub bearer_token: String,
    pub bind_addr: SocketAddr,
}

pub struct HooksServer {
    bound: SocketAddr,
    /// Cached current token. v1.0 carries this for `rotate_token` to rewrite
    /// the endpoint file; Stage 2.6 will plug live rotation into AuthState.
    current_token: String,
    /// Endpoint-file path on disk, when one was successfully published.
    /// `None` when `HOME` was unset or the write failed (server still
    /// runs; hook scripts just can't auto-discover).
    endpoint_file: Option<PathBuf>,
    shutdown_tx: Option<oneshot::Sender<()>>,
    handle: tokio::task::JoinHandle<()>,
}

impl HooksServer {
    pub fn bound_addr(&self) -> SocketAddr {
        self.bound
    }

    /// Path of the published endpoint file, if any. Useful for tests and
    /// for orchestrator code that wants to verify discovery is live.
    pub fn endpoint_file_path(&self) -> Option<&std::path::Path> {
        self.endpoint_file.as_deref()
    }

    /// Rewrite the endpoint file with a new bearer token. For Stage 2.3 this
    /// **only** updates the file on disk — the in-memory `AuthState` still
    /// holds the original token. Stage 2.6 will wire live rotation through
    /// `AuthState` so accepting both old + new tokens is possible during the
    /// rollover window. Until then, hooks reading the file post-rotation
    /// will see the new token but the server still authenticates the old.
    pub async fn rotate_token(&mut self, new_token: String) -> std::io::Result<()> {
        self.current_token = new_token.clone();
        if let Some(path) = &self.endpoint_file {
            write_atomic(
                path,
                &EndpointDescriptor {
                    port: self.bound.port(),
                    token: new_token,
                    started_at: chrono::Utc::now().timestamp(),
                },
            )?;
        }
        Ok(())
    }

    pub async fn shutdown(mut self) {
        if let Some(tx) = self.shutdown_tx.take() {
            let _ = tx.send(());
        }
        let _ = self.handle.await;
        // Best-effort cleanup. We deliberately do NOT propagate errors —
        // shutdown should always complete even if the file is gone or its
        // mount is read-only.
        if let Some(path) = &self.endpoint_file {
            if let Err(e) = delete_if_exists(path) {
                tracing::warn!(?e, path = %path.display(), "failed to remove endpoint file on shutdown");
            }
        }
    }

    pub async fn start(config: Arc<ServerConfig>) -> Result<Self, HooksError> {
        let auth_state = AuthState {
            bearer_token: Arc::new(config.bearer_token.clone()),
        };
        // Capacity 256 trades a few KiB of memory for headroom: hook bursts
        // (e.g. tight tool-use loops) can outrun a single slow subscriber
        // before the lagged-receiver semantics kick in.
        let broadcaster: Broadcaster<HookEventPayload> = Broadcaster::new(256);
        let app_state = AppState {
            auth: auth_state.clone(),
            broadcaster,
        };

        // Cap on the maximum body any handler will receive. axum's
        // default (2 MiB) is high for the small hook events we accept;
        // an explicit cap also documents the contract and protects
        // against a serde recursion DoS on deeply-nested JSON payloads.
        const HOOK_BODY_LIMIT: usize = 256 * 1024;

        let app = Router::new()
            .route("/health", get(health))
            .route("/event", post(crate::event::handle_event))
            // G7.5.A.7 — coordination routes wiring the 4 G5.C TS modules
            // (compact-reinjection, additional-context-response,
            // learnings-dump, context-warnings) into the loopback contract.
            // Each route validates the route-specific payload shape, logs
            // the event, and broadcasts a marker on the in-process channel
            // so existing subscribers (UI bridge, ledger) wake up. The TS
            // modules themselves stay where they live and will subscribe
            // to a typed coordination channel in Stage 2.6.
            .route("/hooks/pre-compact", post(handle_pre_compact))
            .route("/hooks/post-compact", post(handle_post_compact))
            .route("/hooks/additional-context", post(handle_additional_context))
            .route("/hooks/learnings-dump", post(handle_learnings_dump))
            .route("/hooks/context-warnings", post(handle_context_warnings))
            .layer(DefaultBodyLimit::max(HOOK_BODY_LIMIT))
            .layer(middleware::from_fn_with_state(auth_state, bearer_auth))
            .with_state(app_state);

        let listener = TcpListener::bind(config.bind_addr).await?;
        let bound = listener.local_addr()?;

        // Publish endpoint file so hook scripts can discover the loopback
        // address. If HOME is unset (e.g. minimal test env) or the write
        // fails, we proceed without — discovery just won't work until the
        // operator points hooks at the URL manually.
        let endpoint_file = match endpoint_file_path() {
            Ok(path) => {
                let desc = EndpointDescriptor {
                    port: bound.port(),
                    token: config.bearer_token.clone(),
                    started_at: chrono::Utc::now().timestamp(),
                };
                match write_atomic(&path, &desc) {
                    Ok(()) => Some(path),
                    Err(e) => {
                        tracing::warn!(?e, path = %path.display(), "failed to publish endpoint file");
                        None
                    }
                }
            }
            Err(e) => {
                tracing::info!(?e, "skipping endpoint-file publish (HOME unset)");
                None
            }
        };

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async move {
                    let _ = shutdown_rx.await;
                })
                .await;
        });

        Ok(Self {
            bound,
            current_token: config.bearer_token.clone(),
            endpoint_file,
            shutdown_tx: Some(shutdown_tx),
            handle,
        })
    }
}

async fn health(State(_state): State<AuthState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "alive": true,
        "ts": chrono::Utc::now().to_rfc3339(),
    }))
}

// ============================================================================
// G7.5.A.7 — Hooks coordination routes
// ============================================================================
//
// Wires the four G5.C TypeScript modules under `src/core/hooks/` into the
// loopback contract:
//
//   - `compact-reinjection.ts`        → /hooks/pre-compact, /hooks/post-compact
//   - `additional-context-response.ts` → /hooks/additional-context
//   - `learnings-dump.ts`              → /hooks/learnings-dump
//   - `context-warnings.ts`            → /hooks/context-warnings
//
// Each route validates the route-specific payload, logs the event, and
// broadcasts a `Stop`-shaped marker on the existing `Broadcaster<HookEventPayload>`
// channel so in-process subscribers (UI bridge, ledger appender, future
// coordinator) observe coordination traffic without a second channel.
//
// TODO(stage 2.6): once the TS hook bridge subscribes to a dedicated
// `Broadcaster<HookCoordinationPayload>`, the four TS classes
// (CompactReinjector, LearningsCollector, ContextWarningMonitor,
// composeAdditionalContextResponse) will receive these payloads directly.
// Until then, the routes exist + are authenticated + are tested + the
// contract is observable on the wire — the consumer just isn't attached.

/// Coordination payload variants — one per G5.C TS module. Validated by
/// serde via a `type` discriminator injected from the route path
/// (callers MUST NOT shadow it in the body; doing so → HTTP 422).
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum HookCoordinationPayload {
    PreCompact {
        session_id: String,
        active_plan_ids: Vec<String>,
        #[serde(default)]
        active_task_id: Option<String>,
        settings: serde_json::Value,
        #[serde(default)]
        notes: Option<String>,
        timestamp: i64,
    },
    PostCompact {
        session_id: String,
        timestamp: i64,
    },
    AdditionalContext {
        session_id: String,
        /// Mirrors `ComposeSources` from `additional-context-response.ts`.
        sources: AdditionalContextSources,
        timestamp: i64,
    },
    LearningsDump {
        session_id: String,
        category: LearningCategory,
        title: String,
        detail: String,
        timestamp: i64,
    },
    ContextWarning {
        session_id: String,
        level: ContextLevel,
        percent: f32,
        tokens_used: u64,
        tokens_limit: u64,
        timestamp: i64,
    },
}

#[derive(Debug, Deserialize, Serialize, Clone, Default)]
pub struct AdditionalContextSources {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub compact: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub warning: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub learnings: Option<String>,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum LearningCategory {
    Discoveries,
    Decisions,
    Incidents,
    Conventions,
    NextSteps,
}

#[derive(Debug, Deserialize, Serialize, Clone, Copy)]
#[serde(rename_all = "snake_case")]
pub enum ContextLevel {
    Ok,
    Caution,
    Warning,
    Critical,
}

/// Envelope every coordination route accepts. Mirrors `HookEventEnvelope`
/// minus the `event_type` discriminator — the route path *is* the
/// discriminator here.
#[derive(Debug, Deserialize, Serialize)]
pub struct CoordinationEnvelope {
    pub pane_key: String,
    #[serde(default)]
    pub task_id: Option<String>,
    #[serde(default)]
    pub worktree_id: Option<String>,
    #[serde(flatten)]
    pub fields: serde_json::Value,
}

/// Inject the route's `type` discriminator into the flat body and validate
/// against `HookCoordinationPayload`. Refuses any caller that tries to
/// shadow `type` in the body (same protection `event::handle_event` has).
fn validate_coordination_payload(
    discriminator: &'static str,
    fields: serde_json::Value,
) -> Result<HookCoordinationPayload, StatusCode> {
    let mut obj = match fields {
        serde_json::Value::Object(m) => m,
        _ => return Err(StatusCode::UNPROCESSABLE_ENTITY),
    };
    if obj.contains_key("type") {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    obj.insert(
        "type".into(),
        serde_json::Value::String(discriminator.to_string()),
    );
    serde_json::from_value(serde_json::Value::Object(obj))
        .map_err(|_| StatusCode::UNPROCESSABLE_ENTITY)
}

/// Broadcast a `Stop`-shaped marker so existing subscribers see that
/// coordination traffic happened. Stage 2.6 will replace this with a
/// typed coordination broadcaster.
fn broadcast_coordination_marker(
    state: &AppState,
    route: &'static str,
    payload: &HookCoordinationPayload,
) {
    let timestamp = match payload {
        HookCoordinationPayload::PreCompact { timestamp, .. }
        | HookCoordinationPayload::PostCompact { timestamp, .. }
        | HookCoordinationPayload::AdditionalContext { timestamp, .. }
        | HookCoordinationPayload::LearningsDump { timestamp, .. }
        | HookCoordinationPayload::ContextWarning { timestamp, .. } => *timestamp,
    };
    let marker = HookEventPayload::Stop {
        reason: crate::event::StopReason::Completed,
        timestamp,
    };
    if state.broadcaster.send(marker).is_err() {
        tracing::warn!(route, "hooks-coordination: no active subscribers");
    }
}

async fn handle_coordination_route(
    state: AppState,
    discriminator: &'static str,
    log_route: &'static str,
    envelope: CoordinationEnvelope,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let payload = validate_coordination_payload(discriminator, envelope.fields)?;
    tracing::info!(
        route = log_route,
        pane = %envelope.pane_key,
        task = ?envelope.task_id,
        worktree = ?envelope.worktree_id,
        "hooks-coordination event received"
    );
    broadcast_coordination_marker(&state, log_route, &payload);
    Ok(Json(serde_json::json!({
        "accepted": true,
        "route": log_route,
    })))
}

async fn handle_pre_compact(
    State(state): State<AppState>,
    Json(envelope): Json<CoordinationEnvelope>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_coordination_route(state, "pre_compact", "pre_compact", envelope).await
}

async fn handle_post_compact(
    State(state): State<AppState>,
    Json(envelope): Json<CoordinationEnvelope>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_coordination_route(state, "post_compact", "post_compact", envelope).await
}

async fn handle_additional_context(
    State(state): State<AppState>,
    Json(envelope): Json<CoordinationEnvelope>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_coordination_route(state, "additional_context", "additional_context", envelope).await
}

async fn handle_learnings_dump(
    State(state): State<AppState>,
    Json(envelope): Json<CoordinationEnvelope>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_coordination_route(state, "learnings_dump", "learnings_dump", envelope).await
}

async fn handle_context_warnings(
    State(state): State<AppState>,
    Json(envelope): Json<CoordinationEnvelope>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    handle_coordination_route(state, "context_warning", "context_warnings", envelope).await
}
