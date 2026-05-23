//! Coordinator event loop per spec §3.2.
//!
//! Pre-T4.6, this crate exposed `manifest`, `conflict_matrix`, `blast_radius`,
//! and `scheduler_decision` as standalone libraries — useful but no caller.
//! The audit (orca #9) flagged that the 5 orchestration DB tables
//! (`messages`, `tasks`, `dispatch_contexts`, `decision_gates`,
//! `coordinator_runs`) had CRUDs but no loop driving them.
//!
//! `Coordinator::tick()` is the unit of progress: read pending state, decide
//! what to dispatch, mark in-progress, detect stalls. Designed to be called
//! N×/second by a sidecar tokio task in `apohara-daemon` (Sprint 6) or by
//! the bun process directly via ts-rs bridge (today).

use std::collections::HashMap;

#[derive(Debug, PartialEq)]
pub enum TickOutcome {
    NoOp,
    Dispatched { task_ids: Vec<String> },
    StallDetected { task_ids: Vec<String> },
}

pub struct Coordinator {
    // Mock storage for now — Sprint 5 wires real bun:sqlite via ts-rs bridge.
    tasks: HashMap<String, MockTask>,
    stall_timeout_ms: u64,
}

#[derive(Clone)]
struct MockTask {
    id: String,
    #[allow(dead_code)] // surfaced via ts-rs bridge in Sprint 5
    enqueued_at_ms: u64,
    dispatched_at_ms: Option<u64>,
}

impl Default for Coordinator {
    fn default() -> Self {
        Self::new_with_mocks()
    }
}

impl Coordinator {
    pub fn new_with_mocks() -> Self {
        Self {
            tasks: HashMap::new(),
            stall_timeout_ms: 5 * 60 * 1000, // 5 minutes default
        }
    }

    pub fn enqueue_test_task(&mut self, id: &str) {
        self.tasks.insert(
            id.to_string(),
            MockTask {
                id: id.to_string(),
                enqueued_at_ms: 0,
                dispatched_at_ms: None,
            },
        );
    }

    pub fn enqueue_test_task_with_age(&mut self, id: &str, age_ms: u64) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        self.tasks.insert(
            id.to_string(),
            MockTask {
                id: id.to_string(),
                enqueued_at_ms: now.saturating_sub(age_ms),
                dispatched_at_ms: Some(now.saturating_sub(age_ms)),
            },
        );
    }

    pub async fn tick(&mut self) -> TickOutcome {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        // Pass 1: stall detection on dispatched tasks.
        let mut stalled: Vec<String> = self
            .tasks
            .values()
            .filter(|t| {
                t.dispatched_at_ms
                    .map(|d| now.saturating_sub(d) > self.stall_timeout_ms)
                    .unwrap_or(false)
            })
            .map(|t| t.id.clone())
            .collect();
        if !stalled.is_empty() {
            stalled.sort();
            return TickOutcome::StallDetected { task_ids: stalled };
        }

        // Pass 2: dispatch pending tasks.
        let mut pending: Vec<String> = self
            .tasks
            .values()
            .filter(|t| t.dispatched_at_ms.is_none())
            .map(|t| t.id.clone())
            .collect();
        if pending.is_empty() {
            return TickOutcome::NoOp;
        }
        pending.sort();
        for id in &pending {
            if let Some(t) = self.tasks.get_mut(id) {
                t.dispatched_at_ms = Some(now);
            }
        }
        TickOutcome::Dispatched { task_ids: pending }
    }
}
