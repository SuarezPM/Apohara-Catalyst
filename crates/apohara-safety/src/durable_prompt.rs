//! Durable permission prompt store — ports
//! `src/core/safety/durablePrompt.ts` + `durablePrompt-jsonl.ts`.
//!
//! Two backing modes share the same public shape:
//!  - In-memory (default): no I/O.
//!  - JSONL-backed (`with_ledger_path`): every enqueue/set_response is
//!    appended to a JSONL file so a fresh process can call `load()` and
//!    recover pending prompts and already-recorded responses across
//!    restarts.
//!
//! The on-disk appends are best-effort: they never block the call sites
//! that drive the UI. Compaction runs single-flight after `consume()`
//! to garbage-collect already-handled entries.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tokio::fs;
use tokio::io::AsyncWriteExt;
use tokio::sync::Mutex;

pub const DEFAULT_TIMEOUT_MS: u64 = 10 * 60 * 1000;
pub const DEFAULT_POLL_MS: u64 = 100;

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PromptScope {
    Once,
    Session,
    Always,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PromptDecision {
    Allow,
    Deny,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionRequest {
    pub request_id: String,
    pub tool: String,
    pub input: serde_json::Value,
    pub suggested_pattern: String,
    pub available_scopes: Vec<PromptScope>,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PermissionResponse {
    pub request_id: String,
    pub decision: PromptDecision,
    pub scope: Option<PromptScope>,
    pub pattern: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum LedgerEntry {
    Request { data: PermissionRequest },
    Response { data: PermissionResponse },
}

pub fn unix_millis_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Default)]
struct Inner {
    pending: HashMap<String, PermissionRequest>,
    responses: HashMap<String, PermissionResponse>,
}

#[derive(Clone)]
pub struct DurablePromptStore {
    inner: Arc<Mutex<Inner>>,
    ledger_path: Option<PathBuf>,
}

impl DurablePromptStore {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            ledger_path: None,
        }
    }

    pub fn with_ledger_path(path: PathBuf) -> Self {
        Self {
            inner: Arc::new(Mutex::new(Inner::default())),
            ledger_path: Some(path),
        }
    }

    pub async fn enqueue_request(&self, req: PermissionRequest) {
        {
            let mut g = self.inner.lock().await;
            g.pending.insert(req.request_id.clone(), req.clone());
        }
        if let Some(path) = &self.ledger_path {
            let _ = append_entry(path, &LedgerEntry::Request { data: req }).await;
        }
    }

    pub async fn set_response(&self, resp: PermissionResponse) {
        {
            let mut g = self.inner.lock().await;
            g.responses.insert(resp.request_id.clone(), resp.clone());
        }
        if let Some(path) = &self.ledger_path {
            let _ = append_entry(path, &LedgerEntry::Response { data: resp }).await;
        }
    }

    pub async fn is_pending(&self, request_id: &str) -> bool {
        let g = self.inner.lock().await;
        g.pending.contains_key(request_id) && !g.responses.contains_key(request_id)
    }

    pub async fn list_pending(&self) -> Vec<PermissionRequest> {
        let g = self.inner.lock().await;
        g.pending.values().cloned().collect()
    }

    /// Replay the JSONL ledger into the in-memory maps. Safe to call
    /// multiple times. No-op when no ledger_path was configured.
    pub async fn load(&self) -> std::io::Result<()> {
        let Some(path) = &self.ledger_path else {
            return Ok(());
        };
        let entries = load_entries(path).await?;
        let mut g = self.inner.lock().await;
        for entry in entries {
            match entry {
                LedgerEntry::Request { data } => {
                    g.pending.insert(data.request_id.clone(), data);
                }
                LedgerEntry::Response { data } => {
                    g.responses.insert(data.request_id.clone(), data);
                }
            }
        }
        Ok(())
    }

    /// Block until a response for `request_id` is recorded, or until
    /// `timeout` elapses. On success the prompt is consumed (removed
    /// from both maps) and the response is returned. On timeout the
    /// pending entry is dropped and `None` is returned.
    pub async fn wait_for_response(
        &self,
        request_id: &str,
        timeout: Duration,
        poll: Duration,
    ) -> Option<PermissionResponse> {
        let deadline = Instant::now() + timeout;
        // Fast path: response already present.
        if let Some(r) = self.consume_if_ready(request_id).await {
            return Some(r);
        }
        while Instant::now() < deadline {
            tokio::time::sleep(poll).await;
            if let Some(r) = self.consume_if_ready(request_id).await {
                return Some(r);
            }
        }
        // Timeout — drop pending so list_pending() doesn't lie.
        let mut g = self.inner.lock().await;
        g.pending.remove(request_id);
        None
    }

    async fn consume_if_ready(&self, request_id: &str) -> Option<PermissionResponse> {
        let snapshot = {
            let mut g = self.inner.lock().await;
            if let Some(r) = g.responses.get(request_id).cloned() {
                g.pending.remove(request_id);
                g.responses.remove(request_id);
                Some((r, g.pending.clone(), g.responses.clone()))
            } else {
                None
            }
        };
        if let Some((r, pending, responses)) = snapshot {
            if let Some(path) = &self.ledger_path {
                // Fire-and-forget compaction.
                let path = path.clone();
                tokio::spawn(async move {
                    let alive: Vec<LedgerEntry> = pending
                        .into_values()
                        .map(|data| LedgerEntry::Request { data })
                        .chain(
                            responses
                                .into_values()
                                .map(|data| LedgerEntry::Response { data }),
                        )
                        .collect();
                    let _ = compact_ledger(&path, &alive).await;
                });
            }
            return Some(r);
        }
        None
    }
}

