//! Key-based authentication. Password auth is DENIED in all paths.
//!
//! Authorized keys live at `~/.apohara/ssh-server/authorized_keys` in standard
//! OpenSSH `authorized_keys` format:
//!
//! ```text
//! ssh-ed25519 AAAA...base64...  pablo@laptop
//! ssh-rsa     AAAA...base64...  ci-worker
//! ```
//!
//! Lines starting with `#` and blank lines are ignored. Options (e.g.
//! `command=...,no-pty`) are not yet parsed; we accept the line if the algo +
//! blob match a connecting peer's public key.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;

/// Allowed key algorithm identifiers (OpenSSH wire names).
pub const ALLOWED_ALGOS: &[&str] = &[
    "ssh-ed25519",
    "ssh-rsa",
    "ecdsa-sha2-nistp256",
    "ecdsa-sha2-nistp384",
    "ecdsa-sha2-nistp521",
];

#[derive(Debug, Error)]
pub enum AuthorizedKeysError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("no home directory")]
    NoHome,
    #[error("malformed authorized key line {0}: {1}")]
    Malformed(usize, String),
    #[error("unsupported algorithm '{algo}' on line {line}")]
    UnsupportedAlgo { line: usize, algo: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AuthorizedKeyEntry {
    pub algo: String,
    pub base64_blob: String,
    pub comment: Option<String>,
}

#[derive(Debug, Default, Clone)]
pub struct AuthorizedKeys {
    pub entries: Vec<AuthorizedKeyEntry>,
}

impl AuthorizedKeys {
    pub fn empty() -> Self {
        Self { entries: Vec::new() }
    }

    /// Default file path: `~/.apohara/ssh-server/authorized_keys`.
    pub fn default_path() -> Result<PathBuf, AuthorizedKeysError> {
        let home = dirs::home_dir().ok_or(AuthorizedKeysError::NoHome)?;
        Ok(home.join(".apohara").join("ssh-server").join("authorized_keys"))
    }

    /// Load and parse an authorized_keys file. Missing file => empty set.
    pub fn load(path: &Path) -> Result<Self, AuthorizedKeysError> {
        let content = match std::fs::read_to_string(path) {
            Ok(s) => s,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Self::empty()),
            Err(e) => return Err(e.into()),
        };
        Self::parse(&content)
    }

    /// Parse an authorized_keys textual blob.
    pub fn parse(text: &str) -> Result<Self, AuthorizedKeysError> {
        let mut entries = Vec::new();
        for (idx0, raw_line) in text.lines().enumerate() {
            let line_num = idx0 + 1;
            let trimmed = raw_line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            // Tokenize: <algo> <base64> [comment...]
            // Options before algo are not yet supported; reject lines that start
            // with something other than a known algo to avoid silent misparsing.
            let mut parts = trimmed.splitn(3, char::is_whitespace);
            let algo = parts.next().ok_or_else(|| {
                AuthorizedKeysError::Malformed(line_num, "missing algorithm token".into())
            })?;
            if !ALLOWED_ALGOS.contains(&algo) {
                return Err(AuthorizedKeysError::UnsupportedAlgo {
                    line: line_num,
                    algo: algo.to_string(),
                });
            }
            let blob = parts.next().ok_or_else(|| {
                AuthorizedKeysError::Malformed(line_num, "missing base64 blob".into())
            })?;
            if blob.is_empty() {
                return Err(AuthorizedKeysError::Malformed(
                    line_num,
                    "empty base64 blob".into(),
                ));
            }
            let comment = parts.next().map(|c| c.trim().to_string()).filter(|c| !c.is_empty());
            entries.push(AuthorizedKeyEntry {
                algo: algo.to_string(),
                base64_blob: blob.to_string(),
                comment,
            });
        }
        Ok(Self { entries })
    }

    /// Check whether a (algo, base64_blob) pair is authorized. Constant-time
    /// comparison would be ideal but the blob is public-key material so a
    /// regular eq is sufficient against the threat model.
    pub fn authorizes(&self, algo: &str, base64_blob: &str) -> bool {
        self.entries
            .iter()
            .any(|e| e.algo == algo && e.base64_blob == base64_blob)
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn len(&self) -> usize {
        self.entries.len()
    }
}

/// Result of an authentication attempt. We expose this enum so the audit log
/// (G6.C.9) can distinguish "wrong key" from "password attempted" cleanly.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AuthOutcome {
    Accepted,
    Rejected,
    /// Password method was offered by the client — we explicitly deny.
    PasswordDenied,
    /// No keys configured on the server — we refuse all peers.
    NoKeysConfigured,
}

