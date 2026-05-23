//! SSH server skeleton built on `russh`.
//!
//! Binding is hard-coded to `127.0.0.1` (loopback only). The port is
//! kernel-assigned (`:0`) so tests get a stable, unprivileged port without
//! collisions. The bound port is then published via the endpoint file.
//!
//! Only the listener bootstrap lives here; auth, handshake and dispatch live
//! in their own modules to keep this file diffable.

use std::net::SocketAddr;
use std::sync::Arc;
use thiserror::Error;
use tokio::net::TcpListener;

#[derive(Debug, Error)]
pub enum ServerStartError {
    #[error("only 127.0.0.1 is allowed; got {0}")]
    InvalidBindHost(String),
    #[error("bind: {0}")]
    Bind(#[from] std::io::Error),
}

#[derive(Debug, Clone)]
pub struct ServerConfig {
    /// Must be `127.0.0.1`.
    pub host: String,
    /// `0` requests a kernel-assigned port (recommended for tests).
    pub port: u16,
}

impl Default for ServerConfig {
    fn default() -> Self {
        Self { host: "127.0.0.1".into(), port: 0 }
    }
}

#[derive(Debug)]
pub struct ServerHandle {
    pub bound_addr: SocketAddr,
    pub listener: Arc<TcpListener>,
}

impl ServerHandle {
    /// Bind a TCP listener for the SSH server. Refuses any non-loopback host.
    ///
    /// This does NOT yet drive the russh state machine — that lives behind
    /// G6.C.2 (auth) once authorized keys are loaded.
    pub async fn bind(cfg: &ServerConfig) -> Result<Self, ServerStartError> {
        if cfg.host != "127.0.0.1" {
            return Err(ServerStartError::InvalidBindHost(cfg.host.clone()));
        }
        let addr: SocketAddr = format!("{}:{}", cfg.host, cfg.port)
            .parse()
            .map_err(|e: std::net::AddrParseError| {
                ServerStartError::Bind(std::io::Error::new(std::io::ErrorKind::InvalidInput, e))
            })?;
        let listener = TcpListener::bind(addr).await?;
        let bound_addr = listener.local_addr()?;
        Ok(Self { bound_addr, listener: Arc::new(listener) })
    }

    pub fn port(&self) -> u16 {
        self.bound_addr.port()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn refuses_non_loopback_bind() {
        let cfg = ServerConfig { host: "0.0.0.0".into(), port: 0 };
        let err = ServerHandle::bind(&cfg).await.unwrap_err();
        assert!(matches!(err, ServerStartError::InvalidBindHost(_)));
    }

    #[tokio::test]
    async fn binds_kernel_assigned_port() {
        let cfg = ServerConfig::default();
        let h = ServerHandle::bind(&cfg).await.expect("bind loopback");
        assert!(h.port() > 0, "kernel should assign a non-zero port");
        assert_eq!(h.bound_addr.ip().to_string(), "127.0.0.1");
    }

    #[tokio::test]
    async fn two_servers_get_distinct_ports() {
        let a = ServerHandle::bind(&ServerConfig::default()).await.unwrap();
        let b = ServerHandle::bind(&ServerConfig::default()).await.unwrap();
        assert_ne!(a.port(), b.port());
    }
}
