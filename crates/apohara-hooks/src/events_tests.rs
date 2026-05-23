//! Behavioural parity tests for the events parser. Mirrors TS expectations
//! from `src/core/hooks/events.ts` (the TS module ships no unit-test file
//! but the wire contract is the SSoT).

use super::events::{parse_hook_event, HookEvent, ParseHookEventError, PermissionScope, StopReason};
use serde_json::json;

#[test]
fn rejects_non_object() {
    let err = parse_hook_event(&json!("oops")).unwrap_err();
    assert_eq!(err, ParseHookEventError::NotObject);
}

#[test]
fn rejects_missing_type() {
    let err = parse_hook_event(&json!({ "pane_key": "x" })).unwrap_err();
    assert_eq!(err, ParseHookEventError::MissingType);
}

#[test]
fn rejects_missing_pane_key() {
    let err = parse_hook_event(&json!({ "type": "stop" })).unwrap_err();
    assert_eq!(err, ParseHookEventError::MissingPaneKey);
}

#[test]
fn rejects_unknown_event_type() {
    let err = parse_hook_event(&json!({
        "type": "weird_event",
        "pane_key": "p1",
        "payload": {}
    }))
    .unwrap_err();
    assert_eq!(err, ParseHookEventError::UnknownType("weird_event".into()));
}

#[test]
fn parses_pre_tool_use() {
    let ev = parse_hook_event(&json!({
        "type": "pre_tool_use",
        "pane_key": "p1",
        "task_id": "t1",
        "payload": {
            "tool_name": "Read",
            "tool_input": { "path": "/etc/hosts" },
            "timestamp": 1700000000
        }
    }))
    .unwrap();
    match ev {
        HookEvent::PreToolUse {
            common_context,
            tool_name,
            timestamp,
            ..
        } => {
            assert_eq!(common_context.pane_key, "p1");
            assert_eq!(common_context.task_id.as_deref(), Some("t1"));
            assert_eq!(tool_name, "Read");
            assert_eq!(timestamp, 1700000000);
        }
        _ => panic!("wrong variant"),
    }
}

#[test]
fn post_tool_use_defaults_duration_when_missing() {
    let ev = parse_hook_event(&json!({
        "type": "post_tool_use",
        "pane_key": "p",
        "payload": {
            "tool_name": "Bash",
            "tool_output": null,
            "timestamp": 1
        }
    }))
    .unwrap();
    match ev {
        HookEvent::PostToolUse { duration_ms, .. } => assert_eq!(duration_ms, 0),
        _ => panic!("wrong variant"),
    }
}

#[test]
fn parses_stop_with_valid_reason() {
    let ev = parse_hook_event(&json!({
        "type": "stop",
        "pane_key": "p",
        "payload": { "reason": "completed", "timestamp": 9 }
    }))
    .unwrap();
    assert!(matches!(
        ev,
        HookEvent::Stop {
            reason: StopReason::Completed,
            ..
        }
    ));
}

#[test]
fn rejects_invalid_stop_reason() {
    let err = parse_hook_event(&json!({
        "type": "stop",
        "pane_key": "p",
        "payload": { "reason": "exploded", "timestamp": 1 }
    }))
    .unwrap_err();
    assert_eq!(err, ParseHookEventError::InvalidStopReason("exploded".into()));
}

#[test]
fn parses_user_prompt_submit() {
    let ev = parse_hook_event(&json!({
        "type": "user_prompt_submit",
        "pane_key": "p",
        "payload": { "prompt": "hello", "timestamp": 1 }
    }))
    .unwrap();
    assert!(matches!(ev, HookEvent::UserPromptSubmit { .. }));
}

#[test]
fn parses_permission_request_with_scope() {
    let ev = parse_hook_event(&json!({
        "type": "permission_request",
        "pane_key": "p",
        "payload": {
            "tool_name": "Bash",
            "tool_input": { "command": "ls" },
            "scope_proposed": "session",
            "timestamp": 1
        }
    }))
    .unwrap();
    match ev {
        HookEvent::PermissionRequest { scope_proposed, .. } => {
            assert_eq!(scope_proposed, Some(PermissionScope::Session));
        }
        _ => panic!("wrong variant"),
    }
}

#[test]
fn permission_request_unknown_scope_becomes_none() {
    let ev = parse_hook_event(&json!({
        "type": "permission_request",
        "pane_key": "p",
        "payload": {
            "tool_name": "Bash",
            "scope_proposed": "forever",
            "timestamp": 1
        }
    }))
    .unwrap();
    match ev {
        HookEvent::PermissionRequest { scope_proposed, .. } => {
            assert_eq!(scope_proposed, None);
        }
        _ => panic!("wrong variant"),
    }
}

#[test]
fn rejects_when_required_string_missing() {
    let err = parse_hook_event(&json!({
        "type": "pre_tool_use",
        "pane_key": "p",
        "payload": { "timestamp": 1 }
    }))
    .unwrap_err();
    assert_eq!(
        err,
        ParseHookEventError::FieldMustBeString { field: "tool_name" }
    );
}

#[test]
fn rejects_when_required_number_missing() {
    let err = parse_hook_event(&json!({
        "type": "pre_tool_use",
        "pane_key": "p",
        "payload": { "tool_name": "Read" }
    }))
    .unwrap_err();
    assert_eq!(
        err,
        ParseHookEventError::FieldMustBeNumber { field: "timestamp" }
    );
}
