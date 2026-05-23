//! Audit log of SSH worker events.
//!
//! Format: append-only JSONL at `~/.apohara/ssh-server/audit.log`, mode 0600.
//! Writes are atomic (single `write!`) per event because each JSON object fits
//! in a write(2) on Linux when below ~PIPE_BUF. We additionally bracket each
//! line with a `\n` so partial reads still parse line-by-line.
//!
//! No PII rotation policy yet — events stay forever. Operators truncate when
//! they want; the daemon never deletes audit lines.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::io::Write;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Debug, Error)]
pub enum AuditError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("no home directory")]
    NoHome,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuditEventKind {
    Connect,
    Disconnect,
    AuthSuccess,
    AuthFailure,
    PasswordAttempted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuditEvent {
    pub kind: AuditEventKind,
    pub timestamp: DateTime<Utc>,
    pub peer: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fingerprint: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl AuditEvent {
    pub fn connect(peer: impl Into<String>, session_id: impl Into<String>) -> Self {
        Self {
            kind: AuditEventKind::Connect,
            timestamp: Utc::now(),
            peer: peer.into(),
            session_id: Some(session_id.into()),
            fingerprint: None,
            reason: None,
        }
    }

    pub fn disconnect(peer: impl Into<String>, session_id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            kind: AuditEventKind::Disconnect,
            timestamp: Utc::now(),
            peer: peer.into(),
            session_id: Some(session_id.into()),
            fingerprint: None,
            reason: Some(reason.into()),
        }
    }

    pub fn auth_success(peer: impl Into<String>, fingerprint: impl Into<String>) -> Self {
        Self {
            kind: AuditEventKind::AuthSuccess,
            timestamp: Utc::now(),
            peer: peer.into(),
            session_id: None,
            fingerprint: Some(fingerprint.into()),
            reason: None,
        }
    }

    pub fn auth_failure(peer: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            kind: AuditEventKind::AuthFailure,
            timestamp: Utc::now(),
            peer: peer.into(),
            session_id: None,
            fingerprint: None,
            reason: Some(reason.into()),
        }
    }

    pub fn password_attempted(peer: impl Into<String>) -> Self {
        Self {
            kind: AuditEventKind::PasswordAttempted,
            timestamp: Utc::now(),
            peer: peer.into(),
            session_id: None,
            fingerprint: None,
            reason: Some("password auth attempted (denied)".into()),
        }
    }
}

/// In-memory mirror of the on-disk log, used by tests and the API surface.
#[derive(Debug, Default, Clone)]
pub struct AuditLog {
    pub events: Vec<AuditEvent>,
}

impl AuditLog {
    pub fn push(&mut self, e: AuditEvent) {
        self.events.push(e);
    }

    pub fn iter(&self) -> std::slice::Iter<'_, AuditEvent> {
        self.events.iter()
    }
}

/// Append a single event to a JSONL file. Creates parent dirs. On Unix the
/// file is opened with mode 0600 (fchmod after first create — fine for an
/// append-only log on a single-host setup).
pub fn append_to(path: &Path, event: &AuditEvent) -> Result<(), AuditError> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let mut opts = std::fs::OpenOptions::new();
    opts.create(true).append(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        opts.mode(0o600);
    }
    let mut f = opts.open(path)?;
    let mut line = serde_json::to_vec(event)?;
    line.push(b'\n');
    f.write_all(&line)?;
    Ok(())
}

/// Read all events from a JSONL log file. Lines that fail to parse are
/// skipped — operators sometimes hand-edit the log (or the file got truncated
/// mid-line) and we don't want a single bad line to kill diagnostics.
pub fn read_all(path: &Path) -> Result<Vec<AuditEvent>, AuditError> {
    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e.into()),
    };
    let mut out = Vec::new();
    for line in bytes.split(|b| *b == b'\n') {
        if line.is_empty() {
            continue;
        }
        if let Ok(ev) = serde_json::from_slice::<AuditEvent>(line) {
            out.push(ev);
        }
    }
    Ok(out)
}

/// Default audit log path.
pub fn default_path() -> Result<PathBuf, AuditError> {
    let home = dirs::home_dir().ok_or(AuditError::NoHome)?;
    Ok(home.join(".apohara").join("ssh-server").join("audit.log"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn constructors_set_kind_correctly() {
        assert_eq!(AuditEvent::connect("p", "s").kind, AuditEventKind::Connect);
        assert_eq!(AuditEvent::disconnect("p", "s", "r").kind, AuditEventKind::Disconnect);
        assert_eq!(AuditEvent::auth_success("p", "fp").kind, AuditEventKind::AuthSuccess);
        assert_eq!(AuditEvent::auth_failure("p", "r").kind, AuditEventKind::AuthFailure);
        assert_eq!(AuditEvent::password_attempted("p").kind, AuditEventKind::PasswordAttempted);
    }

    #[test]
    fn password_attempt_carries_reason() {
        let e = AuditEvent::password_attempted("127.0.0.1:1234");
        assert_eq!(e.reason.as_deref(), Some("password auth attempted (denied)"));
    }

    #[test]
    fn jsonl_round_trip_through_disk() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("nested").join("audit.log");
        let e1 = AuditEvent::connect("127.0.0.1:1234", "s1");
        let e2 = AuditEvent::auth_failure("127.0.0.1:5678", "no key");
        append_to(&p, &e1).unwrap();
        append_to(&p, &e2).unwrap();
        let back = read_all(&p).unwrap();
        assert_eq!(back.len(), 2);
        assert_eq!(back[0].kind, AuditEventKind::Connect);
        assert_eq!(back[1].kind, AuditEventKind::AuthFailure);
    }

    #[test]
    fn read_all_on_missing_file_returns_empty() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("missing.log");
        assert!(read_all(&p).unwrap().is_empty());
    }

    #[test]
    fn malformed_lines_are_skipped() {
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("audit.log");
        let e = AuditEvent::connect("p", "s");
        append_to(&p, &e).unwrap();
        // Corrupt the file with a junk line.
        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(b"not-json\n").unwrap();
        append_to(&p, &AuditEvent::disconnect("p", "s", "x")).unwrap();
        let back = read_all(&p).unwrap();
        assert_eq!(back.len(), 2, "junk line is skipped, 2 valid remain");
    }

    #[test]
    fn skip_serializing_omits_optional_fields() {
        let e = AuditEvent::connect("p", "s");
        let s = serde_json::to_string(&e).unwrap();
        assert!(!s.contains("fingerprint"));
        assert!(!s.contains("reason"));
    }

    #[cfg(unix)]
    #[test]
    fn unix_file_mode_is_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = TempDir::new().unwrap();
        let p = dir.path().join("audit.log");
        let e = AuditEvent::connect("p", "s");
        append_to(&p, &e).unwrap();
        let meta = std::fs::metadata(&p).unwrap();
        assert_eq!(meta.permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn in_memory_log_pushes_and_iterates() {
        let mut l = AuditLog::default();
        l.push(AuditEvent::connect("p1", "s1"));
        l.push(AuditEvent::disconnect("p1", "s1", "graceful"));
        assert_eq!(l.events.len(), 2);
        assert_eq!(l.iter().count(), 2);
    }
}
