//! Worker-disconnect recovery — the daemon detects that a worker's SSH
//! channel has died (heartbeat timeout or explicit disconnect frame) and
//! re-dispatches in-flight tasks back to the local executor with a
//! `WorkerDisconnected` warning emitted on the UI event bus.
//!
//! Decisions encoded here (the russh wiring lives in G6.A bin):
//!
//! * Heartbeat interval = 10 seconds (worker pushes), grace = 3 missed beats
//!   (30 s). After grace, the session is considered disconnected.
//! * Re-dispatch target = `WorkerLocation::Local`. A future sprint may rebalance
//!   across other connected workers; v1.0 is "fallback to local."
//! * Tasks already past the half-life of their own SLA budget are NOT
//!   re-dispatched; they're marked `failed_disconnected` and surface as PR
//!   feedback so the operator can investigate.
//!
//! The output of `recover_session()` is a deterministic `RecoveryPlan` so
//! the daemon's main loop can execute it as a unit (avoids partial work).

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use thiserror::Error;

/// Heartbeat interval the worker is expected to keep.
pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(10);
/// How many beats can be missed before we declare the session dead.
pub const HEARTBEAT_GRACE_BEATS: u32 = 3;
/// Convenience: total grace window before disconnect.
pub const DISCONNECT_AFTER: Duration =
    Duration::from_secs(HEARTBEAT_INTERVAL.as_secs() * HEARTBEAT_GRACE_BEATS as u64);

