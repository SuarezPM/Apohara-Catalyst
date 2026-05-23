//! Reaction-engine lifecycle state machine (G6.D.7).
//!
//! 13 states cover the full path an issue takes from "opened" to a
//! terminal outcome. Transitions are explicit — the machine refuses
//! every move that isn't whitelisted, so a config typo or a stray
//! event can't drive an issue into an impossible state.
//!
//! States:
//!   1. `IssueOpened`       — entry. Fresh issue arrived on the queue.
//!   2. `Triaged`           — labels applied, priority assigned.
//!   3. `Routed`            — provider selected by the smart router.
//!   4. `InProgress`        — provider working.
//!   5. `Reviewing`         — diff up, review/CI in progress.
//!   6. `Merged`            — TERMINAL. PR merged, issue closed.
//!   7. `Closed`            — TERMINAL. Issue closed without a merge.
//!   8. `Stale`             — TERMINAL. No activity past the stale window.
//!   9. `NeedsClarification`— operator/user input required.
//!  10. `Blocked`           — dependency / external block.
//!  11. `Escalated`         — bumped to a human reviewer.
//!  12. `Rejected`          — TERMINAL. Issue dismissed.
//!  13. `Rescheduled`       — pushed to a later cycle.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReactionState {
    IssueOpened,
    Triaged,
    Routed,
    InProgress,
    Reviewing,
    Merged,
    Closed,
    Stale,
    NeedsClarification,
    Blocked,
    Escalated,
    Rejected,
    Rescheduled,
}

