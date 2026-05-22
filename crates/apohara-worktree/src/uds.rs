//! Unix Domain Socket server per spec §3.1.
//!
//! Newline-delimited JSON-RPC. Method dispatch: ping (Stage 4.8 only).
//! Stages 4.16+ wire create / list / cleanup / merge / preserve_on_fail /
//! adopt_orphan / prune_stale / delete_preflight / set_lineage methods.

use serde::Deserialize;
use std::path::PathBuf;
use thiserror::Error;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};
use tokio::sync::oneshot;

#[derive(Debug, Error)]
pub enum UdsError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
}

pub struct ServerConfig {
    pub socket_path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct Request {
    method: String,
    #[serde(default)]
    #[allow(dead_code)]
    params: serde_json::Value,
}

pub struct UdsServer {
    shutdown_tx: Option<oneshot::Sender<()>>,
    handle: tokio::task::JoinHandle<()>,
}

impl UdsServer {
    pub async fn start(config: ServerConfig) -> Result<Self, UdsError> {
        if config.socket_path.exists() { let _ = std::fs::remove_file(&config.socket_path); }
        let listener = UnixListener::bind(&config.socket_path)?;
        let (shutdown_tx, mut shutdown_rx) = oneshot::channel::<()>();
        let handle = tokio::spawn(async move {
            loop {
                tokio::select! {
                    _ = &mut shutdown_rx => break,
                    Ok((stream, _)) = listener.accept() => {
                        tokio::spawn(handle_connection(stream));
                    }
                }
            }
        });
        Ok(Self { shutdown_tx: Some(shutdown_tx), handle })
    }

    pub async fn shutdown(mut self) {
        if let Some(tx) = self.shutdown_tx.take() { let _ = tx.send(()); }
        let _ = self.handle.await;
    }
}

async fn handle_connection(stream: UnixStream) {
    let (read_half, mut write_half) = stream.into_split();
    let mut lines = BufReader::new(read_half).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        if line.trim().is_empty() { continue; }
        let resp = match serde_json::from_str::<Request>(&line) {
            Ok(req) => dispatch(req).await,
            Err(e) => serde_json::json!({ "error": format!("parse: {}", e) }),
        };
        let mut bytes = serde_json::to_vec(&resp).unwrap();
        bytes.push(b'\n');
        if write_half.write_all(&bytes).await.is_err() { break; }
    }
}

async fn dispatch(req: Request) -> serde_json::Value {
    match req.method.as_str() {
        "ping" => serde_json::json!({ "result": { "ok": true } }),
        other => serde_json::json!({ "error": format!("unknown method: {}", other) }),
    }
}