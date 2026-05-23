//! Mirrors `src/core/hooks/learnings-dump.test.ts`.

use super::events::StopReason;
use super::learnings_dump::{
    DumpOptions, LearningCategory, LearningEntry, LearningsCollector, LearningsHookEvent,
    LearningsHookOutcome,
};
use std::fs;

#[test]
fn starts_empty() {
    let c = LearningsCollector::new();
    let snap = c.snapshot();
    assert!(snap.discoveries.is_empty());
    assert!(snap.decisions.is_empty());
    assert!(snap.incidents.is_empty());
    assert!(snap.conventions.is_empty());
    assert!(snap.next_steps.is_empty());
}

#[test]
fn collects_entries_by_category() {
    let c = LearningsCollector::new();
    c.add(LearningEntry {
        category: LearningCategory::Discoveries,
        title: "found undocumented flag".into(),
        detail: "--mock-embeddings skips Nomic model load".into(),
    });
    c.add(LearningEntry {
        category: LearningCategory::Decisions,
        title: "use SSE not WebSocket".into(),
        detail: "simpler reconnect semantics".into(),
    });
    c.add(LearningEntry {
        category: LearningCategory::NextSteps,
        title: "wire G5.C.6".into(),
        detail: "depends on this".into(),
    });
    let snap = c.snapshot();
    assert_eq!(snap.discoveries.len(), 1);
    assert_eq!(snap.decisions.len(), 1);
    assert_eq!(snap.next_steps.len(), 1);
    assert_eq!(snap.incidents.len(), 0);
}

#[test]
fn dump_writes_json_with_all_categories() {
    let tmp = tempfile::tempdir().unwrap();
    let c = LearningsCollector::new();
    c.add(LearningEntry {
        category: LearningCategory::Discoveries,
        title: "x".into(),
        detail: "y".into(),
    });
    c.add(LearningEntry {
        category: LearningCategory::Incidents,
        title: "timeout at 120s".into(),
        detail: "claude CLI lock contention".into(),
    });
    let out = c
        .dump(&DumpOptions {
            session_id: "session-abc".into(),
            dir: tmp.path().to_path_buf(),
            finished_at: 1_000_000_000_000,
            objective: "G5.C work".into(),
        })
        .unwrap();
    assert!(out.to_string_lossy().contains("session-abc"));
    let raw = fs::read_to_string(&out).unwrap();
    let parsed: serde_json::Value = serde_json::from_str(&raw).unwrap();
    assert_eq!(parsed["sessionId"], "session-abc");
    assert_eq!(parsed["objective"], "G5.C work");
    assert_eq!(parsed["finishedAt"], 1_000_000_000_000i64);
    assert_eq!(parsed["learnings"]["discoveries"][0]["title"], "x");
    assert_eq!(parsed["learnings"]["incidents"][0]["title"], "timeout at 120s");
}

#[test]
fn dump_is_atomic_no_temp_leftover() {
    let tmp = tempfile::tempdir().unwrap();
    let c = LearningsCollector::new();
    c.add(LearningEntry {
        category: LearningCategory::Discoveries,
        title: "a".into(),
        detail: "b".into(),
    });
    c.dump(&DumpOptions {
        session_id: "atomic".into(),
        dir: tmp.path().to_path_buf(),
        finished_at: 1,
        objective: "test".into(),
    })
    .unwrap();

    let leftovers: Vec<_> = fs::read_dir(tmp.path())
        .unwrap()
        .filter_map(|e| e.ok())
        .filter(|e| {
            let name = e.file_name();
            let s = name.to_string_lossy();
            // NamedTempFile uses random prefixes; check the canonical
            // result file is present and nothing matches a tmp pattern.
            !s.starts_with("learnings-")
        })
        .collect();
    assert!(
        leftovers.is_empty(),
        "expected only the renamed file; found {:?}",
        leftovers.iter().map(|e| e.file_name()).collect::<Vec<_>>()
    );
}

#[test]
fn render_includes_category_headers_and_entries() {
    let c = LearningsCollector::new();
    c.add(LearningEntry {
        category: LearningCategory::Decisions,
        title: "use bun:sqlite".into(),
        detail: "native + zero-dep".into(),
    });
    c.add(LearningEntry {
        category: LearningCategory::NextSteps,
        title: "wire reconnect backfill".into(),
        detail: "depends on Last-Event-ID".into(),
    });
    let env = c.render_additional_context();
    assert!(env.additional_context.contains("use bun:sqlite"));
    assert!(env.additional_context.contains("wire reconnect backfill"));
    assert!(env.additional_context.contains("Decisions"));
    assert!(env.additional_context.contains("Next steps"));
}

#[test]
fn render_is_empty_when_no_entries() {
    let c = LearningsCollector::new();
    let env = c.render_additional_context();
    assert_eq!(env.additional_context, "");
}

#[test]
fn on_hook_event_session_stop_records_next_step() {
    let c = LearningsCollector::new();
    let out = c.on_hook_event(LearningsHookEvent::SessionStop {
        session_id: "s".into(),
        reason: StopReason::Completed,
        timestamp: 1,
    });
    assert_eq!(out, LearningsHookOutcome::Recorded);
    let env = c.render_additional_context();
    assert!(env.additional_context.contains("completed"));
}

#[test]
fn on_hook_event_session_learning_routes_to_category() {
    let c = LearningsCollector::new();
    let out = c.on_hook_event(LearningsHookEvent::SessionLearning {
        category: LearningCategory::Conventions,
        title: "no api keys to subprocesses".into(),
        detail: "see CLAUDE.md".into(),
        timestamp: 1,
    });
    assert_eq!(out, LearningsHookOutcome::Recorded);
    let snap = c.snapshot();
    assert_eq!(snap.conventions.len(), 1);
    assert_eq!(snap.conventions[0].title, "no api keys to subprocesses");
}
