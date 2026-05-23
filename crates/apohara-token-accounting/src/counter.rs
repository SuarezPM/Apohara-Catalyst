//! Per-thread token counting with absolute-not-delta semantics.
//!
//! Why absolutes: providers (Claude, Codex, OpenCode) emit cumulative token
//! totals per session, not deltas. If we add `delta = current - previous` on
//! every event, replays/reconnections double-count. Storing the last known
//! absolute and *replacing* on each event is correct.
//!
//! multica #18 (G5.H.6): the counter key is `(provider_id, thread_id)`, not
//! `thread_id` alone. Two providers can legitimately attach to the same
//! thread (Claude does a planning pass, Codex does the edit) and we MUST
//! NOT collapse their counters — that would cross-contaminate billing and
//! make per-provider attention/throttle decisions wrong. Earlier prototype
//! keyed on `thread_id` alone, which silently overwrote one provider's
//! absolutes with the other's the moment both touched the same thread.

use std::collections::HashMap;

#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct TokenSnapshot {
    pub input: u64,
    pub output: u64,
    pub cache_creation: u64,
    pub cache_read: u64,
}

impl TokenSnapshot {
    pub fn add(&self, other: &TokenSnapshot) -> TokenSnapshot {
        TokenSnapshot {
            input: self.input + other.input,
            output: self.output + other.output,
            cache_creation: self.cache_creation + other.cache_creation,
            cache_read: self.cache_read + other.cache_read,
        }
    }
}

/// Composite key for per-thread accounting: (provider_id, thread_id).
///
/// multica #18 — see module header. Cheap to clone (two short Strings),
/// and a tuple key lets `HashMap` derive `Hash`/`Eq` for free.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct ThreadKey {
    pub provider_id: String,
    pub thread_id: String,
}

impl ThreadKey {
    pub fn new(provider_id: impl Into<String>, thread_id: impl Into<String>) -> Self {
        Self {
            provider_id: provider_id.into(),
            thread_id: thread_id.into(),
        }
    }
}

#[derive(Default)]
pub struct TokenCounter {
    /// (provider_id, thread_id) → last absolute snapshot
    threads: HashMap<ThreadKey, TokenSnapshot>,
}

impl TokenCounter {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record an absolute snapshot for `(provider_id, thread_id)`.
    /// REPLACES not adds — this is the absolute-vs-delta invariant
    /// (§0.14). The composite key prevents cross-provider stomping.
    pub fn record_absolute(
        &mut self,
        provider_id: &str,
        thread_id: &str,
        snap: TokenSnapshot,
    ) {
        self.threads
            .insert(ThreadKey::new(provider_id, thread_id), snap);
    }

    /// Look up the last-known absolute for `(provider_id, thread_id)`.
    pub fn get(&self, provider_id: &str, thread_id: &str) -> Option<&TokenSnapshot> {
        self.threads.get(&ThreadKey::new(provider_id, thread_id))
    }

    /// Sum of last-known absolutes per (provider, thread) — useful for
    /// top-level "total spend" rollups across the whole counter.
    pub fn total_across_threads(&self) -> TokenSnapshot {
        self.threads
            .values()
            .fold(TokenSnapshot::default(), |acc, s| acc.add(s))
    }

    /// Sum of last-known absolutes across all threads of one provider.
    /// Drives per-provider attention bands (HOT/WARM/COOL/IDLE).
    pub fn total_for_provider(&self, provider_id: &str) -> TokenSnapshot {
        self.threads
            .iter()
            .filter(|(k, _)| k.provider_id == provider_id)
            .fold(TokenSnapshot::default(), |acc, (_, s)| acc.add(s))
    }

    /// Sum of last-known absolutes across all providers of one thread.
    /// Drives per-thread budget checks when multiple providers
    /// collaborated on one task.
    pub fn total_for_thread(&self, thread_id: &str) -> TokenSnapshot {
        self.threads
            .iter()
            .filter(|(k, _)| k.thread_id == thread_id)
            .fold(TokenSnapshot::default(), |acc, (_, s)| acc.add(s))
    }
}
