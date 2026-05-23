//! JSONL audit logger with 0600 fchmod + fsync per entry.
//!
//! Mirrors `src/core/mcp/base/auditLogger.ts`. POSIX file is opened
//! with `O_APPEND | O_CREAT` so concurrent writers serialize at the byte
//! level for writes ≤ PIPE_BUF (a single JSON line comfortably fits).
//! Creation mode 0o600 plus a defensive `set_permissions` close the
//! create-then-chmod TOCTOU window. Each entry is `sync_data`-ed
//! before `log()` returns so a crash after the caller observed the
//! awaited future cannot lose a record that was nominally committed.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use tokio::fs::{self, File, OpenOptions};
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AuditStatus {
    Ok,
    Denied,
    Error,
    RateLimited,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuditEntry {
    pub ts: i64,
    pub server: String,
    pub tool: String,
    pub status: AuditStatus,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub detail: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum AuditError {
    #[error("audit io: {0}")]
    Io(#[from] std::io::Error),
    #[error("audit serialize: {0}")]
    Serialize(#[from] serde_json::Error),
}

#[derive(Clone)]
pub struct AuditLogger {
    path: PathBuf,
    inner: Arc<Mutex<Option<File>>>,
}

impl AuditLogger {
    pub fn new(path: impl Into<PathBuf>) -> Self {
        Self {
            path: path.into(),
            inner: Arc::new(Mutex::new(None)),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    async fn ensure_open(&self) -> Result<tokio::sync::MutexGuard<'_, Option<File>>, AuditError> {
        let mut guard = self.inner.lock().await;
        if guard.is_some() {
            return Ok(guard);
        }
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).await?;
        }
        #[cfg(unix)]
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o600)
            .open(&self.path)
            .await?;
        #[cfg(not(unix))]
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)
            .await?;
        // Belt-and-braces: enforce 0600 on the existing inode in case the
        // file pre-existed with a wider mode. Failure is non-fatal because
        // chmod can legitimately fail on non-POSIX filesystems.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600)).await;
        }
        *guard = Some(file);
        Ok(guard)
    }

    pub async fn log(&self, entry: &AuditEntry) -> Result<(), AuditError> {
        let mut guard = self.ensure_open().await?;
        let file = guard.as_mut().expect("file present after ensure_open");
        let mut line = serde_json::to_vec(entry)?;
        line.push(b'\n');
        file.write_all(&line).await?;
        file.sync_data().await?;
        Ok(())
    }

    pub async fn close(&self) -> Result<(), AuditError> {
        let mut guard = self.inner.lock().await;
        if let Some(mut f) = guard.take() {
            f.shutdown().await?;
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[tokio::test]
    async fn appends_jsonl_line_per_entry() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("audit.jsonl");
        let logger = AuditLogger::new(&path);
        logger
            .log(&AuditEntry {
                ts: 1,
                server: "apohara.ledger".to_string(),
                tool: "read_events".to_string(),
                status: AuditStatus::Ok,
                detail: None,
            })
            .await
            .unwrap();
        logger
            .log(&AuditEntry {
                ts: 2,
                server: "apohara.ledger".to_string(),
                tool: "replay_run".to_string(),
                status: AuditStatus::Denied,
                detail: Some("unknown tool".to_string()),
            })
            .await
            .unwrap();
        logger.close().await.unwrap();

        let raw = tokio::fs::read_to_string(&path).await.unwrap();
        let lines: Vec<_> = raw.lines().collect();
        assert_eq!(lines.len(), 2);
        let one: AuditEntry = serde_json::from_str(lines[0]).unwrap();
        let two: AuditEntry = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(one.tool, "read_events");
        assert_eq!(one.status, AuditStatus::Ok);
        assert_eq!(two.detail.as_deref(), Some("unknown tool"));
        assert_eq!(two.status, AuditStatus::Denied);
    }

    #[tokio::test]
    async fn creates_parent_directories() {
        let tmp = TempDir::new().unwrap();
        let nested = tmp.path().join("a/b/c/audit.jsonl");
        let logger = AuditLogger::new(&nested);
        logger
            .log(&AuditEntry {
                ts: 1,
                server: "x".to_string(),
                tool: "y".to_string(),
                status: AuditStatus::Ok,
                detail: None,
            })
            .await
            .unwrap();
        assert!(nested.exists());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn file_is_mode_0600() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join("audit.jsonl");
        let logger = AuditLogger::new(&path);
        logger
            .log(&AuditEntry {
                ts: 1,
                server: "x".to_string(),
                tool: "y".to_string(),
                status: AuditStatus::Ok,
                detail: None,
            })
            .await
            .unwrap();
        let meta = tokio::fs::metadata(&path).await.unwrap();
        let mode = meta.permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "file mode should be 0o600, got {mode:o}");
    }

    #[tokio::test]
    async fn entry_status_serializes_snake_case() {
        let e = AuditEntry {
            ts: 0,
            server: "s".to_string(),
            tool: "t".to_string(),
            status: AuditStatus::RateLimited,
            detail: None,
        };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"rate_limited\""));
    }
}
