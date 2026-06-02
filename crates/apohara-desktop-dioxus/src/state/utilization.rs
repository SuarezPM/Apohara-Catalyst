//! Utilization snapshot — the data behind the F2.4 dashboard panel.
//!
//! The panel answers: are blades sitting idle while there is unblocked work?
//! how many tokens has the run spent? which blades were excluded for not
//! speaking MCP? The *computation* is a pure function over primitive counts so
//! it is unit-testable without a live mesh; the Dioxus component derives those
//! counts (active claims from `ClaimStore::list`, available/excluded from
//! `detect_providers`, tokens from `current_totals`) and renders the snapshot.

use dioxus::prelude::*;
use serde::{Deserialize, Serialize};

/// Root signal the F2.4 dashboard panel subscribes to. A watcher computes a
/// fresh [`UtilizationSnapshot`] (via [`compute_utilization`]) and writes it
/// here; the panel re-renders off the global signal — the "snapshot projected
/// to a Dioxus GlobalSignal" the story calls for.
pub static UTILIZATION: GlobalSignal<UtilizationSnapshot> =
    Signal::global(|| compute_utilization(0, 0, 0, Vec::new(), 0, 0));

/// Replace the published utilization snapshot (called by the watcher).
pub fn set_utilization(snapshot: UtilizationSnapshot) {
    *UTILIZATION.write() = snapshot;
}

/// A computed view of mesh utilization at one instant.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct UtilizationSnapshot {
    /// Blades available to take work (MCP-ready providers).
    pub available_blades: usize,
    /// Blades currently holding an active claim (Claimed/Running).
    pub active_claims: usize,
    /// Available blades NOT currently working.
    pub idle_blades: usize,
    /// Unblocked tasks ready to dispatch.
    pub ready_count: usize,
    /// The anti-idle invariant: NO blade sits idle while unblocked work exists.
    /// `true` = healthy; `false` = wasted capacity (idle blade + ready work).
    pub zero_idle_ok: bool,
    /// Provider ids excluded from the roster for not speaking MCP (F1.3).
    pub excluded: Vec<String>,
    pub tokens_in: u64,
    pub tokens_out: u64,
}

/// Compute the utilization snapshot from primitive counts. Pure.
///
/// `idle_blades = max(0, available - active)`. The anti-idle invariant
/// (`zero_idle_ok`) is violated when there is at least one idle blade AND at
/// least one ready task — i.e. capacity is being wasted on available work.
pub fn compute_utilization(
    available_blades: usize,
    active_claims: usize,
    ready_count: usize,
    excluded: Vec<String>,
    tokens_in: u64,
    tokens_out: u64,
) -> UtilizationSnapshot {
    let idle_blades = available_blades.saturating_sub(active_claims);
    let zero_idle_ok = !(idle_blades > 0 && ready_count > 0);
    UtilizationSnapshot {
        available_blades,
        active_claims,
        idle_blades,
        ready_count,
        zero_idle_ok,
        excluded,
        tokens_in,
        tokens_out,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn idle_blade_with_ready_work_violates_anti_idle() {
        // 3 blades, 1 working, 2 idle, and there IS ready work → violation.
        let s = compute_utilization(3, 1, 5, vec![], 0, 0);
        assert_eq!(s.idle_blades, 2);
        assert!(!s.zero_idle_ok, "idle blades + ready work = wasted capacity");
    }

    #[test]
    fn no_idle_is_healthy() {
        // All blades busy → healthy regardless of ready backlog.
        let s = compute_utilization(3, 3, 10, vec![], 0, 0);
        assert_eq!(s.idle_blades, 0);
        assert!(s.zero_idle_ok);
    }

    #[test]
    fn idle_with_no_ready_work_is_healthy() {
        // Idle blades but nothing to do → not a violation (nothing wasted).
        let s = compute_utilization(3, 0, 0, vec![], 0, 0);
        assert_eq!(s.idle_blades, 3);
        assert!(s.zero_idle_ok);
    }

    #[test]
    fn surfaces_excluded_blades_and_tokens() {
        let s = compute_utilization(
            2,
            1,
            0,
            vec!["gemini".to_string(), "aider".to_string()],
            1200,
            340,
        );
        assert_eq!(s.excluded, vec!["gemini".to_string(), "aider".to_string()]);
        assert_eq!(s.tokens_in, 1200);
        assert_eq!(s.tokens_out, 340);
    }

    #[test]
    fn active_exceeding_available_saturates_idle_to_zero() {
        // Defensive: active > available (stale count) must not underflow.
        let s = compute_utilization(2, 5, 1, vec![], 0, 0);
        assert_eq!(s.idle_blades, 0);
        assert!(s.zero_idle_ok);
    }
}
