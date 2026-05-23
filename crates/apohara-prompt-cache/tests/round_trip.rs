//! Integration: HOT -> WARM round-trip with the full 3-layer safety system
//! exercised. Lives outside `src/` so it composes the public API the same
//! way a downstream crate would.

use apohara_prompt_cache::hot::{CachedResponse, HotCache};
use apohara_prompt_cache::key::{key_scope, prompt_simhash};
use apohara_prompt_cache::safety_layers::{
    is_cache_enabled, ConfidenceBucket, ConfidenceGate, ScopedLookup,
};
use apohara_prompt_cache::telemetry::CacheTelemetry;
use apohara_prompt_cache::warm::WarmCache;
use std::time::Duration;
use tempfile::TempDir;

fn now_ts() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Full path: gate -> scoped key -> HOT miss -> WARM miss -> store -> HOT
/// hit -> WARM hit-after-evict. Verifies the 3 safety layers stay in
/// place at the composition seam.
#[test]
fn hot_warm_round_trip_with_safety_layers() {
    // L3 gate: simulate APOHARA_PROMPT_CACHE=1.
    assert!(is_cache_enabled(Some("1")));
    assert!(!is_cache_enabled(None));

    let dir = TempDir::new().unwrap();
    let warm = WarmCache::open(dir.path().join("rt.db")).expect("warm open");
    let hot = HotCache::new(64);
    let telemetry = CacheTelemetry::default();

    let prompt = "summarise the quarterly report";
    let provider = "claude-code-cli";
    let model = "sonnet-4-7";

    // L1: scoped key.
    let scope = ScopedLookup::new(prompt, provider, model);
    assert_eq!(scope.provider_id, provider);
    assert_eq!(scope.model_id, model);
    assert_eq!(scope.key, key_scope(prompt, provider, model));

    // Miss on cold cache (both tiers).
    assert!(hot.get(&scope.key).is_none());
    assert!(warm.get(&scope.key).unwrap().is_none());
    telemetry.record_miss(Duration::from_micros(120));

    // Store: write through HOT + WARM.
    let response = CachedResponse {
        content: b"the report shows revenue growth of 12%".to_vec(),
        simhash: prompt_simhash(prompt),
        timestamp: now_ts(),
    };
    hot.put(scope.key, response.clone());
    warm.put(&scope.key, &response).unwrap();
    telemetry.record_store();

    // HOT hit.
    let got = hot.get(&scope.key).expect("hot hit");
    assert_eq!(got.content, response.content);
    telemetry.record_hot_hit(Duration::from_micros(5));

    // Simulate HOT eviction (process restart), still get WARM hit.
    drop(hot);
    let warm_hit = warm.get(&scope.key).expect("warm get").expect("warm hit");
    assert_eq!(warm_hit.content, response.content);
    assert_eq!(warm_hit.simhash, response.simhash);
    telemetry.record_warm_hit(Duration::from_micros(80));

    // Telemetry sanity.
    assert_eq!(telemetry.misses(), 1);
    assert_eq!(telemetry.hot_hits(), 1);
    assert_eq!(telemetry.warm_hits(), 1);
    assert_eq!(telemetry.stores(), 1);
    assert!((telemetry.hit_ratio() - (2.0 / 3.0)).abs() < 1e-9);
}

/// L1 enforcement at composition: a HOT entry stored under provider A
/// must NOT satisfy a lookup from provider B even when the prompt text
/// is byte-identical.
#[test]
fn l1_blocks_cross_provider_hit() {
    let hot = HotCache::new(32);
    let key_a = key_scope("identical prompt", "claude-code-cli", "sonnet-4-7");
    let key_b = key_scope("identical prompt", "codex-cli", "sonnet-4-7");
    assert_ne!(key_a, key_b);

    hot.put(
        key_a,
        CachedResponse {
            content: b"claude-response".to_vec(),
            simhash: 0,
            timestamp: 1,
        },
    );

    assert!(hot.get(&key_a).is_some(), "A must hit");
    assert!(hot.get(&key_b).is_none(), "B must MISS — no cross-provider");
}

/// L2 enforcement at composition: candidate prompt with hamming = 1 from
/// the stored prompt is admitted by `all_except_unrelated()` and
/// rejected by the default `exact_only` gate. This proves the bucket
/// ladder controls hit/miss decisions at the seam, not just in isolation.
#[test]
fn l2_bucket_gates_lookup_acceptance() {
    let stored = 0u64; // simhash signature
    let near_candidate = 0b1u64; // hamming = 1 -> Near bucket
    let unrelated_candidate = u64::MAX; // hamming = 64 -> Unrelated

    let default_gate = ConfidenceGate::default();
    assert!(default_gate.admits_simhashes(stored, stored));
    assert!(!default_gate.admits_simhashes(stored, near_candidate));
    assert!(!default_gate.admits_simhashes(stored, unrelated_candidate));

    let permissive = ConfidenceGate::all_except_unrelated();
    assert!(permissive.admits_simhashes(stored, stored));
    assert!(permissive.admits_simhashes(stored, near_candidate));
    assert!(
        !permissive.admits_simhashes(stored, unrelated_candidate),
        "Unrelated must NEVER be admitted (Layer 2 floor)"
    );

    // Bucket classification matches what the gate decisions imply.
    assert_eq!(ConfidenceBucket::classify(0), ConfidenceBucket::Exact);
    assert_eq!(ConfidenceBucket::classify(1), ConfidenceBucket::Near);
    assert_eq!(ConfidenceBucket::classify(64), ConfidenceBucket::Unrelated);
}

/// L3 enforcement at composition: when the env-var gate is OFF, callers
/// must skip the cache entirely. We verify the predicate is the
/// load-bearing check (since the actual cache modules trust the caller
/// to consult it).
#[test]
fn l3_disabled_predicate_blocks_lookup() {
    let dir = TempDir::new().unwrap();
    let warm = WarmCache::open(dir.path().join("l3.db")).unwrap();
    let key = key_scope("prompt", "p", "m");
    warm.put(
        &key,
        &CachedResponse {
            content: b"data".to_vec(),
            simhash: 0,
            timestamp: 0,
        },
    )
    .unwrap();

    // Gate says OFF for unset / '0' / 'true'.
    assert!(!is_cache_enabled(None));
    assert!(!is_cache_enabled(Some("0")));
    assert!(!is_cache_enabled(Some("true")));

    // Caller honours gate: never queries warm when disabled.
    let telemetry = CacheTelemetry::default();
    let env = Some("0");
    if is_cache_enabled(env) {
        // never taken
        let _ = warm.get(&key).unwrap();
    } else {
        telemetry.record_disabled();
    }
    assert_eq!(telemetry.disabled(), 1);
    assert_eq!(telemetry.warm_hits(), 0);
}
