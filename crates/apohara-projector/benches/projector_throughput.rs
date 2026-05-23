//! Microbenches for apohara-projector.
//!
//! Two hot paths measured on a Ryzen 5 3600 baseline (see Cargo.toml
//! workspace authors):
//! 1. project_to_ui_cards on ~50 events (real ledger scale per session)
//! 2. diff_patch + apply_patch roundtrip on a midsize TaskBoard snapshot
//!    (50 task entries, one mutated between snapshots)

use apohara_projector::{
    apply_patch, diff_patch, project_to_search_rows, project_to_ui_cards, EventLog,
    EventMetadata, EventSeverity,
};
use criterion::{black_box, criterion_group, criterion_main, Criterion};
use serde_json::{json, Value};

fn build_events(n_tasks: usize) -> Vec<EventLog> {
    // 3 events per task (scheduled + 1 noise + completed) => ~50 events
    // for n_tasks=16, matching the v1 design target.
    let mut events = Vec::with_capacity(n_tasks * 3);
    for i in 0..n_tasks {
        let task_id = format!("task-{i:04}");
        events.push(EventLog {
            id: format!("e-sched-{i}"),
            timestamp: "2026-05-22T10:00:00Z".to_string(),
            event_type: "task_scheduled".to_string(),
            severity: EventSeverity::Info,
            task_id: Some(task_id.clone()),
            payload: json!({
                "prompt": "Implement feature X with reasonable test coverage",
                "workdir": "/home/pablo/repo",
                "providerId": "claude-code-cli",
            }),
            metadata: Some(EventMetadata {
                provider: Some("claude-code-cli".to_string()),
            }),
        });
        events.push(EventLog {
            id: format!("e-log-{i}"),
            timestamp: "2026-05-22T10:00:02Z".to_string(),
            event_type: "log".to_string(),
            severity: EventSeverity::Info,
            task_id: Some(task_id.clone()),
            payload: json!({"message": "tool invocation: bash"}),
            metadata: None,
        });
        events.push(EventLog {
            id: format!("e-done-{i}"),
            timestamp: "2026-05-22T10:00:05.000Z".to_string(),
            event_type: "task_completed".to_string(),
            severity: EventSeverity::Info,
            task_id: Some(task_id),
            payload: json!({"content": "Task done — see PR #123"}),
            metadata: None,
        });
    }
    events
}

fn build_snapshot(n_tasks: usize) -> Value {
    let mut tasks = serde_json::Map::with_capacity(n_tasks);
    for i in 0..n_tasks {
        tasks.insert(
            format!("task-{i:04}"),
            json!({
                "status": "pending",
                "providerId": "claude-code-cli",
                "prompt": "implement",
                "scheduledAt": "2026-05-22T10:00:00Z",
            }),
        );
    }
    json!({"tasks": Value::Object(tasks), "version": 1})
}

fn mutate_one_task(mut snap: Value) -> Value {
    if let Some(t) = snap
        .get_mut("tasks")
        .and_then(|t| t.get_mut("task-0007"))
        .and_then(Value::as_object_mut)
    {
        t.insert("status".to_string(), json!("completed"));
        t.insert("result".to_string(), json!("ok"));
    }
    if let Some(v) = snap.get_mut("version") {
        *v = json!(2);
    }
    snap
}

fn bench_ui_cards(c: &mut Criterion) {
    // ~50 events corresponds to 16 tasks * 3 events; the spec
    // target was midsize transcript ~50 events.
    let events = build_events(16);
    c.bench_function("project_to_ui_cards_16tasks_48events", |b| {
        b.iter(|| {
            let out = project_to_ui_cards(black_box(&events));
            black_box(out);
        });
    });
}

fn bench_search_rows(c: &mut Criterion) {
    let events = build_events(16);
    c.bench_function("project_to_search_rows_16tasks_48events", |b| {
        b.iter(|| {
            let out = project_to_search_rows(black_box(&events));
            black_box(out);
        });
    });
}

fn bench_patch_roundtrip(c: &mut Criterion) {
    let prev = build_snapshot(50);
    let next = mutate_one_task(prev.clone());
    c.bench_function("json_patch_roundtrip_50tasks_1mutated", |b| {
        b.iter(|| {
            let patch = diff_patch(black_box(&prev), black_box(&next));
            let restored = apply_patch(black_box(&prev), black_box(&patch));
            black_box(restored);
        });
    });
}

criterion_group!(
    benches,
    bench_ui_cards,
    bench_search_rows,
    bench_patch_roundtrip
);
criterion_main!(benches);
