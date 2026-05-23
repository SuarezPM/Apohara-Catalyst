//! Apohara Verification — verification mesh + JCR + quality gates.
//!
//! Replaces `src/core/verification/*.ts` (TS legacy). Feature flag:
//! APOHARA_RUST_VERIFICATION=1 (default OFF until Phase 1 cierre).
//!
//! G1.B.1 — ported task-by-task following TDD per module.

pub mod dual_status_ac;
pub mod verification_rounds;

pub use dual_status_ac::{AcSpec, AcStatus, AdminStatus, DevStatus, DualStatusAc};
pub use verification_rounds::{
    advance_round, is_exhausted, mark_escalated, new_verification_round, round_outcome,
    RoundOutcome, VerificationRoundTracker, DEFAULT_MAX_ROUNDS,
};

#[cfg(test)]
mod dual_status_ac_tests;
#[cfg(test)]
mod verification_rounds_tests;
