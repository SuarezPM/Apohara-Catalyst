//! Per-thread token counting with absolute-not-delta semantics.
//!
//! Why absolutes: providers (Claude, Codex, OpenCode) emit cumulative token
//! totals per session, not deltas. If we add `delta = current - previous` on
//! every event, replays/reconnections double-count. Storing the last known
//! absolute and *replacing* on each event is correct.

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

#[derive(Default)]
pub struct TokenCounter {
    /// thread_id → last absolute snapshot
    threads: HashMap<String, TokenSnapshot>,
}

impl TokenCounter {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record_absolute(&mut self, thread_id: &str, snap: TokenSnapshot) {
        // REPLACES not adds — this is the absolute-vs-delta invariant.
        self.threads.insert(thread_id.to_string(), snap);
    }

    pub fn get(&self, thread_id: &str) -> Option<&TokenSnapshot> {
        self.threads.get(thread_id)
    }

    pub fn total_across_threads(&self) -> TokenSnapshot {
        self.threads.values().fold(TokenSnapshot::default(), |acc, s| acc.add(s))
    }
}
