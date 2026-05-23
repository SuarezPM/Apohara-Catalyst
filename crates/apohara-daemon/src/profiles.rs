//! Profile loader for the daemon (G6.A.8).
//!
//! Profiles live in `~/.apohara/profiles/<name>.json` and configure the
//! daemon's socket path, HTTP poll port, and log level. The `default`
//! profile is implicit if no file exists — useful for first-run setups.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Daemon profile config — wire format matches the TS side in
/// `src/core/profiles/loader.ts`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Profile {
    pub name: String,
    #[serde(default)]
    pub socket_path_override: Option<String>,
    #[serde(default)]
    pub http_poll_port: Option<u16>,
    #[serde(default = "default_log_level")]
    pub log_level: String,
}

fn default_log_level() -> String {
    "info".to_string()
}

#[derive(Debug, Error)]
pub enum ProfileError {
    #[error("profile name must be alphanumeric/dash/underscore (got {0:?})")]
    InvalidName(String),
    #[error("profile not found at {0}")]
    NotFound(PathBuf),
    #[error("profile JSON parse error: {0}")]
    Parse(#[from] serde_json::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("could not resolve user home directory")]
    NoHome,
}

impl Profile {
    pub fn default_profile() -> Self {
        Self {
            name: "default".to_string(),
            socket_path_override: None,
            http_poll_port: None,
            log_level: default_log_level(),
        }
    }

    /// Resolve the canonical profiles root: `$APOHARA_HOME/profiles` if
    /// `APOHARA_HOME` is set, else `~/.apohara/profiles`.
    pub fn profiles_root() -> Result<PathBuf, ProfileError> {
        if let Ok(custom) = std::env::var("APOHARA_HOME") {
            return Ok(PathBuf::from(custom).join("profiles"));
        }
        let home = dirs::home_dir().ok_or(ProfileError::NoHome)?;
        Ok(home.join(".apohara").join("profiles"))
    }

    /// Validate profile name (no path traversal, no whitespace).
    pub fn validate_name(name: &str) -> Result<(), ProfileError> {
        if name.is_empty() || name.len() > 64 {
            return Err(ProfileError::InvalidName(name.to_string()));
        }
        let ok = name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
        if !ok {
            return Err(ProfileError::InvalidName(name.to_string()));
        }
        Ok(())
    }

    /// Load profile from the canonical user dir. If file is missing returns
    /// `NotFound` so callers can decide whether to default or error.
    pub fn load_from_user_dir(name: &str) -> Result<Self, ProfileError> {
        Self::validate_name(name)?;
        let root = Self::profiles_root()?;
        let path = root.join(format!("{name}.json"));
        Self::load_from_path(&path, name)
    }

    /// Test-friendly loader (explicit path).
    pub fn load_from_path(path: &Path, expected_name: &str) -> Result<Self, ProfileError> {
        if !path.exists() {
            return Err(ProfileError::NotFound(path.to_path_buf()));
        }
        let raw = std::fs::read_to_string(path)?;
        let mut profile: Profile = serde_json::from_str(&raw)?;
        // Force the profile name to track the filename — guards against rename drift.
        profile.name = expected_name.to_string();
        Ok(profile)
    }

    /// Socket path for the daemon. Honors the override, otherwise derives a
    /// per-profile path so multiple daemons coexist (G6.A.12).
    pub fn socket_path(&self) -> PathBuf {
        if let Some(custom) = &self.socket_path_override {
            return PathBuf::from(custom);
        }
        let base = std::env::var("XDG_RUNTIME_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| std::env::temp_dir());
        base.join(format!("apohara-{}.sock", self.name))
    }

    /// HTTP poll port fallback; profile-specific or a deterministic-but-not-
    /// reserved port based on the name hash (clients can override via env).
    pub fn effective_http_poll_port(&self) -> u16 {
        if let Some(p) = self.http_poll_port {
            return p;
        }
        // Hash the name to a port in the 49152..=65535 ephemeral range so
        // distinct profiles don't collide by default.
        let mut hash: u32 = 2166136261;
        for b in self.name.bytes() {
            hash = hash.wrapping_mul(16777619) ^ (b as u32);
        }
        49152u16.wrapping_add((hash % (65535 - 49152 + 1)) as u16)
    }
}
