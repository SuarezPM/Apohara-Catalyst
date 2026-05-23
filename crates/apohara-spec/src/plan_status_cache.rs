//! Plan status cache (port of `src/core/spec/planStatusCache.ts`).
//!
//! Caches `PlanDocument` by filepath. Avoids the full reparse on:
//!   1. Unchanged mtime + unchanged size (fast path — no IO past stat).
//!   2. Changed mtime but unchanged full-file SHA → just refresh mtime/size.
//!
//! A full parse only happens when the SHA actually changes. The hash is
//! computed over the entire file (not the first 4 KB) — the TS comment in
//! the original explained why: a 4 KB window silently returned stale plans
//! whenever an edit lived past byte 4096, common for any non-trivial plan.
//!
//! Last-known-good fallback (`get_fast_or_lkg`): if a fresh parse fails
//! (e.g. the writer is mid-edit and the YAML is briefly broken), the
//! cache returns the previous successful parse so consumers keep seeing
//! a usable plan until the writer settles.

use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::SystemTime;

use crate::plan_documents::{parse_plan_document_str, PlanDocument, PlanParseError};

#[derive(Debug, Clone)]
struct CacheEntry {
    plan: PlanDocument,
    mtime: SystemTime,
    size: u64,
    sha: String,
}

#[derive(thiserror::Error, Debug)]
pub enum CacheError {
    #[error("io error: {0}")]
    Io(#[from] io::Error),
    #[error(transparent)]
    Parse(#[from] PlanParseError),
}

#[derive(Default)]
pub struct PlanStatusCache {
    inner: Mutex<Inner>,
}

#[derive(Default)]
struct Inner {
    cache: HashMap<PathBuf, CacheEntry>,
    lkg: HashMap<PathBuf, PlanDocument>,
    parse_count: u64,
}

impl PlanStatusCache {
    pub fn new() -> Self {
        Self::default()
    }

    /// Fast-read path. Stats the file first; if `(mtime, size)` matches
    /// the cached entry we return it directly without hashing. Otherwise
    /// we hash; if the hash matches we just refresh the metadata; on a
    /// miss we reparse.
    pub fn get_fast(&self, filepath: &Path) -> Result<PlanDocument, CacheError> {
        let meta = std::fs::metadata(filepath)?;
        let st_mtime = meta.modified()?;
        let st_size = meta.len();

        // Fast path: mtime + size unchanged → definitely no edit.
        {
            let inner = self.inner.lock().unwrap();
            if let Some(cached) = inner.cache.get(filepath) {
                if cached.mtime == st_mtime && cached.size == st_size {
                    return Ok(cached.plan.clone());
                }
            }
        }

        let raw = std::fs::read_to_string(filepath)?;
        let sha = sha256_hex(raw.as_bytes());

        {
            let mut inner = self.inner.lock().unwrap();
            if let Some(cached) = inner.cache.get_mut(filepath) {
                if cached.sha == sha {
                    cached.mtime = st_mtime;
                    cached.size = st_size;
                    return Ok(cached.plan.clone());
                }
            }
        }

        let plan = parse_plan_document_str(filepath, &raw)?;

        {
            let mut inner = self.inner.lock().unwrap();
            inner.parse_count += 1;
            inner.cache.insert(
                filepath.to_path_buf(),
                CacheEntry {
                    plan: plan.clone(),
                    mtime: st_mtime,
                    size: st_size,
                    sha,
                },
            );
            inner.lkg.insert(filepath.to_path_buf(), plan.clone());
        }

        Ok(plan)
    }

    /// Like `get_fast`, but if the underlying parse fails and a previous
    /// successful parse exists, returns that instead of propagating the
    /// error. Returns the original error only if there is no LKG entry.
    pub fn get_fast_or_lkg(&self, filepath: &Path) -> Result<PlanDocument, CacheError> {
        match self.get_fast(filepath) {
            Ok(p) => Ok(p),
            Err(err) => {
                let inner = self.inner.lock().unwrap();
                if let Some(lkg) = inner.lkg.get(filepath) {
                    Ok(lkg.clone())
                } else {
                    Err(err)
                }
            }
        }
    }

    /// Look up the last-known-good entry without forcing a parse.
    pub fn get_last_known_good(&self, filepath: &Path) -> Option<PlanDocument> {
        let inner = self.inner.lock().unwrap();
        inner.lkg.get(filepath).cloned()
    }

    pub fn clear(&self, filepath: &Path) {
        let mut inner = self.inner.lock().unwrap();
        inner.cache.remove(filepath);
    }

    pub fn len(&self) -> usize {
        self.inner.lock().unwrap().cache.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    pub fn parse_count(&self) -> u64 {
        self.inner.lock().unwrap().parse_count
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}
