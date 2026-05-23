//! Sidecar reactor process (G6.D.10).
//!
//! Tokio task running inside `apohara-daemon` that:
//!   1. Listens for `ReactorEvent`s on an mpsc channel (the
//!      github-bridge → reactor IPC hop).
//!   2. Runs the matching reaction rule (parsed from `reactions.conf`).
//!   3. Drives the per-issue `StateMachine` and reports outcomes
//!      back via an outbound channel.
//!
//! Gated by `APOHARA_REACTIONS=1`. Disabled mode just drops events on
//! the floor and emits `ReactorOutcome::Disabled` so the daemon-side
//! status surface can show "reactor idle" rather than blocking.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{mpsc, Mutex};

use apohara_reaction_engine::{
    executor::Executor, state_machine::StateMachine, ActionChain, ExecuteOutcome, ReactionConfig,
};

#[derive(Debug, Clone)]
pub struct ReactorEvent {
    pub issue_id: String,
    pub trigger: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReactorOutcome {
    Disabled,
    NoMatch {
        issue_id: String,
        trigger: String,
    },
    Executed {
        issue_id: String,
        trigger: String,
        outcome: ExecuteOutcome,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ReactorOpts {
    pub channel_capacity: usize,
}

impl Default for ReactorOpts {
    fn default() -> Self {
        Self { channel_capacity: 128 }
    }
}

pub struct Reactor {
    config: ReactionConfig,
    machines: Arc<Mutex<HashMap<String, StateMachine>>>,
    executor: Arc<Executor>,
    enabled: bool,
}

impl Reactor {
    pub fn new(config: ReactionConfig, enabled: bool) -> Self {
        Self {
            config,
            machines: Arc::new(Mutex::new(HashMap::new())),
            executor: Arc::new(Executor::with_builtins()),
            enabled,
        }
    }

    pub fn from_env(config: ReactionConfig) -> Self {
        let enabled = std::env::var("APOHARA_REACTIONS").as_deref() == Ok("1");
        Self::new(config, enabled)
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled
    }

    pub fn config(&self) -> &ReactionConfig {
        &self.config
    }

    /// Process a single event synchronously. Useful for unit tests and
    /// for the tokio task body. Production callers usually go through
    /// `run()` which loops on the mpsc channel.
    pub async fn handle(&self, evt: ReactorEvent) -> ReactorOutcome {
        if !self.enabled {
            return ReactorOutcome::Disabled;
        }
        let Some(rule) = self.config.triggers.get(&evt.trigger) else {
            return ReactorOutcome::NoMatch {
                issue_id: evt.issue_id,
                trigger: evt.trigger,
            };
        };
        let chain = ActionChain::from_steps(rule.action_chain.iter().cloned());
        let mut machines = self.machines.lock().await;
        let machine = machines
            .entry(evt.issue_id.clone())
            .or_insert_with(StateMachine::new);
        let outcome = self.executor.execute(machine, &chain);
        ReactorOutcome::Executed {
            issue_id: evt.issue_id,
            trigger: evt.trigger,
            outcome,
        }
    }

    /// Drain `rx` until the channel closes. Each event is processed via
    /// `handle()` and the result is forwarded to `tx`. Tests drive this
    /// directly; the daemon's main() spawns it as a tokio task.
    pub async fn run(
        &self,
        mut rx: mpsc::Receiver<ReactorEvent>,
        tx: mpsc::Sender<ReactorOutcome>,
    ) {
        while let Some(evt) = rx.recv().await {
            let outcome = self.handle(evt).await;
            // If the listener side disappeared, drop the message and stop.
            if tx.send(outcome).await.is_err() {
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use apohara_reaction_engine::conf::parse as parse_conf;

    fn sample_config() -> ReactionConfig {
        parse_conf(
            r#"
[on.issue_opened]
action_chain = ["triage", "route"]

[on.review_ready]
action_chain = ["review"]
"#,
        )
        .unwrap()
    }

    #[tokio::test]
    async fn disabled_short_circuits() {
        let r = Reactor::new(sample_config(), false);
        let out = r
            .handle(ReactorEvent {
                issue_id: "i-1".into(),
                trigger: "issue_opened".into(),
            })
            .await;
        assert_eq!(out, ReactorOutcome::Disabled);
    }

    #[tokio::test]
    async fn no_match_when_trigger_absent() {
        let r = Reactor::new(sample_config(), true);
        let out = r
            .handle(ReactorEvent {
                issue_id: "i-1".into(),
                trigger: "unknown".into(),
            })
            .await;
        match out {
            ReactorOutcome::NoMatch { trigger, .. } => assert_eq!(trigger, "unknown"),
            other => panic!("expected NoMatch, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn executed_path_drives_state_machine() {
        let r = Reactor::new(sample_config(), true);
        let out = r
            .handle(ReactorEvent {
                issue_id: "i-1".into(),
                trigger: "issue_opened".into(),
            })
            .await;
        match out {
            ReactorOutcome::Executed { outcome, .. } => {
                assert!(matches!(outcome, ExecuteOutcome::Completed { .. }));
            }
            other => panic!("expected Executed, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn state_machines_persist_per_issue() {
        let r = Reactor::new(sample_config(), true);
        // First event: triage + route → Routed.
        r.handle(ReactorEvent {
            issue_id: "i-1".into(),
            trigger: "issue_opened".into(),
        })
        .await;
        // Second event for the SAME issue: review from Routed should fail
        // (Routed → Reviewing is illegal; need start in between).
        let out = r
            .handle(ReactorEvent {
                issue_id: "i-1".into(),
                trigger: "review_ready".into(),
            })
            .await;
        match out {
            ReactorOutcome::Executed { outcome, .. } => {
                assert!(matches!(outcome, ExecuteOutcome::Failed { .. }));
            }
            other => panic!("expected Executed/Failed, got {:?}", other),
        }
    }

    #[tokio::test]
    async fn run_drains_channel() {
        let r = Reactor::new(sample_config(), true);
        let (tx_in, rx_in) = mpsc::channel(8);
        let (tx_out, mut rx_out) = mpsc::channel(8);

        tx_in
            .send(ReactorEvent {
                issue_id: "i-1".into(),
                trigger: "issue_opened".into(),
            })
            .await
            .unwrap();
        drop(tx_in);

        r.run(rx_in, tx_out).await;
        let outcome = rx_out.recv().await.unwrap();
        match outcome {
            ReactorOutcome::Executed { issue_id, .. } => assert_eq!(issue_id, "i-1"),
            other => panic!("expected Executed, got {:?}", other),
        }
    }
}
