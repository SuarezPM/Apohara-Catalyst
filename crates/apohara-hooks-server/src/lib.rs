//! Agent-hooks HTTP loopback server per spec §3.5.
//!
//! Sidecar that receives PreToolUse / PostToolUse / Stop / UserPromptSubmit /
//! PermissionRequest events from native CLI agents via hook scripts. Bearer
//! token auth, 127.0.0.1-only bind. Events normalized to JSONL and forwarded
//! to the orchestration DB + tokio broadcast channel.

pub mod auth;
pub mod endpoint_file;
pub mod event;

use auth::{bearer_auth, AuthState};
use axum::{
    extract::{DefaultBodyLimit, State},
    middleware,
    response::Json,
    routing::{get, post},
    Router,
};
use endpoint_file::{delete_if_exists, endpoint_file_path, write_atomic, EndpointDescriptor};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use thiserror::Error;
use tokio::net::TcpListener;
use tokio::sync::oneshot;

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

        // Cap on the maximum body any handler will receive. axum's
        // default (2 MiB) is high for the small hook events we accept;
        // an explicit cap also documents the contract and protects
        // against a serde recursion DoS on deeply-nested JSON payloads.
        const HOOK_BODY_LIMIT: usize = 256 * 1024;

        let app = Router::new()
            .route("/health", get(health))
            .route("/event", post(crate::event::handle_event))
            .layer(DefaultBodyLimit::max(HOOK_BODY_LIMIT))
            .layer(middleware::from_fn_with_state(auth_state.clone(), bearer_auth))
            .with_state(auth_state);

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
