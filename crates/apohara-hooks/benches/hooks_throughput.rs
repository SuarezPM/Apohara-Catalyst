//! Microbenches for `apohara-hooks`.
//!
//! Two scenarios that mirror the two hot paths in production:
//!
//! 1. `dispatch_event_pretooluse` — parsing a hook envelope into a typed
//!    `HookEvent`. Hot because every tool call from every agent flows
//!    through this on the way into the broadcast channel.
//! 2. `installer_idempotent_hash_match` — install diff comparison when
//!    nothing changed. The hot case during `apohara doctor` and any
//!    re-install after a no-op SPEC update.
//!
//! Both fit under 50 us on a Ryzen 5 3600 (p50 numbers in commit
//! message).

use apohara_hooks::events::parse_hook_event;
use apohara_hooks::installer::install_hook;
use criterion::{black_box, criterion_group, criterion_main, Criterion};
use serde_json::json;

fn bench_dispatch_event_pretooluse(c: &mut Criterion) {
    let envelope = json!({
        "type": "pre_tool_use",
        "pane_key": "pane-1",
        "task_id": "task-42",
        "worktree_id": "wt-1",
        "payload": {
            "tool_name": "Bash",
            "tool_input": { "command": "npm test --silent", "timeout_ms": 30000 },
            "timestamp": 1_700_000_000_000_i64
        }
    });
    c.bench_function("hooks_dispatch_event_pretooluse", |b| {
        b.iter(|| {
            let ev = parse_hook_event(black_box(&envelope)).expect("parse ok");
            black_box(ev);
        })
    });
}

fn bench_installer_idempotent_hash_match(c: &mut Criterion) {
    // Set up a real on-disk hook script then re-install the same body
    // — the hash compare short-circuits and returns SkippedHashMatch.
    let tmp = tempfile::tempdir().expect("tmpdir");
    let path = tmp.path().join("hook.sh");
    let body = "#!/bin/sh\nexec /usr/bin/env apohara-hook \"$@\"\n";
    install_hook(&path, body).expect("seed install");
    c.bench_function("hooks_installer_idempotent_hash_match", |b| {
        b.iter(|| {
            let res = install_hook(black_box(&path), black_box(body)).expect("idempotent ok");
            black_box(res);
        })
    });
}

criterion_group!(
    benches,
    bench_dispatch_event_pretooluse,
    bench_installer_idempotent_hash_match
);
criterion_main!(benches);