impl Default for DurablePromptStore {
    fn default() -> Self {
        Self::new()
    }
}

// JSONL helpers ----------------------------------------------------------

async fn append_entry(path: &std::path::Path, entry: &LedgerEntry) -> std::io::Result<()> {
    let mut line = serde_json::to_string(entry)?;
    line.push('\n');
    let mut f = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(path)
        .await?;
    f.write_all(line.as_bytes()).await
}

async fn load_entries(path: &std::path::Path) -> std::io::Result<Vec<LedgerEntry>> {
    let raw = match fs::read_to_string(path).await {
        Ok(s) => s,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(e),
    };
    let mut entries = Vec::new();
    for line in raw.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        match serde_json::from_str::<LedgerEntry>(trimmed) {
            Ok(e) => entries.push(e),
            Err(_) => {
                // Best-effort: skip corrupted line so one bad write does
                // not poison the whole ledger. Parity with TS.
                tracing::warn!(
                    "[durable_prompt] skipping unparseable ledger line: {}",
                    &trimmed[..trimmed.len().min(80)]
                );
            }
        }
    }
    Ok(entries)
}

/// Atomic compaction via mkstemp + rename. Either fully replaces the
/// ledger with `alive` or leaves the previous file intact.
async fn compact_ledger(path: &std::path::Path, alive: &[LedgerEntry]) -> std::io::Result<()> {
    let dir = path.parent().unwrap_or_else(|| std::path::Path::new("."));
    fs::create_dir_all(dir).await.ok();
    let tmp = path.with_extension(format!(
        "tmp.{}",
        std::process::id() as u64 ^ unix_millis_now()
    ));
    {
        let mut f = fs::OpenOptions::new()
            .create(true)
            .truncate(true)
            .write(true)
            .open(&tmp)
            .await?;
        let mut body = String::new();
        for e in alive {
            body.push_str(&serde_json::to_string(e)?);
            body.push('\n');
        }
        f.write_all(body.as_bytes()).await?;
        f.sync_all().await.ok();
    }
    fs::rename(&tmp, path).await
}
