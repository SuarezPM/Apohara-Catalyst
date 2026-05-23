//! Criterion microbenches for the prompt cache hot path.
//!
//! Three benches:
//!   * `hot_hit_lookup`                  — HOT-only lookup latency on warm key.
//!   * `warm_hit_lookup_with_persistence` — WARM lookup hitting SQLite.
//!   * `key_scoping_collision_check`      — L1 keying overhead (blake3).
//!
//! Run with: `cargo bench -p apohara-prompt-cache`. Baselines registered
//! by criterion under `target/criterion/`.

use apohara_prompt_cache::hot::{CachedResponse, HotCache};
use apohara_prompt_cache::key::key_scope;
use apohara_prompt_cache::warm::WarmCache;
use criterion::{black_box, criterion_group, criterion_main, Criterion};
use tempfile::TempDir;

fn bench_hot_hit_lookup(c: &mut Criterion) {
    let hot = HotCache::new(1024);
    let key = key_scope("warm prompt", "claude-code-cli", "sonnet-4-7");
    hot.put(
        key,
        CachedResponse {
            content: b"cached-response-payload".to_vec(),
            simhash: 0xDEAD_BEEF,
            timestamp: 1,
        },
    );

    c.bench_function("hot_hit_lookup", |b| {
        b.iter(|| {
            let got = hot.get(black_box(&key));
            black_box(got);
        });
    });
}

fn bench_warm_hit_lookup_with_persistence(c: &mut Criterion) {
    let dir = TempDir::new().expect("tempdir");
    let warm = WarmCache::open(dir.path().join("bench.db")).expect("open warm");
    let key = key_scope("persistent prompt", "claude-code-cli", "sonnet-4-7");
    warm.put(
        &key,
        &CachedResponse {
            content: b"persisted-payload".to_vec(),
            simhash: 0xCAFE_BABE,
            timestamp: 1,
        },
    )
    .expect("put");

    c.bench_function("warm_hit_lookup_with_persistence", |b| {
        b.iter(|| {
            let got = warm.get(black_box(&key)).expect("get");
            black_box(got);
        });
    });
}

fn bench_key_scoping_collision_check(c: &mut Criterion) {
    // Pretend we're checking provider+model isolation for every dispatch.
    let prompt = "summarise the quarterly report including segment-level revenue";
    let providers = ["claude-code-cli", "codex-cli", "opencode-go"];
    let model = "sonnet-4-7";

    c.bench_function("key_scoping_collision_check", |b| {
        b.iter(|| {
            let mut acc: u8 = 0;
            for p in providers.iter() {
                let k = key_scope(black_box(prompt), black_box(p), black_box(model));
                // Sum the first byte just to ensure the compiler can't elide.
                acc = acc.wrapping_add(k[0]);
            }
            black_box(acc)
        });
    });
}

criterion_group!(
    benches,
    bench_hot_hit_lookup,
    bench_warm_hit_lookup_with_persistence,
    bench_key_scoping_collision_check
);
criterion_main!(benches);
