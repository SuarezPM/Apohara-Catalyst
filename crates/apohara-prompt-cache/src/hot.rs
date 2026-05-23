//! HOT cache tier — in-process `DashMap` with size-based timestamp eviction.
//!
//! Lock-free reads via DashMap; eviction drops the oldest `timestamp` when
//! the map reaches `max_entries`. This is intentionally simple (no LRU
//! linked list, no probabilistic tracking) — the WARM tier is the durable
//! store and HOT only needs O(1) hot-path reads.

use crate::key::CacheKey;
use dashmap::DashMap;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicUsize, Ordering};

/// A cached prompt response. `simhash` is the L2 prompt fingerprint, kept
/// alongside the content so range queries can score similarity without
/// touching the prompt text again.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CachedResponse {
    pub content: Vec<u8>,
    pub simhash: u64,
    pub timestamp: u64,
}

pub struct HotCache {
    map: DashMap<CacheKey, CachedResponse>,
    max_entries: usize,
    inserts: AtomicUsize,
}

impl HotCache {
    pub fn new(max_entries: usize) -> Self {
        let cap = max_entries.max(1);
        Self {
            map: DashMap::with_capacity(cap),
            max_entries: cap,
            inserts: AtomicUsize::new(0),
        }
    }

    pub fn get(&self, key: &CacheKey) -> Option<CachedResponse> {
        self.map.get(key).map(|r| r.clone())
    }

    pub fn put(&self, key: CacheKey, value: CachedResponse) {
        self.maybe_evict();
        self.map.insert(key, value);
        self.inserts.fetch_add(1, Ordering::Relaxed);
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    pub fn insert_count(&self) -> usize {
        self.inserts.load(Ordering::Relaxed)
    }

    fn maybe_evict(&self) {
        if self.map.len() < self.max_entries {
            return;
        }
        // Drop oldest by timestamp. Single sweep; O(n) but n is bounded
        // by `max_entries` so this stays cheap relative to a real LRU.
        let mut oldest_key: Option<CacheKey> = None;
        let mut oldest_ts: u64 = u64::MAX;
        for entry in self.map.iter() {
            if entry.value().timestamp < oldest_ts {
                oldest_ts = entry.value().timestamp;
                oldest_key = Some(*entry.key());
            }
        }
        if let Some(k) = oldest_key {
            self.map.remove(&k);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dummy_key(seed: u8) -> CacheKey {
        let mut k = [0u8; 32];
        k[0] = seed;
        k
    }

    #[test]
    fn hot_cache_get_returns_none_on_miss() {
        let cache = HotCache::new(1024);
        assert!(cache.get(&dummy_key(1)).is_none());
    }

    #[test]
    fn hot_cache_put_then_get_round_trips() {
        let cache = HotCache::new(1024);
        let key = dummy_key(2);
        let resp = CachedResponse {
            content: b"hello".to_vec(),
            simhash: 0xDEAD_BEEF,
            timestamp: 0,
        };
        cache.put(key, resp.clone());
        let got = cache.get(&key).expect("should hit");
        assert_eq!(got.content, b"hello");
        assert_eq!(got.simhash, 0xDEAD_BEEF);
    }

    #[test]
    fn hot_cache_size_limit_evicts_oldest() {
        let cache = HotCache::new(2);
        for i in 0..5u8 {
            cache.put(
                dummy_key(i + 10),
                CachedResponse {
                    content: vec![i],
                    simhash: i as u64,
                    timestamp: i as u64,
                },
            );
        }
        assert!(cache.len() <= 2, "expected eviction to bound size");
    }

    #[test]
    fn hot_cache_evicts_oldest_timestamp_not_newest() {
        let cache = HotCache::new(2);
        cache.put(
            dummy_key(1),
            CachedResponse {
                content: vec![1],
                simhash: 1,
                timestamp: 100,
            },
        );
        cache.put(
            dummy_key(2),
            CachedResponse {
                content: vec![2],
                simhash: 2,
                timestamp: 200,
            },
        );
        // Inserting a third entry should evict key=1 (oldest ts).
        cache.put(
            dummy_key(3),
            CachedResponse {
                content: vec![3],
                simhash: 3,
                timestamp: 300,
            },
        );
        assert!(cache.get(&dummy_key(1)).is_none(), "ts=100 should be evicted");
        assert!(cache.get(&dummy_key(2)).is_some(), "ts=200 should survive");
        assert!(cache.get(&dummy_key(3)).is_some(), "ts=300 should survive");
    }

    #[test]
    fn hot_cache_zero_capacity_is_safe() {
        let cache = HotCache::new(0);
        // Constructor clamps to at least 1; put/get should still work.
        cache.put(
            dummy_key(9),
            CachedResponse {
                content: vec![9],
                simhash: 9,
                timestamp: 9,
            },
        );
        assert!(cache.len() <= 1);
    }

    #[test]
    fn hot_cache_insert_count_increments() {
        let cache = HotCache::new(8);
        for i in 0..3u8 {
            cache.put(
                dummy_key(i + 20),
                CachedResponse {
                    content: vec![i],
                    simhash: 0,
                    timestamp: i as u64,
                },
            );
        }
        assert_eq!(cache.insert_count(), 3);
    }
}
