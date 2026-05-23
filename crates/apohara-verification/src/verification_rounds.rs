//! chorus hallazgo 15 — `maxRounds` + escalation tracker.
//!
//! Direct port of `src/core/verification/verificationRounds.ts`. Pure value
//! module — zero I/O. Orchestration migrations carry `round` + `max_rounds`
//! per task; the chorus state machine then maps [`round_outcome`] into a
//! TaskStatus at the caller.
//!
//! Once a tracker is exhausted (round reached max), the caller has two
//! choices: [`mark_escalated`] to surface unfinished work to the operator
//! (chorus pattern) or close the task as failed and let dependents that
//! don't read its output continue (Apohara default — see
//! `decision-gates.ts`).

use serde::{Deserialize, Serialize};

/// Tracks how many verification rounds have been spent on a single task
/// and whether the operator already escalated.
///
/// Wire-compatible with the TS `VerificationRoundTracker` interface: the
/// orchestration DB stores camelCase keys so the reconciler / UI on both
/// sides see the same payload during Phase 1 double-maintenance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerificationRoundTracker {
    pub round: u32,
    pub max_rounds: u32,
    pub escalated: bool,
}

/// Default round cap when callers don't override. Mirrors the TS
/// `DEFAULT_MAX_ROUNDS` constant exactly.
pub const DEFAULT_MAX_ROUNDS: u32 = 3;

/// Build a fresh tracker. Pass `None` to use [`DEFAULT_MAX_ROUNDS`].
pub fn new_verification_round(max_rounds: Option<u32>) -> VerificationRoundTracker {
    VerificationRoundTracker {
        round: 0,
        max_rounds: max_rounds.unwrap_or(DEFAULT_MAX_ROUNDS),
        escalated: false,
    }
}

/// Increment the round counter. Refuses to advance past `max_rounds`:
/// once exhausted, the caller is expected to escalate or stop. Silently
/// dropping further advances flags a bug at the test layer rather than
/// letting verification spin (matches the TS no-op behaviour).
pub fn advance_round(t: VerificationRoundTracker) -> VerificationRoundTracker {
    if t.round >= t.max_rounds {
        return t;
    }
    VerificationRoundTracker {
        round: t.round + 1,
        ..t
    }
}

/// `true` once the tracker has hit its `max_rounds` ceiling.
pub fn is_exhausted(t: &VerificationRoundTracker) -> bool {
    t.round >= t.max_rounds
}

/// Set the escalation flag. Idempotent.
pub fn mark_escalated(t: VerificationRoundTracker) -> VerificationRoundTracker {
    VerificationRoundTracker {
        escalated: true,
        ..t
    }
}

/// Terminal label for the current tracker state. Wire format matches the
/// TS `RoundOutcome` union (`"in_progress" | "exhausted" | "escalated"`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RoundOutcome {
    InProgress,
    Exhausted,
    Escalated,
}

/// Map a tracker into a single terminal outcome label. Escalation wins
/// over exhaustion so the operator's signal is never masked.
pub fn round_outcome(t: &VerificationRoundTracker) -> RoundOutcome {
    if t.escalated {
        return RoundOutcome::Escalated;
    }
    if is_exhausted(t) {
        return RoundOutcome::Exhausted;
    }
    RoundOutcome::InProgress
}
