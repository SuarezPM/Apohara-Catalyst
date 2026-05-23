//! Action chain executor (G6.D.9).
//!
//! Takes a list of action names from `reactions.conf` and runs them in
//! sequence against a `StateMachine`. Each action is a small function
//! `Action: Fn(&mut StateMachine) -> Result<StepOutcome, StepError>`.
//!
//! Built-in actions exist for the canonical reaction-engine vocabulary
//! (`triage`, `route`, `start`, `review`, `merge`, `escalate`,
//! `reschedule`, `close`). Callers can register their own. The
//! executor short-circuits on the first step that fails.

use std::collections::HashMap;

use crate::state_machine::{ReactionState, StateMachine, TransitionError};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActionChain {
    pub steps: Vec<String>,
}

impl ActionChain {
    pub fn from_steps<I, S>(steps: I) -> Self
    where
        I: IntoIterator<Item = S>,
        S: Into<String>,
    {
        Self {
            steps: steps.into_iter().map(Into::into).collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ActionStep {
    pub name: String,
    pub outcome: StepOutcome,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StepOutcome {
    Transitioned { from: ReactionState, to: ReactionState },
    Skipped { reason: String },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ExecuteOutcome {
    Completed {
        steps: Vec<ActionStep>,
        final_state: ReactionState,
    },
    Failed {
        ran: Vec<ActionStep>,
        failed_step: String,
        reason: String,
    },
}

#[derive(Debug, thiserror::Error)]
pub enum StepError {
    #[error("unknown action '{0}' (register it before executing)")]
    UnknownAction(String),
    #[error(transparent)]
    Transition(#[from] TransitionError),
}

type StepFn = Box<dyn Fn(&mut StateMachine) -> Result<StepOutcome, StepError> + Send + Sync>;

pub struct Executor {
    actions: HashMap<String, StepFn>,
}

impl std::fmt::Debug for Executor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Executor")
            .field("actions", &self.actions.keys().collect::<Vec<_>>())
            .finish()
    }
}

impl Executor {
    pub fn new() -> Self {
        Self {
            actions: HashMap::new(),
        }
    }

    pub fn with_builtins() -> Self {
        let mut e = Self::new();
        e.register("triage", transition_to(ReactionState::Triaged));
        e.register("route", transition_to(ReactionState::Routed));
        e.register("start", transition_to(ReactionState::InProgress));
        e.register("review", transition_to(ReactionState::Reviewing));
        e.register("merge", transition_to(ReactionState::Merged));
        e.register("escalate", transition_to(ReactionState::Escalated));
        e.register("reschedule", transition_to(ReactionState::Rescheduled));
        e.register("close", transition_to(ReactionState::Closed));
        e.register("mark_stale", transition_to(ReactionState::Stale));
        e.register("reject", transition_to(ReactionState::Rejected));
        e.register(
            "request_clarification",
            transition_to(ReactionState::NeedsClarification),
        );
        e.register("block", transition_to(ReactionState::Blocked));
        e
    }

    pub fn register<F>(&mut self, name: impl Into<String>, action: F)
    where
        F: Fn(&mut StateMachine) -> Result<StepOutcome, StepError> + Send + Sync + 'static,
    {
        self.actions.insert(name.into(), Box::new(action));
    }

    pub fn registered(&self) -> Vec<&str> {
        self.actions.keys().map(|s| s.as_str()).collect()
    }

    pub fn execute(&self, machine: &mut StateMachine, chain: &ActionChain) -> ExecuteOutcome {
        let mut ran: Vec<ActionStep> = Vec::with_capacity(chain.steps.len());
        for step_name in &chain.steps {
            let Some(action) = self.actions.get(step_name) else {
                return ExecuteOutcome::Failed {
                    ran,
                    failed_step: step_name.clone(),
                    reason: format!("unknown action '{}'", step_name),
                };
            };
            match action(machine) {
                Ok(outcome) => ran.push(ActionStep {
                    name: step_name.clone(),
                    outcome,
                }),
                Err(e) => {
                    return ExecuteOutcome::Failed {
                        ran,
                        failed_step: step_name.clone(),
                        reason: e.to_string(),
                    };
                }
            }
        }
        ExecuteOutcome::Completed {
            steps: ran,
            final_state: machine.current(),
        }
    }
}

impl Default for Executor {
    fn default() -> Self {
        Self::with_builtins()
    }
}

fn transition_to(target: ReactionState) -> StepFn {
    Box::new(move |m: &mut StateMachine| {
        let from = m.current();
        if from == target {
            return Ok(StepOutcome::Skipped {
                reason: format!("already in {}", target.as_str()),
            });
        }
        m.transition(target)?;
        Ok(StepOutcome::Transitioned { from, to: target })
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_chain_is_completed_at_current_state() {
        let mut m = StateMachine::new();
        let e = Executor::with_builtins();
        let outcome = e.execute(&mut m, &ActionChain::from_steps::<_, &str>([]));
        match outcome {
            ExecuteOutcome::Completed { steps, final_state } => {
                assert!(steps.is_empty());
                assert_eq!(final_state, ReactionState::IssueOpened);
            }
            other => panic!("expected Completed, got {:?}", other),
        }
    }

    #[test]
    fn happy_chain_runs_through() {
        let mut m = StateMachine::new();
        let e = Executor::with_builtins();
        let chain = ActionChain::from_steps(["triage", "route", "start", "review", "merge"]);
        match e.execute(&mut m, &chain) {
            ExecuteOutcome::Completed { steps, final_state } => {
                assert_eq!(steps.len(), 5);
                assert_eq!(final_state, ReactionState::Merged);
            }
            other => panic!("expected Completed, got {:?}", other),
        }
    }

    #[test]
    fn unknown_action_short_circuits() {
        let mut m = StateMachine::new();
        let e = Executor::with_builtins();
        let chain = ActionChain::from_steps(["triage", "nonexistent", "merge"]);
        match e.execute(&mut m, &chain) {
            ExecuteOutcome::Failed { ran, failed_step, .. } => {
                assert_eq!(ran.len(), 1);
                assert_eq!(failed_step, "nonexistent");
                // First step ran — state should be Triaged.
                assert_eq!(m.current(), ReactionState::Triaged);
            }
            other => panic!("expected Failed, got {:?}", other),
        }
    }

    #[test]
    fn illegal_transition_short_circuits() {
        let mut m = StateMachine::new();
        let e = Executor::with_builtins();
        // IssueOpened → merge is illegal (no path through review).
        let chain = ActionChain::from_steps(["merge"]);
        match e.execute(&mut m, &chain) {
            ExecuteOutcome::Failed { failed_step, reason, .. } => {
                assert_eq!(failed_step, "merge");
                assert!(reason.contains("illegal"));
            }
            other => panic!("expected Failed, got {:?}", other),
        }
    }

    #[test]
    fn idempotent_action_skips() {
        let mut m = StateMachine::from_state(ReactionState::Triaged);
        let e = Executor::with_builtins();
        let chain = ActionChain::from_steps(["triage"]);
        match e.execute(&mut m, &chain) {
            ExecuteOutcome::Completed { steps, .. } => {
                assert_eq!(steps.len(), 1);
                assert!(matches!(steps[0].outcome, StepOutcome::Skipped { .. }));
            }
            other => panic!("expected Completed, got {:?}", other),
        }
    }

    #[test]
    fn custom_action_can_be_registered() {
        let mut e = Executor::with_builtins();
        e.register("noop", |_m| {
            Ok(StepOutcome::Skipped {
                reason: "custom no-op".to_string(),
            })
        });
        let mut m = StateMachine::new();
        let outcome = e.execute(&mut m, &ActionChain::from_steps(["noop"]));
        assert!(matches!(outcome, ExecuteOutcome::Completed { .. }));
    }

    #[test]
    fn builtins_cover_every_non_initial_state() {
        let e = Executor::with_builtins();
        let registered: Vec<&str> = e.registered();
        for state in ReactionState::all() {
            if *state == ReactionState::IssueOpened {
                continue; // initial, no action transitions to it
            }
            let name = state.as_str();
            // map state name → action name for the canonical 1:1 cases
            let action = match *state {
                ReactionState::Triaged => "triage",
                ReactionState::Routed => "route",
                ReactionState::InProgress => "start",
                ReactionState::Reviewing => "review",
                ReactionState::Merged => "merge",
                ReactionState::Closed => "close",
                ReactionState::Stale => "mark_stale",
                ReactionState::NeedsClarification => "request_clarification",
                ReactionState::Blocked => "block",
                ReactionState::Escalated => "escalate",
                ReactionState::Rejected => "reject",
                ReactionState::Rescheduled => "reschedule",
                ReactionState::IssueOpened => name,
            };
            assert!(
                registered.contains(&action),
                "no builtin maps to state {}",
                name
            );
        }
    }
}
