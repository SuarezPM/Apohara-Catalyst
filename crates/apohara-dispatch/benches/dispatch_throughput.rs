//! Microbench for the dispatch hot path. The first bench covers
//! `build_spawn_env` — every dispatch hits it once, so its cost
//! shows up in p95/p99 tail latency when the reconciler fires
//! N tasks back-to-back. Baseline target: < 100μs/iter on Pablo's
//! Ryzen 5 3600 (matches the §0.4 envSanitizer microbench in TS).

use apohara_dispatch::cli_driver::build_spawn_env;
use apohara_dispatch::reconciler::{run_reconciler_passes, ReconcilerCtx};
use criterion::{black_box, criterion_group, criterion_main, Criterion};
use std::collections::HashMap;

fn bench_build_spawn_env(c: &mut Criterion) {
    let parent: HashMap<String, String> = std::env::vars().collect();
    c.bench_function("build_spawn_env", |b| {
        b.iter(|| build_spawn_env(black_box(&parent), "/tmp", r#"{"preset":"Balanced"}"#));
    });
}

fn bench_reconciler_empty_ledger(c: &mut Criterion) {
    let workspace = "/tmp/apohara-bench-reconciler";
    let ledger_path = format!("{workspace}/ledger.jsonl");
    std::fs::create_dir_all(workspace).ok();
    std::fs::write(&ledger_path, "").ok();

    let ctx = ReconcilerCtx {
        ledger_path: ledger_path.clone(),
        workspace: workspace.to_string(),
        session_id: "bench".to_string(),
        blocked_aging_ms: 300_000,
        stall_timeout_ms: 300_000,
    };

    c.bench_function("reconciler_empty_ledger", |b| {
        b.iter(|| run_reconciler_passes(black_box(&ctx)).unwrap());
    });
}

criterion_group!(benches, bench_build_spawn_env, bench_reconciler_empty_ledger);
criterion_main!(benches);
