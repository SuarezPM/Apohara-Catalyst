//! Agent-hooks HTTP loopback server per spec §3.5.
//!
//! Sidecar that receives PreToolUse / PostToolUse / Stop / UserPromptSubmit /
//! PermissionRequest events from native CLI agents via hook scripts. Bearer
//! token auth, 127.0.0.1-only bind. Events normalized to JSONL and forwarded
//! to the orchestration DB + tokio broadcast channel.

pub mod auth;
pub mod event;

use auth::{bearer_auth, AuthState};
use axum::{
    extract::State,
    middleware,
    response::Json,
    routing::{get, post},
    Router,
};
use std::net::SocketAddr;
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
    shutdown_tx: Option<oneshot::Sender<()>>,
    handle: tokio::task::JoinHandle<()>,
}

impl HooksServer {
    pub fn bound_addr(&self) -> SocketAddr { self.bound }

    pub async fn shutdown(mut self) {
        if let Some(tx) = self.shutdown_tx.take() { let _ = tx.send(()); }
        let _ = self.handle.await;
    }

    pub async fn start(config: Arc<ServerConfig>) -> Result<Self, HooksError> {
        let auth_state = AuthState { bearer_token: Arc::new(config.bearer_token.clone()) };

        let app = Router::new()
            .route("/health", get(health))
            .route("/event", post(crate::event::handle_event))
            .layer(middleware::from_fn_with_state(auth_state.clone(), bearer_auth))
            .with_state(auth_state);

        let listener = TcpListener::bind(config.bind_addr).await?;
        let bound = listener.local_addr()?;

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
            let _ = axum::serve(listener, app)
                .with_graceful_shutdown(async move { let _ = shutdown_rx.await; })
                .await;
        });

        Ok(Self { bound, shutdown_tx: Some(shutdown_tx), handle })
    }
}

async fn health(State(_state): State<AuthState>) -> Json<serde_json::Value> {
    Json(serde_json::json!({
        "alive": true,
        "ts": chrono::Utc::now().to_rfc3339(),
    }))
}
