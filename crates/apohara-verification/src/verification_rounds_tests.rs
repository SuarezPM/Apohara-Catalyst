//! Tests for the verification-rounds tracker (ported from
//! `src/core/verification/verificationRounds.ts`).

use crate::verification_rounds::{
    advance_round, is_exhausted, mark_escalated, new_verification_round, round_outcome,
    RoundOutcome, DEFAULT_MAX_ROUNDS,
};

#[test]
fn new_tracker_defaults_to_three_rounds() {
    let t = new_verification_round(None);
    assert_eq!(t.round, 0);
    assert_eq!(t.max_rounds, DEFAULT_MAX_ROUNDS);
    assert!(!t.escalated);
}

#[test]
fn new_tracker_honors_custom_max() {
    let t = new_verification_round(Some(5));
    assert_eq!(t.max_rounds, 5);
}

#[test]
fn advance_round_increments_until_max_then_no_op() {
    let mut t = new_verification_round(Some(2));
    t = advance_round(t);
    assert_eq!(t.round, 1);
    t = advance_round(t);
    assert_eq!(t.round, 2);
    // exhausted — further calls are no-ops (TS parity).
    t = advance_round(t);
    assert_eq!(t.round, 2);
}

#[test]
fn is_exhausted_flips_at_ceiling() {
    let t = new_verification_round(Some(1));
    assert!(!is_exhausted(&t));
    let t = advance_round(t);
    assert!(is_exhausted(&t));
}

#[test]
fn mark_escalated_sets_flag_without_touching_round() {
    let t = new_verification_round(Some(3));
    let t = advance_round(t);
    let t = mark_escalated(t);
    assert!(t.escalated);
    assert_eq!(t.round, 1);
}

#[test]
fn round_outcome_prioritizes_escalation_over_exhaustion() {
    // Exhausted *and* escalated → escalated wins.
    let t = new_verification_round(Some(1));
    let t = advance_round(t);
    assert_eq!(round_outcome(&t), RoundOutcome::Exhausted);
    let t = mark_escalated(t);
    assert_eq!(round_outcome(&t), RoundOutcome::Escalated);
}

#[test]
fn round_outcome_reports_in_progress_initially() {
    let t = new_verification_round(None);
    assert_eq!(round_outcome(&t), RoundOutcome::InProgress);
}

#[test]
fn round_outcome_serializes_snake_case() {
    let oc = RoundOutcome::InProgress;
    let json = serde_json::to_string(&oc).unwrap();
    assert_eq!(json, "\"in_progress\"");
}

#[test]
fn tracker_serializes_camel_case_keys() {
    let t = new_verification_round(Some(4));
    let json = serde_json::to_string(&t).unwrap();
    // Wire compat with TS interface: maxRounds, not max_rounds.
    assert!(json.contains("\"maxRounds\":4"), "got: {json}");
    assert!(json.contains("\"round\":0"));
    assert!(json.contains("\"escalated\":false"));
}
