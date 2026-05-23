//! Endpoint file published at `~/.apohara/ssh-server/endpoint.json` so clients
//! discover the kernel-assigned port. Bind address is always `127.0.0.1`.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum EndpointError {
    #[error("home directory not found")]
    NoHome,
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialization: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("endpoint bind host must be 127.0.0.1, got {0}")]
    InvalidHost(String),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Endpoint {
    pub host: String,
    pub port: u16,
    pub pid: u32,
    pub started_unix_ms: i64,
}

impl Endpoint {
    /// Construct a new endpoint. Returns an error if `host` is not `127.0.0.1`.
    pub fn new(host: impl Into<String>, port: u16, pid: u32, started_unix_ms: i64) -> Result<Self, EndpointError> {
        let host = host.into();
        if host != "127.0.0.1" {
            return Err(EndpointError::InvalidHost(host));
        }
        Ok(Self { host, port, pid, started_unix_ms })
    }

    /// Default endpoint path: `~/.apohara/ssh-server/endpoint.json`.
    pub fn default_path() -> Result<PathBuf, EndpointError> {
        let home = dirs::home_dir().ok_or(EndpointError::NoHome)?;
        Ok(home.join(".apohara").join("ssh-server").join("endpoint.json"))
    }

    /// Write the endpoint atomically: tmp file + rename. Creates parent dirs.
    pub fn write_to(&self, path: &Path) -> Result<(), EndpointError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let tmp = path.with_extension("json.tmp");
        let json = serde_json::to_vec_pretty(self)?;
        std::fs::write(&tmp, json)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }

    pub fn read_from(path: &Path) -> Result<Self, EndpointError> {
        let bytes = std::fs::read(path)?;
        Ok(serde_json::from_slice(&bytes)?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn rejects_non_loopback_host() {
        assert!(matches!(
            Endpoint::new("0.0.0.0", 22, 1, 0),
            Err(EndpointError::InvalidHost(_))
        ));
        assert!(matches!(
            Endpoint::new("192.168.0.1", 22, 1, 0),
            Err(EndpointError::InvalidHost(_))
        ));
    }

    #[test]
    fn accepts_loopback() {
        assert!(Endpoint::new("127.0.0.1", 0, 1, 0).is_ok());
    }

    #[test]
    fn round_trips_via_disk() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("nested").join("endpoint.json");
        let ep = Endpoint::new("127.0.0.1", 42424, 1234, 1_700_000_000_000).unwrap();
        ep.write_to(&p).unwrap();
        let read_back = Endpoint::read_from(&p).unwrap();
        assert_eq!(ep, read_back);
    }

    #[test]
    fn write_is_atomic_via_rename() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("endpoint.json");
        let ep = Endpoint::new("127.0.0.1", 1, 1, 0).unwrap();
        ep.write_to(&p).unwrap();
        // tmp file must not linger
        assert!(!p.with_extension("json.tmp").exists());
        assert!(p.exists());
    }
}