impl ReactionState {
    pub fn all() -> &'static [ReactionState] {
        &[
            ReactionState::IssueOpened,
            ReactionState::Triaged,
            ReactionState::Routed,
            ReactionState::InProgress,
            ReactionState::Reviewing,
            ReactionState::Merged,
            ReactionState::Closed,
            ReactionState::Stale,
            ReactionState::NeedsClarification,
            ReactionState::Blocked,
            ReactionState::Escalated,
            ReactionState::Rejected,
            ReactionState::Rescheduled,
        ]
    }

    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            ReactionState::Merged
                | ReactionState::Closed
                | ReactionState::Stale
                | ReactionState::Rejected
        )
    }

    pub fn as_str(self) -> &'static str {
        match self {
            ReactionState::IssueOpened => "issue_opened",
            ReactionState::Triaged => "triaged",
            ReactionState::Routed => "routed",
            ReactionState::InProgress => "in_progress",
            ReactionState::Reviewing => "reviewing",
            ReactionState::Merged => "merged",
            ReactionState::Closed => "closed",
            ReactionState::Stale => "stale",
            ReactionState::NeedsClarification => "needs_clarification",
            ReactionState::Blocked => "blocked",
            ReactionState::Escalated => "escalated",
            ReactionState::Rejected => "rejected",
            ReactionState::Rescheduled => "rescheduled",
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum TransitionError {
    #[error("illegal transition {from} → {to}", from = .from.as_str(), to = .to.as_str())]
    Illegal { from: ReactionState, to: ReactionState },
    #[error("cannot transition out of terminal state {state}", state = .state.as_str())]
    FromTerminal { state: ReactionState },
}

#[derive(Debug, Clone)]
pub struct StateMachine {
    current: ReactionState,
    history: Vec<ReactionState>,
}

impl StateMachine {
    pub fn new() -> Self {
        Self {
            current: ReactionState::IssueOpened,
            history: vec![ReactionState::IssueOpened],
        }
    }

    pub fn from_state(state: ReactionState) -> Self {
        Self {
            current: state,
            history: vec![state],
        }
    }

    pub fn current(&self) -> ReactionState {
        self.current
    }

    pub fn history(&self) -> &[ReactionState] {
        &self.history
    }

    pub fn can_transition(&self, to: ReactionState) -> bool {
        is_legal_transition(self.current, to)
    }

    pub fn transition(&mut self, to: ReactionState) -> Result<ReactionState, TransitionError> {
        if self.current.is_terminal() {
            return Err(TransitionError::FromTerminal { state: self.current });
        }
        if !is_legal_transition(self.current, to) {
            return Err(TransitionError::Illegal { from: self.current, to });
        }
        self.current = to;
        self.history.push(to);
        Ok(to)
    }
}

impl Default for StateMachine {
    fn default() -> Self {
        Self::new()
    }
}

/// Explicit transition table. Every legal move is listed here, with a
/// short comment on the trigger. Unlisted moves are rejected with
/// `Illegal`. Terminal states (merged/closed/stale/rejected) are
/// blocked at the call site by `from_terminal_state` — those checks
/// don't appear here, the source is `StateMachine::transition`.
pub fn is_legal_transition(from: ReactionState, to: ReactionState) -> bool {
    use ReactionState::*;
    // Terminal states are unreachable from terminal states — the call
    // site rejects this case before consulting the table.
    if from.is_terminal() {
        return false;
    }
    match (from, to) {
        // Linear happy path.
        (IssueOpened, Triaged) => true,
        (Triaged, Routed) => true,
        (Routed, InProgress) => true,
        (InProgress, Reviewing) => true,
        (Reviewing, Merged) => true,

        // Closing without a merge — allowed from any non-terminal state.
        (_, Closed) => true,

        // Stale auto-transition — allowed from any non-terminal state.
        (_, Stale) => true,

        // Rejection — allowed from any non-terminal state.
        (_, Rejected) => true,

        // Recoverable side paths.
        (Triaged, NeedsClarification) => true,
        (InProgress, NeedsClarification) => true,
        (Reviewing, NeedsClarification) => true,
        (NeedsClarification, Triaged) => true,
        (NeedsClarification, InProgress) => true,
        (NeedsClarification, Reviewing) => true,

        (InProgress, Blocked) => true,
        (Reviewing, Blocked) => true,
        (Blocked, InProgress) => true,
        (Blocked, Reviewing) => true,

        (Routed, Escalated) => true,
        (InProgress, Escalated) => true,
        (Reviewing, Escalated) => true,
        (Escalated, InProgress) => true,
        (Escalated, Reviewing) => true,

        (Routed, Rescheduled) => true,
        (InProgress, Rescheduled) => true,
        (Reviewing, Rescheduled) => true,
        (Rescheduled, Routed) => true,
        (Rescheduled, InProgress) => true,

        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thirteen_states() {
        assert_eq!(ReactionState::all().len(), 13);
    }

    #[test]
    fn four_terminals() {
        let terminal_count = ReactionState::all().iter().filter(|s| s.is_terminal()).count();
        assert_eq!(terminal_count, 4);
    }

    #[test]
    fn happy_path() {
        let mut m = StateMachine::new();
        m.transition(ReactionState::Triaged).unwrap();
        m.transition(ReactionState::Routed).unwrap();
        m.transition(ReactionState::InProgress).unwrap();
        m.transition(ReactionState::Reviewing).unwrap();
        m.transition(ReactionState::Merged).unwrap();
        assert!(m.current().is_terminal());
        assert_eq!(m.history().len(), 6);
    }

    #[test]
    fn illegal_skip_rejected() {
        let mut m = StateMachine::new();
        let err = m.transition(ReactionState::InProgress).unwrap_err();
        assert!(matches!(err, TransitionError::Illegal { .. }));
    }

    #[test]
    fn cannot_transition_from_terminal() {
        let mut m = StateMachine::from_state(ReactionState::Merged);
        let err = m.transition(ReactionState::Reviewing).unwrap_err();
        assert!(matches!(err, TransitionError::FromTerminal { .. }));
    }

    #[test]
    fn stale_and_closed_always_reachable_from_non_terminal() {
        // Every non-terminal state can transition to Stale (auto-close) and Closed.
        for s in ReactionState::all() {
            if s.is_terminal() {
                continue;
            }
            assert!(
                is_legal_transition(*s, ReactionState::Stale),
                "stale unreachable from {}",
                s.as_str()
            );
            assert!(
                is_legal_transition(*s, ReactionState::Closed),
                "closed unreachable from {}",
                s.as_str()
            );
        }
    }

    #[test]
    fn rejected_reachable_from_all_non_terminal() {
        for s in ReactionState::all() {
            if s.is_terminal() {
                continue;
            }
            assert!(is_legal_transition(*s, ReactionState::Rejected));
        }
    }

    #[test]
    fn needs_clarification_round_trip() {
        let mut m = StateMachine::from_state(ReactionState::InProgress);
        m.transition(ReactionState::NeedsClarification).unwrap();
        m.transition(ReactionState::InProgress).unwrap();
        assert_eq!(m.current(), ReactionState::InProgress);
    }

    #[test]
    fn every_state_reachable_via_a_path() {
        // For each state, build a short path from IssueOpened that ends there.
        let paths: &[(ReactionState, &[ReactionState])] = &[
            (ReactionState::IssueOpened, &[]),
            (ReactionState::Triaged, &[ReactionState::Triaged]),
            (ReactionState::Routed, &[ReactionState::Triaged, ReactionState::Routed]),
            (
                ReactionState::InProgress,
                &[ReactionState::Triaged, ReactionState::Routed, ReactionState::InProgress],
            ),
            (
                ReactionState::Reviewing,
                &[
                    ReactionState::Triaged,
                    ReactionState::Routed,
                    ReactionState::InProgress,
                    ReactionState::Reviewing,
                ],
            ),
            (
                ReactionState::Merged,
                &[
                    ReactionState::Triaged,
                    ReactionState::Routed,
                    ReactionState::InProgress,
                    ReactionState::Reviewing,
                    ReactionState::Merged,
                ],
            ),
            (ReactionState::Closed, &[ReactionState::Closed]),
            (ReactionState::Stale, &[ReactionState::Stale]),
            (
                ReactionState::NeedsClarification,
                &[ReactionState::Triaged, ReactionState::NeedsClarification],
            ),
            (
                ReactionState::Blocked,
                &[ReactionState::Triaged, ReactionState::Routed, ReactionState::InProgress, ReactionState::Blocked],
            ),
            (
                ReactionState::Escalated,
                &[ReactionState::Triaged, ReactionState::Routed, ReactionState::Escalated],
            ),
            (ReactionState::Rejected, &[ReactionState::Rejected]),
            (
                ReactionState::Rescheduled,
                &[ReactionState::Triaged, ReactionState::Routed, ReactionState::Rescheduled],
            ),
        ];
        for (target, path) in paths {
            let mut m = StateMachine::new();
            for step in *path {
                m.transition(*step).unwrap_or_else(|e| {
                    panic!("could not reach {} via path: {:?}", target.as_str(), e)
                });
            }
            assert_eq!(m.current(), *target);
        }
    }
}
