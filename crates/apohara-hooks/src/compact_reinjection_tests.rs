//! Mirrors `src/core/hooks/compact-reinjection.test.ts`.

use super::compact_reinjection::{
    CompactHookEvent, CompactReinjector, ContractSnapshot, HookOutcome, PreCompactContract,
};
use serde_json::json;

fn snap(session: &str, plans: &[&str], task: Option<&str>, notes: Option<&str>) -> ContractSnapshot {
    ContractSnapshot {
        session_id: session.into(),
        captured_at: 100,
        active_plan_ids: plans.iter().map(|s| s.to_string()).collect(),
        active_task_id: task.map(|s| s.to_string()),
        settings: json!({}),
        notes: notes.map(|s| s.to_string()),
    }
}

#[test]
fn consume_returns_none_for_unknown_session() {
    let r = CompactReinjector::new();
    assert!(r.consume("session-1").is_none());
}

#[test]
fn capture_then_consume_is_destructive() {
    let r = CompactReinjector::new();
    r.capture(snap("session-1", &["plan-1", "plan-2"], Some("task-9"), None));
    let out = r.consume("session-1").unwrap();
    assert_eq!(out.active_plan_ids, vec!["plan-1", "plan-2"]);
    assert!(r.consume("session-1").is_none());
}

#[test]
fn snapshots_isolated_per_session() {
    let r = CompactReinjector::new();
    r.capture(snap("s-a", &["a"], None, None));
    r.capture(snap("s-b", &["b"], None, None));
    assert_eq!(r.consume("s-a").unwrap().active_plan_ids, vec!["a"]);
    assert_eq!(r.consume("s-b").unwrap().active_plan_ids, vec!["b"]);
}

#[test]
fn pre_compact_twice_overwrites() {
    let r = CompactReinjector::new();
    r.capture(snap("s", &["v1"], None, None));
    r.capture(snap("s", &["v2"], None, None));
    assert_eq!(r.consume("s").unwrap().active_plan_ids, vec!["v2"]);
}

#[test]
fn render_includes_contract_bits_and_is_destructive() {
    let r = CompactReinjector::new();
    r.capture(ContractSnapshot {
        session_id: "s".into(),
        captured_at: 42,
        active_plan_ids: vec!["plan-x".into()],
        active_task_id: Some("task-y".into()),
        settings: json!({ "trustPreset": "strict" }),
        notes: Some("post-compact reload required".into()),
    });
    let env = r.render_additional_context("s").unwrap();
    assert!(env.additional_context.contains("plan-x"));
    assert!(env.additional_context.contains("task-y"));
    assert!(env.additional_context.contains("strict"));
    assert!(r.consume("s").is_none());
}

#[test]
fn render_returns_none_when_no_snapshot() {
    let r = CompactReinjector::new();
    assert!(r.render_additional_context("missing").is_none());
}

#[test]
fn pre_then_post_round_trip() {
    let r = CompactReinjector::new();
    let pre = r.on_hook_event(CompactHookEvent::PreCompact {
        session_id: "session-x".into(),
        contract: PreCompactContract {
            active_plan_ids: vec!["p1".into()],
            active_task_id: Some("t1".into()),
            settings: json!({ "mode": "gpu" }),
            notes: None,
        },
        timestamp: 100,
    });
    assert_eq!(pre, HookOutcome::Captured);

    let post = r.on_hook_event(CompactHookEvent::PostCompact {
        session_id: "session-x".into(),
        timestamp: 200,
    });
    match post {
        HookOutcome::Reinjected {
            additional_context, ..
        } => {
            assert!(additional_context.contains("p1"));
            assert!(additional_context.contains("t1"));
        }
        other => panic!("expected Reinjected, got {other:?}"),
    }
}

#[test]
fn post_without_pre_is_noop() {
    let r = CompactReinjector::new();
    let out = r.on_hook_event(CompactHookEvent::PostCompact {
        session_id: "missing".into(),
        timestamp: 1,
    });
    assert_eq!(out, HookOutcome::Noop);
}
