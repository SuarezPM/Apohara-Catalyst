//! Microbenches for the three ContextForge primitives.
//!
//! Run with: `cargo bench -p apohara-context-primitives`
//!
//! Targets the hot paths exposed downstream:
//!   * `simhash_64_typical_doc` — 64-bit SimHash of a ~120-token doc
//!   * `lsh_lookup_10k_signatures` — query an LSH index populated with 10k random sigs
//!   * `queueing_admission_decision` — admit() on a warmed-up controller

use std::hint::black_box;
use std::time::{Duration, Instant};

use apohara_context_primitives::{
    simhash_64, AdmissionDecision, BandScheme, Controller, ControllerConfig, LshIndex,
};
use criterion::{criterion_group, criterion_main, Criterion};

const TYPICAL_DOC: &str = "\
the quick brown fox jumps over the lazy dog while a panel of curious owls watches \
silently from the oak tree the autumn wind rustles the leaves and somewhere a clock \
chimes the hour the cat on the windowsill twitches its whiskers and the kettle on the \
stove begins to whistle softly drawing the attention of the cook who hums a small tune \
as the sky outside slowly turns from blue to orange and finally to a deep velvet purple";

fn bench_simhash_64(c: &mut Criterion) {
    c.bench_function("simhash_64_typical_doc", |b| {
        b.iter(|| simhash_64(black_box(TYPICAL_DOC)))
    });
}

fn bench_lsh_lookup_10k(c: &mut Criterion) {
    let scheme = BandScheme::new(8).unwrap();
    let mut idx = LshIndex::new(scheme);
    // Deterministic LCG so the bench is reproducible across runs.
    let mut state: u64 = 0x9E37_79B9_7F4A_7C15;
    for _ in 0..10_000 {
        state = state.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        idx.insert(state);
    }
    let query = 0xDEAD_BEEF_CAFE_BABEu64;

    c.bench_function("lsh_lookup_10k_signatures", |b| {
        b.iter(|| {
            let hits = idx.query(black_box(query), 8);
            black_box(hits.len())
        })
    });
}

fn bench_queueing_admission(c: &mut Criterion) {
    // Pre-warm a controller with realistic stats so admit() exercises the
    // full Erlang-C path, not the cold-start defaults.
    let mut ctrl = Controller::new(ControllerConfig {
        servers: 4,
        window_seconds: 5.0,
        target_utilization: 0.8,
        min_stable_concurrency: 4,
    });
    let t0 = Instant::now();
    for i in 0..32 {
        ctrl.record_arrival(t0 + Duration::from_millis(i * 50));
        ctrl.record_completion(Duration::from_millis(100));
    }

    c.bench_function("queueing_admission_decision", |b| {
        b.iter(|| {
            let d = ctrl.admit();
            // Touch the variant so the optimizer can't fold the call away.
            match black_box(d) {
                AdmissionDecision::Admit => 1u8,
                AdmissionDecision::Defer { .. } => 2u8,
                AdmissionDecision::Reject => 3u8,
            }
        })
    });
}

criterion_group!(
    benches,
    bench_simhash_64,
    bench_lsh_lookup_10k,
    bench_queueing_admission,
);
criterion_main!(benches);
