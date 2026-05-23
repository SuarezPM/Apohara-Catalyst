//! Apohara reaction engine — declarative GitHub-issue → action-chain
//! orchestration (G6.D.6 .. G6.D.10).
//!
//! Gated by `APOHARA_REACTIONS=1`. When disabled the engine is a no-op:
//! `Reactor::handle_event()` returns `ReactionOutcome::Disabled` and no
//! state transitions are recorded.
//!
//! Architecture:
//!   - `state_machine` — 13-state lifecycle (G6.D.7).
//!   - `conf` — TOML-like declarative config (`reactions.conf`).
//!   - `executor` — runs an action chain against a state.
//!   - lib.rs aggregates them into `Reactor`, the public API.

pub mod conf;
pub mod executor;
pub mod state_machine;

pub use conf::{ReactionConfig, ReactionRule};
pub use executor::{ActionChain, ActionStep, ExecuteOutcome, StepOutcome};
pub use state_machine::{ReactionState, StateMachine, TransitionError};

/// Top-level outcome of one reactor invocation. Distinct from
/// `ExecuteOutcome` because the reactor adds gating (feature flag,
/// state-machine eligibility) on top of pure action execution.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReactionOutcome {
    Disabled,
    NoMatch,
    Executed {
        from: ReactionState,
        to: ReactionState,
        steps_ran: Vec<String>,
    },
    Failed {
        from: ReactionState,
        reason: String,
    },
}

/// Returns true iff `APOHARA_REACTIONS=1` is set. Engine callers must
/// short-circuit when this returns false — the engine itself enforces
/// it internally as a defensive check.
pub fn is_reactions_enabled<S: AsRef<str>>(value: Option<S>) -> bool {
    matches!(value, Some(v) if v.as_ref() == "1")
}

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feature_flag_helpers_match_spec() {
        assert!(!is_reactions_enabled::<&str>(None));
        assert!(!is_reactions_enabled(Some("0")));
        assert!(!is_reactions_enabled(Some("true")));
        assert!(is_reactions_enabled(Some("1")));
    }

    #[test]
    fn version_is_workspace_version() {
        // Cargo workspace.package.version = "1.0.0-dev"
        assert_eq!(version(), "1.0.0-dev");
    }
}
