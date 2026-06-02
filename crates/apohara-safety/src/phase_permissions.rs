//! Per-blade × phase permissions (US-F4.1, R16).
//!
//! A blade's authority depends on WHICH phase of the mesh workflow it is in:
//!   * **Plan**   — read-only. A planning blade inspects the repo but must not
//!     mutate it; a write attempt is rejected.
//!   * **Exec**   — write allowed. The implementing blade does the edits.
//!   * **Review** — human-gated. A reviewing blade's actions require explicit
//!     operator approval (Apohara never lets a blade self-approve a review).
//!
//! This is a **deny-first overlay** on top of the existing
//! [`crate::permission_service::check`] flow: consult [`decide_phase`] FIRST;
//! a phase `Deny` wins outright (like `settings.deny`), a `RequireHuman`
//! escalates to the operator, and only `Allow` falls through to the normal
//! pattern/cache/settings decision. Kept as its own pure function (no IO) so
//! the phase rule is unit-testable in isolation and the integration is a
//! one-line precedence check at the call site.

use serde::{Deserialize, Serialize};

use crate::pure_profiles::PureAction;

/// The mesh-workflow phase a blade is operating in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    Plan,
    Exec,
    Review,
}

/// Outcome of the per-phase gate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PhasePermission {
    /// Allowed by the phase rule — fall through to the normal permission flow.
    Allow,
    /// Rejected by the phase rule (e.g. a write during read-only PLAN).
    Deny { reason: String },
    /// The phase requires explicit human approval before proceeding.
    RequireHuman,
}

/// Whether an action mutates the workspace (or the outside world). Reads are
/// always phase-safe; everything else is a mutation a read-only phase forbids.
pub fn is_mutating(action: PureAction) -> bool {
    matches!(
        action,
        PureAction::FileWrite
            | PureAction::ShellExec
            | PureAction::GitCommit
            | PureAction::NetworkEgress
    )
}

/// The per-blade × phase gate (R16).
///
/// * `Plan`   → reads allowed, any mutation denied (read-only).
/// * `Exec`   → everything allowed (the write phase).
/// * `Review` → everything requires human approval (no self-approval).
pub fn decide_phase(phase: Phase, action: PureAction) -> PhasePermission {
    match phase {
        Phase::Plan => {
            if is_mutating(action) {
                PhasePermission::Deny {
                    reason: format!("PLAN phase is read-only; {action:?} is a mutation"),
                }
            } else {
                PhasePermission::Allow
            }
        }
        Phase::Exec => PhasePermission::Allow,
        Phase::Review => PhasePermission::RequireHuman,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_phase_rejects_writes() {
        // THE acceptance: a blade in PLAN cannot write.
        assert!(matches!(
            decide_phase(Phase::Plan, PureAction::FileWrite),
            PhasePermission::Deny { .. }
        ));
        assert!(matches!(
            decide_phase(Phase::Plan, PureAction::ShellExec),
            PhasePermission::Deny { .. }
        ));
        assert!(matches!(
            decide_phase(Phase::Plan, PureAction::GitCommit),
            PhasePermission::Deny { .. }
        ));
    }

    #[test]
    fn plan_phase_allows_reads() {
        assert_eq!(decide_phase(Phase::Plan, PureAction::FileRead), PhasePermission::Allow);
    }

    #[test]
    fn exec_phase_allows_writes() {
        assert_eq!(decide_phase(Phase::Exec, PureAction::FileWrite), PhasePermission::Allow);
        assert_eq!(decide_phase(Phase::Exec, PureAction::FileRead), PhasePermission::Allow);
    }

    #[test]
    fn review_phase_requires_human() {
        assert_eq!(
            decide_phase(Phase::Review, PureAction::FileRead),
            PhasePermission::RequireHuman
        );
        assert_eq!(
            decide_phase(Phase::Review, PureAction::FileWrite),
            PhasePermission::RequireHuman
        );
    }

    #[test]
    fn mutation_classification() {
        assert!(!is_mutating(PureAction::FileRead));
        assert!(is_mutating(PureAction::FileWrite));
        assert!(is_mutating(PureAction::NetworkEgress));
    }
}
