//! Apohara Verification — verification mesh + JCR + quality gates.
//!
//! Replaces `src/core/verification/*.ts` (TS legacy). Feature flag:
//! APOHARA_RUST_VERIFICATION=1 (default OFF until Phase 1 cierre).
//!
//! G1.B.1 — ported task-by-task following TDD per module.

pub mod critic_prompt;
pub mod dual_status_ac;
pub mod hallucination_flag;
pub mod api;
pub mod quality_gates;
pub mod verification_rounds;

pub use critic_prompt::{build_critic_prompt, CriticContext};
pub use dual_status_ac::{AcSpec, AcStatus, AdminStatus, DevStatus, DualStatusAc};
pub use hallucination_flag::{detect_hallucinations, DetectArgs, DetectResult};
pub use quality_gates::{
    default_gates, run_all_gates, run_bash_scope_gate, run_gates, AgentRole, ArchitectureGate,
    BashScopeGate, CodeQualityGate, FrontendGate, GateBlock, GateInput, GateResult,
    MultiGateResult, PerfGate, Persona, QualityGate, SecurityGate, SysadminSafetyGate,
};
pub use verification_rounds::{
    advance_round, is_exhausted, mark_escalated, new_verification_round, round_outcome,
    RoundOutcome, VerificationRoundTracker, DEFAULT_MAX_ROUNDS,
};

#[cfg(test)]
mod critic_prompt_tests;
#[cfg(test)]
mod dual_status_ac_tests;
#[cfg(test)]
mod hallucination_flag_tests;
#[cfg(test)]
mod quality_gates_tests;
#[cfg(test)]
mod verification_rounds_tests;
