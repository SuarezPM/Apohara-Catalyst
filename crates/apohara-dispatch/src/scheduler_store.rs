//! The live [`SchedulerStore`] impl (US-F2.1).
//!
//! `apohara-coordinator` declares the [`SchedulerStore`] trait but cannot
//! depend on this crate (the edge runs `apohara-dispatch → apohara-coordinator`
//! already; depending back would cycle). So the concrete adapter over the
//! F1.1 `TaskGraph` + `ClaimStore` lives HERE and binds into a
//! `Coordinator<DispatchSchedulerStore>` on the live path.
//!
//! Mapping:
//!   * [`SchedulerStore::ready_tasks`] → [`TaskGraph::claimable`] (deps-done
//!     AND claim-slot-open), the exact deps-gated set the coordinator
//!     dispatches.
//!   * [`SchedulerStore::reap_stale`] → [`reap_stale_claims`] over every
//!     on-disk claim, with the production [`default_pid_alive`] probe. This
//!     is where the formerly-standalone F1.1 reaper finally gets a live
//!     caller — driven by `Coordinator::tick`.

use std::path::Path;

use apohara_coordinator::store::{SchedulerStore, StoreError};

use crate::claim::ClaimStore;
use crate::task_graph::{default_pid_alive, reap_stale_claims, TaskGraph};

/// Live storage adapter binding the coordinator to the on-disk Shared Task
/// List (`<base>/.apohara/{tasks,claims}`).
pub struct DispatchSchedulerStore {
    tasks: TaskGraph,
    claims: ClaimStore,
}

impl DispatchSchedulerStore {
    /// Bind to the `<base>/.apohara/{tasks,claims}` layout — the SAME roots
    /// the F1.4 dispatch loop and the F2.0a `FsMeshBackend` use, so the
    /// scheduler, the blades, and the mesh tools all coordinate over one
    /// on-disk task list.
    pub fn new(base: impl AsRef<Path>) -> Self {
        let apohara = base.as_ref().join(".apohara");
        Self {
            tasks: TaskGraph::new(apohara.join("tasks")),
            claims: ClaimStore::new(apohara.join("claims")),
        }
    }

    /// Bind to explicit graph/claim handles (tests, non-conventional layouts).
    pub fn from_parts(tasks: TaskGraph, claims: ClaimStore) -> Self {
        Self { tasks, claims }
    }
}

impl SchedulerStore for DispatchSchedulerStore {
    fn ready_tasks(&self) -> Result<Vec<String>, StoreError> {
        self.tasks
            .claimable(&self.claims)
            .map_err(|e| StoreError::Backend(e.to_string()))
    }

    fn reap_stale(&mut self, now_ms: i64, ttl_ms: i64) -> Result<Vec<String>, StoreError> {
        // Sweep EVERY on-disk claim, not just graph nodes: a claim minted by
        // the F1.4 dispatch loop (ad-hoc id, no graph node) is still reapable.
        // `reap_stale_claims` pre-filters to the live (Claimed/Running) ones.
        let ids: Vec<String> = self
            .claims
            .list()
            .map_err(|e| StoreError::Backend(e.to_string()))?
            .into_iter()
            .map(|r| r.task_id)
            .collect();
        reap_stale_claims(&self.claims, &ids, now_ms, ttl_ms, default_pid_alive)
            .map_err(|e| StoreError::Backend(e.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claim::ClaimOutcome;
    use crate::task_graph::TaskNode;
    use apohara_coordinator::{Coordinator, TickOutcome};
    use tempfile::TempDir;

    fn node(id: &str, deps: &[&str]) -> TaskNode {
        TaskNode {
            id: id.to_string(),
            title: format!("title-{id}"),
            deps: deps.iter().map(|d| d.to_string()).collect(),
        }
    }

    /// THE F2.1 acceptance test (scheduling half): `Coordinator::tick` over
    /// the REAL on-disk Shared Task List dispatches only deps-resolved,
    /// slot-open tasks — no mock anywhere in the path.
    #[tokio::test]
    async fn coordinator_dispatches_deps_gated_over_real_storage() {
        let dir = TempDir::new().unwrap();
        let base = dir.path();
        let tasks = TaskGraph::new(base.join(".apohara").join("tasks"));
        let claims = ClaimStore::new(base.join(".apohara").join("claims"));
        tasks.add_node(node("A", &[])).unwrap();
        tasks.add_node(node("B", &["A"])).unwrap();

        let mut coord = Coordinator::new(DispatchSchedulerStore::new(base));

        // Tick 1: B is gated on A, so only A is dispatchable.
        match coord.tick().await {
            TickOutcome::Dispatched { task_ids, .. } => {
                assert_eq!(task_ids, vec!["A".to_string()]);
            }
            other => panic!("expected Dispatched [A], got {other:?}"),
        }

        // A blade claims A and finishes it (the dep-resolution signal).
        let token = match claims.try_claim("A").unwrap() {
            ClaimOutcome::Acquired { token } => token,
            other => panic!("expected to claim A, got {other:?}"),
        };
        assert_eq!(
            claims.report_result("A", &token).unwrap(),
            crate::claim::ReportOutcome::Accepted
        );
        tasks.mark_done("A").unwrap();

        // Tick 2: A is done (drops out), B's dep resolved + slot open -> B.
        match coord.tick().await {
            TickOutcome::Dispatched { task_ids, .. } => {
                assert_eq!(task_ids, vec!["B".to_string()]);
            }
            other => panic!("expected Dispatched [B], got {other:?}"),
        }
    }

    /// THE F2.1 acceptance test (reaper half): a stale claim on the real
    /// store is released through the UNIFIED path — `Coordinator::tick`
    /// surfaces it as `StallDetected` and the slot is freed.
    #[tokio::test]
    async fn coordinator_reaps_stale_claim_over_real_storage() {
        let dir = TempDir::new().unwrap();
        let base = dir.path();
        let tasks = TaskGraph::new(base.join(".apohara").join("tasks"));
        let claims = ClaimStore::new(base.join(".apohara").join("claims"));
        tasks.add_node(node("A", &[])).unwrap();

        // A blade claims A then "dies": its heartbeat carries an impossible
        // pid so the production probe reports it dead — deterministic,
        // independent of the wall clock / TTL.
        let token = match claims.try_claim("A").unwrap() {
            ClaimOutcome::Acquired { token } => token,
            other => panic!("expected to claim A, got {other:?}"),
        };
        claims
            .heartbeat("A", &token, u32::MAX, 1_000, None)
            .unwrap();

        let mut coord = Coordinator::new(DispatchSchedulerStore::new(base));
        // Huge TTL so ONLY the dead-PID signal can reap (isolates the probe).
        coord.set_stall_timeout_ms(u64::MAX / 2);

        match coord.tick().await {
            TickOutcome::StallDetected { task_ids } => {
                assert_eq!(task_ids, vec!["A".to_string()]);
            }
            other => panic!("expected StallDetected [A], got {other:?}"),
        }

        // The slot is freed (not blocked): A is claimable again.
        assert!(!claims.has_active_claim("A").unwrap(), "reaped slot must be free");
        assert_eq!(
            tasks.claimable(&claims).unwrap(),
            vec!["A".to_string()],
            "reaped task is ready to dispatch again"
        );
    }
}
