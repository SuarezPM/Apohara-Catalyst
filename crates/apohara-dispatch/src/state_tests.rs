//! Tests for the run state machine (ported from `src/core/dispatch/state.ts`).

use crate::state::{
    can_transition, fresh_claim_token, is_claimable, phase_implies_success, BlockedReason,
    RunPhase, RunState, RunTransition, TransitionState,
};

#[test]
fn run_transition_serializes_blocked_with_reason() {
    let t = RunTransition {
        state: TransitionState::Blocked,
        blocked_reason: Some(BlockedReason::ApprovalRequired),
        blocked_since: Some(1_000_000),
        detail: Some("waiting on user".to_string()),
    };
    let json = serde_json::to_string(&t).unwrap();
    // Wire keys must be camelCase to match the TS `RunTransition` interface
    // (`blockedReason`, `blockedSince`) — the orchestration DB stores these
    // verbatim, and the reconciler / UI both read the camelCase form.
    assert!(json.contains("\"blockedReason\":\"approval_required\""));
    assert!(json.contains("\"blockedSince\":1000000"));
    assert!(json.contains("\"state\":\"blocked\""));
    let parsed: RunTransition = serde_json::from_str(&json).unwrap();
    assert_eq!(parsed.state, TransitionState::Blocked);
    assert_eq!(parsed.blocked_reason, Some(BlockedReason::ApprovalRequired));
    assert_eq!(parsed.blocked_since, Some(1_000_000));
    assert_eq!(parsed.detail.as_deref(), Some("waiting on user"));
}

#[test]
fn run_transition_running_has_no_blocked_fields() {
    let t = RunTransition {
        state: TransitionState::Run(RunState::Running),
        blocked_reason: None,
        blocked_since: None,
        detail: None,
    };
    let json = serde_json::to_string(&t).unwrap();
    // serde(skip_serializing_if = "Option::is_none") must drop the
    // optional fields entirely so the wire payload matches TS, which
    // omits the keys (rather than emits `null`).
    assert!(!json.contains("blockedReason"));
    assert!(!json.contains("blockedSince"));
    assert!(!json.contains("detail"));
    assert_eq!(json, r#"{"state":"running"}"#);
}

#[test]
fn run_state_serde_wire_compat_with_ts() {
    // TS emits snake_case lowercase tags ("unclaimed", "claimed", ...).
    let s = serde_json::to_string(&RunState::RetryQueued).unwrap();
    assert_eq!(s, "\"retry_queued\"");
    let parsed: RunState = serde_json::from_str("\"released\"").unwrap();
    assert_eq!(parsed, RunState::Released);
}

#[test]
fn transition_state_serializes_blocked_as_string() {
    // `RunTransition.state` is `RunState | "blocked"` in TS; the union
    // collapses to a flat string on the wire (no { type: ... } envelope).
    let json = serde_json::to_value(TransitionState::Run(RunState::Claimed)).unwrap();
    assert_eq!(json, serde_json::json!("claimed"));
    let json_blocked = serde_json::to_value(TransitionState::Blocked).unwrap();
    assert_eq!(json_blocked, serde_json::json!("blocked"));
}

#[test]
fn run_phase_serde_terminal_set() {
    // RunPhase serializes snake_case too; terminal helpers must agree.
    let s = serde_json::to_string(&RunPhase::CanceledByReconciliation).unwrap();
    assert_eq!(s, "\"canceled_by_reconciliation\"");
    assert!(RunPhase::Succeeded.is_terminal());
    assert!(RunPhase::Failed.is_terminal());
    assert!(RunPhase::TimedOut.is_terminal());
    assert!(RunPhase::Stalled.is_terminal());
    assert!(RunPhase::CanceledByReconciliation.is_terminal());
    assert!(!RunPhase::StreamingTurn.is_terminal());
    assert!(!RunPhase::PreparingWorkspace.is_terminal());
}

#[test]
fn is_claimable_matches_ts_rules() {
    assert!(is_claimable(RunState::Unclaimed));
    assert!(is_claimable(RunState::Released));
    assert!(!is_claimable(RunState::Claimed));
    assert!(!is_claimable(RunState::Running));
    assert!(!is_claimable(RunState::RetryQueued));
}

#[test]
fn can_transition_matches_ts_dag() {
    // Allowed edges (from TS ALLOWED_TRANSITIONS).
    assert!(can_transition(RunState::Unclaimed, RunState::Claimed));
    assert!(can_transition(RunState::Claimed, RunState::Running));
    assert!(can_transition(RunState::Claimed, RunState::Released));
    assert!(can_transition(RunState::Running, RunState::RetryQueued));
    assert!(can_transition(RunState::Running, RunState::Released));
    assert!(can_transition(RunState::RetryQueued, RunState::Claimed));
    assert!(can_transition(RunState::RetryQueued, RunState::Released));
    assert!(can_transition(RunState::Released, RunState::Unclaimed));
    // Forbidden — these are the exact anti-patterns the TS comment names.
    assert!(!can_transition(RunState::Released, RunState::Running));
    assert!(!can_transition(RunState::Unclaimed, RunState::Running));
    assert!(!can_transition(RunState::Claimed, RunState::Unclaimed));
}

#[test]
fn phase_implies_success_only_for_succeeded() {
    assert!(phase_implies_success(RunPhase::Succeeded));
    assert!(!phase_implies_success(RunPhase::Failed));
    assert!(!phase_implies_success(RunPhase::TimedOut));
    assert!(!phase_implies_success(RunPhase::Stalled));
    assert!(!phase_implies_success(RunPhase::CanceledByReconciliation));
    assert!(!phase_implies_success(RunPhase::StreamingTurn));
}

#[test]
fn fresh_claim_token_is_unique_uuid_v4() {
    let a = fresh_claim_token();
    let b = fresh_claim_token();
    assert_ne!(a, b);
    // RFC 4122 v4 surface (36 chars with 4 dashes; the 13th char is '4').
    assert_eq!(a.len(), 36);
    assert_eq!(a.chars().nth(14), Some('4'));
}