/// Decide whether to accept a public-key login attempt.
///
/// `authorized` MUST come from a freshly-loaded `AuthorizedKeys` (don't cache
/// across reloads — operators rotate keys without restart).
pub fn decide_publickey(
    authorized: &AuthorizedKeys,
    presented_algo: &str,
    presented_blob: &str,
) -> AuthOutcome {
    if authorized.is_empty() {
        return AuthOutcome::NoKeysConfigured;
    }
    if !ALLOWED_ALGOS.contains(&presented_algo) {
        return AuthOutcome::Rejected;
    }
    if authorized.authorizes(presented_algo, presented_blob) {
        AuthOutcome::Accepted
    } else {
        AuthOutcome::Rejected
    }
}

/// Password auth always denied. This function exists so the call site in the
/// russh handler can route through a single decision point that the audit log
/// observes — never call russh's accept-password code path directly.
pub fn decide_password() -> AuthOutcome {
    AuthOutcome::PasswordDenied
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const SAMPLE_ED25519: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIBcS6BCl3vXG6N7uqaQ7tQRfXz1IkOJqSEMmKBz6OuVT";
    const SAMPLE_RSA: &str = "AAAAB3NzaC1yc2EAAAADAQABAAABAQDLong...";

    #[test]
    fn empty_text_yields_empty_set() {
        let k = AuthorizedKeys::parse("").unwrap();
        assert!(k.is_empty());
    }

    #[test]
    fn parses_comments_and_blank_lines() {
        let text = "# this is a comment\n\n# another\nssh-ed25519 AAAAtest pablo\n";
        let k = AuthorizedKeys::parse(text).unwrap();
        assert_eq!(k.len(), 1);
        assert_eq!(k.entries[0].comment.as_deref(), Some("pablo"));
    }

    #[test]
    fn parses_multiple_entries() {
        let text = format!(
            "ssh-ed25519 {} laptop\nssh-rsa {} server\n",
            SAMPLE_ED25519, SAMPLE_RSA
        );
        let k = AuthorizedKeys::parse(&text).unwrap();
        assert_eq!(k.len(), 2);
        assert_eq!(k.entries[0].algo, "ssh-ed25519");
        assert_eq!(k.entries[1].algo, "ssh-rsa");
    }

    #[test]
    fn rejects_unknown_algorithm() {
        let err = AuthorizedKeys::parse("ssh-dsa AAAA dsa-is-banned").unwrap_err();
        assert!(matches!(err, AuthorizedKeysError::UnsupportedAlgo { .. }));
    }

    #[test]
    fn rejects_missing_blob() {
        let err = AuthorizedKeys::parse("ssh-ed25519").unwrap_err();
        assert!(matches!(err, AuthorizedKeysError::Malformed(1, _)));
    }

    #[test]
    fn missing_file_yields_empty() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("does-not-exist");
        let k = AuthorizedKeys::load(&p).unwrap();
        assert!(k.is_empty());
    }

    #[test]
    fn loads_from_disk() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("authorized_keys");
        std::fs::write(&p, format!("ssh-ed25519 {} laptop\n", SAMPLE_ED25519)).unwrap();
        let k = AuthorizedKeys::load(&p).unwrap();
        assert_eq!(k.len(), 1);
        assert!(k.authorizes("ssh-ed25519", SAMPLE_ED25519));
        assert!(!k.authorizes("ssh-ed25519", "wrong-blob"));
    }

    #[test]
    fn password_always_denied() {
        assert_eq!(decide_password(), AuthOutcome::PasswordDenied);
    }

    #[test]
    fn no_keys_configured_yields_no_keys_outcome() {
        let empty = AuthorizedKeys::empty();
        assert_eq!(
            decide_publickey(&empty, "ssh-ed25519", SAMPLE_ED25519),
            AuthOutcome::NoKeysConfigured
        );
    }

    #[test]
    fn authorized_key_accepted() {
        let k = AuthorizedKeys::parse(&format!("ssh-ed25519 {} ok", SAMPLE_ED25519)).unwrap();
        assert_eq!(
            decide_publickey(&k, "ssh-ed25519", SAMPLE_ED25519),
            AuthOutcome::Accepted
        );
    }

    #[test]
    fn unauthorized_key_rejected() {
        let k = AuthorizedKeys::parse(&format!("ssh-ed25519 {} ok", SAMPLE_ED25519)).unwrap();
        assert_eq!(
            decide_publickey(&k, "ssh-ed25519", "other-blob"),
            AuthOutcome::Rejected
        );
    }

    #[test]
    fn unknown_algo_during_auth_rejected() {
        let k = AuthorizedKeys::parse(&format!("ssh-ed25519 {} ok", SAMPLE_ED25519)).unwrap();
        assert_eq!(
            decide_publickey(&k, "ssh-dsa", SAMPLE_ED25519),
            AuthOutcome::Rejected
        );
    }
}
