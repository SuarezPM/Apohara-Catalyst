//! Microbenches for the spec hot paths.
//!
//! Two scenarios:
//!   1. `parse_plan_document_str` — pure parse, no IO. Sets the floor for
//!      how cheap a plan reparse can be when the cache misses (e.g. after
//!      a hot-reload validate emits cache.clear).
//!   2. `plan_status_cache_fast_path` — `PlanStatusCache::get_fast` on a
//!      file whose mtime + size are unchanged. This is the steady-state
//!      hit path the PlansPanel re-issues on every UI refresh; it must
//!      be cheap.
//!
//! Target on Pablo's Ryzen 5 3600: parse p50 < 50μs, fast-path p50 < 25μs.

use apohara_spec::plan_documents::parse_plan_document_str;
use apohara_spec::plan_status_cache::PlanStatusCache;
use criterion::{black_box, criterion_group, criterion_main, Criterion};
use std::path::Path;
use tempfile::TempDir;

const SAMPLE_PLAN: &str = "---\n\
title: Bench Plan\n\
status: active\n\
planType: feature\n\
priority: normal\n\
owner: pablo\n\
tags: [bench, rust]\n\
progress: 0.42\n\
---\n\
## Objective\n\
Run the Phase 1 spec port to a profilable state.\n\n\
## Acceptance Criteria\n\
- [x] First criterion satisfied\n\
- [ ] Second criterion pending\n\
- [ ] Third criterion pending\n\
- [x] Fourth criterion satisfied\n\n\
## Out of Scope\n\
- async file watcher rewrite\n\
- providers wired into tauri\n\n\
## Context\n\
Sample plan body used to size the parse microbench. Real plans run from\n\
~30 lines (this one) up to ~300; the parse is linear in section count so\n\
this is a representative midpoint.\n";

fn bench_parse_plan_document(c: &mut Criterion) {
    let path = Path::new("/tmp/bench-plan.md");
    c.bench_function("parse_plan_document_str", |b| {
        b.iter(|| {
            parse_plan_document_str(black_box(path), black_box(SAMPLE_PLAN)).unwrap();
        });
    });
}

fn bench_plan_status_cache_fast_path(c: &mut Criterion) {
    let tmp = TempDir::new().unwrap();
    let path = tmp.path().join("bench-plan.md");
    std::fs::write(&path, SAMPLE_PLAN).unwrap();
    let cache = PlanStatusCache::new();
    // Prime the cache so the bench measures the steady-state hit.
    cache.get_fast(&path).unwrap();

    c.bench_function("plan_status_cache_fast_path", |b| {
        b.iter(|| {
            cache.get_fast(black_box(&path)).unwrap();
        });
    });
}

criterion_group!(benches, bench_parse_plan_document, bench_plan_status_cache_fast_path);
criterion_main!(benches);