#[derive(Debug, Error, PartialEq, Eq)]
pub enum RecoveryError {
    #[error("unknown session id {0}")]
    UnknownSession(String),
    #[error("session is still alive (last heartbeat {ms_ago}ms ago)")]
    StillAlive { ms_ago: u128 },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecoveryAction {
    /// Resubmit to the local executor.
    Local,
    /// Don't retry — task has burned its SLA budget; mark failed.
    FailedDisconnected,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct InflightTask {
    pub task_id: String,
    /// Total SLA budget for this task in milliseconds.
    pub sla_budget_ms: u64,
    /// Time elapsed when the worker disconnected, in milliseconds.
    pub elapsed_at_disconnect_ms: u64,
}

impl InflightTask {
    pub fn past_half_life(&self) -> bool {
        // Half life = 50% of the SLA budget already consumed.
        // Using > so exactly-half escapes is treated as "still has budget."
        self.elapsed_at_disconnect_ms * 2 > self.sla_budget_ms
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryDecision {
    pub task_id: String,
    pub action: RecoveryAction,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct RecoveryPlan {
    pub session_id: String,
    pub decisions: Vec<RecoveryDecision>,
    /// UI event payload — daemon emits this to subscribers (events bus
    /// wired in G6.A.5 / G6.D Action Bar).
    pub ui_warning: UiWarning,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct UiWarning {
    pub kind: String,
    pub session_id: String,
    pub message: String,
    pub re_dispatched_count: u32,
    pub failed_count: u32,
}

/// Compute the recovery plan for a disconnected session.
pub fn plan_recovery(session_id: &str, inflight: &[InflightTask]) -> RecoveryPlan {
    let mut decisions = Vec::with_capacity(inflight.len());
    let mut re_dispatched: u32 = 0;
    let mut failed: u32 = 0;
    for t in inflight {
        if t.past_half_life() {
            decisions.push(RecoveryDecision {
                task_id: t.task_id.clone(),
                action: RecoveryAction::FailedDisconnected,
                reason: format!(
                    "{}ms elapsed of {}ms SLA — past half-life; not retrying",
                    t.elapsed_at_disconnect_ms, t.sla_budget_ms
                ),
            });
            failed += 1;
        } else {
            decisions.push(RecoveryDecision {
                task_id: t.task_id.clone(),
                action: RecoveryAction::Local,
                reason: "worker disconnected; re-dispatching to local executor".into(),
            });
            re_dispatched += 1;
        }
    }
    RecoveryPlan {
        session_id: session_id.to_string(),
        decisions,
        ui_warning: UiWarning {
            kind: "worker_disconnected".into(),
            session_id: session_id.to_string(),
            message: format!(
                "worker session {} disconnected — {} re-dispatched locally, {} failed",
                session_id, re_dispatched, failed
            ),
            re_dispatched_count: re_dispatched,
            failed_count: failed,
        },
    }
}

/// Tracker for last-heartbeat timestamps. Kept simple so it can live alongside
/// the WorkerRegistry without coupling them.
#[derive(Default)]
pub struct HeartbeatTracker {
    inner: Mutex<HashMap<String, Instant>>,
}

impl HeartbeatTracker {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn record(&self, session_id: &str, at: Instant) {
        self.inner.lock().unwrap().insert(session_id.to_string(), at);
    }

    pub fn drop_session(&self, session_id: &str) {
        self.inner.lock().unwrap().remove(session_id);
    }

    /// Returns the sessions whose last heartbeat is older than `now - DISCONNECT_AFTER`.
    pub fn stale_sessions(&self, now: Instant) -> Vec<String> {
        let g = self.inner.lock().unwrap();
        g.iter()
            .filter_map(|(sid, ts)| {
                if now.duration_since(*ts) >= DISCONNECT_AFTER {
                    Some(sid.clone())
                } else {
                    None
                }
            })
            .collect()
    }

    pub fn last_seen(&self, session_id: &str) -> Option<Instant> {
        self.inner.lock().unwrap().get(session_id).copied()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(id: &str, elapsed: u64, budget: u64) -> InflightTask {
        InflightTask {
            task_id: id.into(),
            sla_budget_ms: budget,
            elapsed_at_disconnect_ms: elapsed,
        }
    }

    #[test]
    fn past_half_life_boundary_is_strictly_greater() {
        assert!(!t("x", 500, 1000).past_half_life()); // exactly half — still has budget
        assert!(t("x", 501, 1000).past_half_life());
    }

    #[test]
    fn empty_inflight_yields_empty_plan_with_zero_counts() {
        let plan = plan_recovery("sess-1", &[]);
        assert!(plan.decisions.is_empty());
        assert_eq!(plan.ui_warning.re_dispatched_count, 0);
        assert_eq!(plan.ui_warning.failed_count, 0);
        assert_eq!(plan.ui_warning.kind, "worker_disconnected");
    }

    #[test]
    fn early_inflight_redispatches_locally() {
        let plan = plan_recovery("sess-1", &[t("task-A", 100, 1000)]);
        assert_eq!(plan.decisions.len(), 1);
        assert_eq!(plan.decisions[0].action, RecoveryAction::Local);
        assert_eq!(plan.ui_warning.re_dispatched_count, 1);
        assert_eq!(plan.ui_warning.failed_count, 0);
    }

    #[test]
    fn late_inflight_marks_failed_disconnected() {
        let plan = plan_recovery("sess-1", &[t("task-B", 900, 1000)]);
        assert_eq!(plan.decisions[0].action, RecoveryAction::FailedDisconnected);
        assert_eq!(plan.ui_warning.failed_count, 1);
    }

    #[test]
    fn mixed_inflight_counts_separately() {
        let plan = plan_recovery(
            "sess-9",
            &[t("a", 100, 1000), t("b", 900, 1000), t("c", 200, 1000)],
        );
        assert_eq!(plan.ui_warning.re_dispatched_count, 2);
        assert_eq!(plan.ui_warning.failed_count, 1);
        assert!(plan.ui_warning.message.contains("sess-9"));
    }

    #[test]
    fn heartbeat_tracker_records_and_clears() {
        let h = HeartbeatTracker::new();
        let now = Instant::now();
        h.record("s1", now);
        assert!(h.last_seen("s1").is_some());
        h.drop_session("s1");
        assert!(h.last_seen("s1").is_none());
    }

    #[test]
    fn stale_sessions_flagged_after_grace() {
        let h = HeartbeatTracker::new();
        let now = Instant::now();
        let long_ago = now.checked_sub(DISCONNECT_AFTER + Duration::from_secs(1)).unwrap();
        h.record("dead", long_ago);
        h.record("alive", now);

        let stale = h.stale_sessions(now);
        assert_eq!(stale.len(), 1);
        assert_eq!(stale[0], "dead");
    }

    #[test]
    fn stale_sessions_treats_exactly_grace_as_stale() {
        let h = HeartbeatTracker::new();
        let now = Instant::now();
        let edge = now.checked_sub(DISCONNECT_AFTER).unwrap();
        h.record("edge", edge);
        let stale = h.stale_sessions(now);
        assert_eq!(stale, vec!["edge".to_string()]);
    }

    #[test]
    fn constants_align() {
        assert_eq!(HEARTBEAT_INTERVAL, Duration::from_secs(10));
        assert_eq!(HEARTBEAT_GRACE_BEATS, 3);
        assert_eq!(DISCONNECT_AFTER, Duration::from_secs(30));
    }
}
