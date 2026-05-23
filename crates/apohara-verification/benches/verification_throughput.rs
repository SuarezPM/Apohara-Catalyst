//! Microbench for the verification hot paths.
//!
//! Two benches:
//!
//! 1. `quality_gates_run_all` — every dispatch that goes through the
//!    critic verification mesh hits this once. The OWASP regex cache
//!    (10 patterns) is the biggest cost; this bench amortizes that
//!    over a realistic backend-persona payload.
//! 2. `hallucination_detect_small` — fires per coder turn against
//!    every newly produced file. Tail latency here dominates the
//!    critic round-trip when a generator emits 50+ files.
//!
//! Baselines on Pablo's Ryzen 5 3600 (matches the §0.4 envSanitizer
//! microbench in TS): targets are < 50μs/iter for gates and
//! < 100μs/iter for the small detect call. Real numbers go into the
//! Sprint 13 cierre commit.

use apohara_verification::hallucination_flag::{detect_hallucinations, DetectArgs};
use apohara_verification::quality_gates::{run_all_gates, AgentRole, GateInput, Persona};
use criterion::{black_box, criterion_group, criterion_main, Criterion};
use std::collections::HashSet;
use std::path::PathBuf;

fn bench_quality_gates_run_all(c: &mut Criterion) {
    let input = GateInput {
        task_role: AgentRole::Critic,
        persona: Some(Persona::Backend),
        diff: "diff --git a/server.rs b/server.rs\n+ handle_login()\n".to_string(),
        output: "Finding 1: SQL injection risk. Finding 2: XSS via reflected param. severity: high. root cause: shared input handler. Trade-off: speed over typing. Alternatives considered: ORM, prepared statements. remediation: parameterize queries.".to_string(),
    };

    c.bench_function("quality_gates_run_all", |b| {
        b.iter(|| run_all_gates(black_box(&input)));
    });
}

fn bench_hallucination_detect_small(c: &mut Criterion) {
    let workspace = PathBuf::from("/tmp/apohara-bench-detect");
    let code = r#"
import { foo } from "./util";
import { bar } from "react";
import "./polyfill";

doThing();
known();
obj.method();
"#;
    let existing = vec![PathBuf::from("/tmp/apohara-bench-detect/util.ts")];
    let mut defined: HashSet<String> = HashSet::new();
    defined.insert("known".to_string());

    c.bench_function("hallucination_detect_small", |b| {
        b.iter(|| {
            detect_hallucinations(black_box(&DetectArgs {
                code,
                existing_files: &existing,
                workspace_path: &workspace,
                defined_symbols: Some(&defined),
            }))
        });
    });
}

criterion_group!(
    benches,
    bench_quality_gates_run_all,
    bench_hallucination_detect_small
);
criterion_main!(benches);
