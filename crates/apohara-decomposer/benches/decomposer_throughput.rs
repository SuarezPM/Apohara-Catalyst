//! Microbench: SPEC.md → tasks manifest decomposition.
//!
//! Builds a representative midsize SPEC (~200 lines, 40 tasks each with
//! a depends + role bullet + prose) and measures `decompose_spec` p50
//! on a Ryzen 5 3600. Pure CPU, no I/O.

use apohara_decomposer::decompose_spec;
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn build_midsize_spec(task_count: usize) -> String {
    let mut s = String::with_capacity(task_count * 200);
    s.push_str("# Sprint Plan\n\nDescriptive prose section explaining context.\n\n");
    s.push_str("## Background\n\nMore prose. Multiple paragraphs.\n\n");
    for i in 0..task_count {
        s.push_str(&format!(
            "## Task t{i}: implement subsystem {i}\n\
             Some description. The implementer should focus on correctness first.\n\
             - depends: t{prev}\n\
             - role: {role}\n\n\
             Additional notes about the task that the parser should ignore.\n\
             Multiple lines of context describing edge cases.\n\n",
            i = i,
            prev = if i == 0 { 0 } else { i - 1 },
            role = match i % 6 {
                0 => "coder",
                1 => "planner",
                2 => "critic",
                3 => "judge",
                4 => "explorer",
                _ => "editor",
            },
        ));
    }
    s
}

fn bench_decompose_midsize(c: &mut Criterion) {
    // 40 tasks * ~5 lines each + headers/prose = ~210 lines.
    let spec = build_midsize_spec(40);
    let line_count = spec.lines().count();
    let mut group = c.benchmark_group("decomposer");
    group.bench_function(format!("decompose_spec_midsize_{line_count}lines"), |b| {
        b.iter(|| {
            let m = decompose_spec(black_box(&spec));
            black_box(m);
        });
    });
    group.finish();
}

criterion_group!(benches, bench_decompose_midsize);
criterion_main!(benches);
