//! JSONL audit sink per spec §0.4 (culture #4 inspiration).
//!
//! Async-queue, writer task dedicated, JSONL append-only, daily UTC rotation,
//! plus size-based rotation. `fchmod 0600` forced on file descriptor (no race
//! with separate chmod call).
//!
//! Record schema canonical: `{ ts, server, kind, actor, target, payload }`.
//! Drops on overflow (does NOT block event loop).

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use thiserror::Error;
use tokio::fs::{File, OpenOptions};
use tokio::io::AsyncWriteExt;
use tokio::sync::mpsc;
use ts_rs::TS;

#[derive(Debug, Error)]
pub enum AuditError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("queue overflow")]
    QueueOverflow,
}

#[derive(Debug, Serialize, Deserialize, Clone, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum EventKind {
    McpToolInvoked,
    McpRateLimited,
    PolicyViolation,
    PermissionGranted,
    PermissionDenied,
    PathSafetyViolation,
    SandboxBypassed,
    SecurityViolation,
    LedgerEntryWritten,
    LedgerVerifyFailed,
    GuardrailsBypassed,
    HookEvent,
    ManifestDrift,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AuditEvent {
    pub ts: SystemTime,
    pub server: String,
    pub kind: EventKind,
    pub actor: Option<String>,
    pub target: Option<String>,
    pub payload: serde_json::Value,
}

const MAX_FILE_BYTES: u64 = 64 * 1024 * 1024; // 64 MiB
const QUEUE_DEPTH: usize = 1024;

pub struct AuditSink {
    tx: mpsc::Sender<AuditEvent>,
    _writer: tokio::task::JoinHandle<()>,
}

impl AuditSink {
    pub async fn new(dir: impl AsRef<Path>, instance: &str) -> Result<Self, AuditError> {
        let dir = dir.as_ref().to_path_buf();
        tokio::fs::create_dir_all(&dir).await?;
        let (tx, mut rx) = mpsc::channel::<AuditEvent>(QUEUE_DEPTH);
        let instance = instance.to_string();

        let writer = tokio::spawn(async move {
            let mut current_file: Option<File> = None;
            let mut current_path: Option<PathBuf> = None;
            let mut current_bytes: u64 = 0;

            while let Some(event) = rx.recv().await {
                let target = pick_target_path(&dir, &instance, event.ts);
                let must_rotate = current_path.as_ref() != Some(&target)
                    || current_bytes >= MAX_FILE_BYTES;
                if must_rotate {
                    if let Some(mut f) = current_file.take() {
                        let _ = f.flush().await;
                    }
                    let path = if current_bytes >= MAX_FILE_BYTES {
                        rotate_with_suffix(&target).await
                    } else {
                        target.clone()
                    };
                    let file = open_with_0600(&path).await;
                    current_bytes = file
                        .as_ref()
                        .ok()
                        .map(|_| std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0))
                        .unwrap_or(0);
                    current_file = file.ok();
                    current_path = Some(path);
                }
                if let Some(f) = current_file.as_mut() {
                    let line = serde_json::to_string(&event).unwrap_or_else(|_| "{}".into());
                    if f.write_all(line.as_bytes()).await.is_ok()
                        && f.write_all(b"\n").await.is_ok()
                    {
                        current_bytes += line.len() as u64 + 1;
                    }
                }
            }
        });

        Ok(Self {
            tx,
            _writer: writer,
        })
    }

    pub fn write(&self, event: AuditEvent) -> Result<(), AuditError> {
        use tokio::sync::mpsc::error::TrySendError;
        self.tx.try_send(event).map_err(|e| match e {
            TrySendError::Full(_) | TrySendError::Closed(_) => AuditError::QueueOverflow,
        })
    }

    pub async fn flush(&self) -> Result<(), AuditError> {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        Ok(())
    }
}

fn pick_target_path(dir: &Path, instance: &str, ts: SystemTime) -> PathBuf {
    let dt: chrono::DateTime<chrono::Utc> = ts.into();
    dir.join(format!("{}-{}.jsonl", instance, dt.format("%Y-%m-%d")))
}

async fn rotate_with_suffix(base: &Path) -> PathBuf {
    for i in 0..1000 {
        let candidate = base.with_extension(format!("jsonl.{}", i));
        if !tokio::fs::try_exists(&candidate).await.unwrap_or(false) {
            return candidate;
        }
    }
    base.to_path_buf()
}

async fn open_with_0600(path: &Path) -> std::io::Result<File> {
    #[cfg(unix)]
    {
        // Trait import enables `.mode(0o600)` and `.custom_flags(...)`
        // on the OpenOptions builder, and `.as_raw_fd()` on the File.
        #[allow(unused_imports)]
        use std::os::unix::fs::OpenOptionsExt;
        #[allow(unused_imports)]
        use std::os::unix::io::AsRawFd;
        // O_NOFOLLOW prevents an attacker who pre-created the path as
        // a symlink from redirecting the audit writes elsewhere. The
        // file's first opener still sees 0o600 via .mode(...).
        let f = OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(path)
            .await?;
        // Belt-and-braces: also tighten perms on the EXISTING fd via
        // fchmod (NOT path-based chmod). The previous implementation
        // used `std::fs::set_permissions(path, ...)` which is a
        // path-based syscall — racy against a swap-the-file attack
        // (between the create-with-mode and the set_permissions call
        // an attacker could replace the inode). fchmod operates on
        // the open file descriptor itself so the race window
        // closes entirely.
        let fd = f.as_raw_fd();
        // SAFETY: `fd` comes from a tokio File we still hold; the
        // libc call is a simple syscall with no UB.
        let rc = unsafe { libc::fchmod(fd, 0o600) };
        if rc != 0 {
            // Non-fatal: the file already opened with 0o600 via
            // .mode(...). The fchmod call here only re-enforces it
            // on a pre-existing path; failure means the existing
            // file's perms remain whatever they were. Log at warn
            // and continue so audit writing isn't blocked by a
            // permission tweak.
            tracing::warn!(?path, errno = std::io::Error::last_os_error().raw_os_error(), "fchmod 0600 failed on audit log");
        }
        Ok(f)
    }
    #[cfg(not(unix))]
    {
        OpenOptions::new().create(true).append(true).open(path).await
    }
}
