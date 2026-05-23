//! Microbenchmarks for the hot paths of apohara-safety.
//!
//! Two scenarios:
//!   1. bash_compound_analysis — splitCompound on a typical compound
//!      command (the call-site fires on every Bash invocation that
//!      enters the permission service).
//!   2. permission_grid_lookup — get on a populated PermissionGrid (the
//!      UI permission table rebinds on every render).
//!
//! Run: cargo bench -p apohara-safety
//! Document p50 in the cierre commit.

use apohara_safety::{
    permission_grid::{PermissionGrid, PermissionScope, PermissionState},
    split_compound,
};
use criterion::{black_box, criterion_group, criterion_main, Criterion};

fn bench_bash_compound(c: &mut Criterion) {
    // Realistic call: a deploy script with substitution + pipe + &&.
    let cmd = "git pull && cargo build --release && \
        tar czf $(date +backup-%Y%m%d.tgz) target/release | \
        ssh deploy@host 'cd /srv && tar xzf -'";
    c.bench_function("bash_compound_analysis", |b| {
        b.iter(|| {
            let legs = split_compound(black_box(cmd));
            black_box(legs);
        })
    });
}

fn bench_permission_grid_lookup(c: &mut Criterion) {
    // Populate with 100 scope/resource cells — representative of a
    // mid-size session.
    let mut grid = PermissionGrid::new();
    for i in 0..100 {
        grid.set(
            match i % 3 {
                0 => PermissionScope::Once,
                1 => PermissionScope::Session,
                _ => PermissionScope::Always,
            },
            &format!("cmd.exec.tool{i}"),
            if i % 2 == 0 {
                PermissionState::Allow
            } else {
                PermissionState::Deny
            },
        );
    }
    c.bench_function("permission_grid_lookup", |b| {
        b.iter(|| {
            let s = grid.get(
                black_box(PermissionScope::Session),
                black_box("cmd.exec.tool42"),
            );
            black_box(s);
        })
    });
}

criterion_group!(benches, bench_bash_compound, bench_permission_grid_lookup);
criterion_main!(benches);
