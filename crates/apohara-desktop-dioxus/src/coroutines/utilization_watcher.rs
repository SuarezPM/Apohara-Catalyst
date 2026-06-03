//! F2.4 utilization watcher — computes the dashboard snapshot and publishes it
//! to the [`UTILIZATION`](crate::state::utilization::UTILIZATION) signal.
//!
//! Poll-only (1s), a sibling of `claim_watcher` without the notify hookup:
//! utilization is a cheap roll-up, so a steady 1s tick is plenty. Each tick
//! derives the live counts (active claims from `ClaimStore::list`, available +
//! excluded from `detect_providers`, tokens from `current_totals`), runs the
//! pure `compute_utilization`, and writes the snapshot.
//!
//! US-S2 — when `APOHARA_MESH` is on, the same 1s poll now ALSO:
//!   1. feeds a real `ready_count` from `DispatchSchedulerStore::ready_tasks()`
//!      over the newest per-run DAG subdir (the anti-idle invariant goes live),
//!   2. reaps stale dead-PID claims via `DispatchSchedulerStore::reap_stale`
//!      (the Change 1 background-safety backstop), so a blade that dies
//!      *between* runs doesn't strand a `Claimed` slot — no new spawn surface.
//!
//! With mesh OFF the watcher keeps `ready_count = 0` and does NOT reap (the
//! bake-off owns its own claim lifecycle).

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use dioxus::prelude::*;

use apohara_coordinator::SchedulerStore;
use apohara_dispatch::api::{detect_providers, ProviderStatus};
use apohara_dispatch::{ClaimStore, DispatchSchedulerStore, RunState, TaskGraph};
use apohara_token_accounting::api::current_totals;

use crate::coroutines::dispatch_loop::{mesh_enabled, newest_run_tasks_dir};
use crate::state::utilization::{compute_utilization, set_utilization};

/// The reaper TTL the background poll passes — mirrors the coordinator's 5-min
/// default stall window so a claim freed here ages out on the same clock the
/// on-demand drive loop uses.
const REAP_TTL_MS: i64 = 5 * 60 * 1000;

/// Mount the 1s utilization poll. Self-driven; the receiver is unused.
pub fn mount() {
    let _ = use_coroutine(|_rx: UnboundedReceiver<()>| async move {
        let repo = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let store = ClaimStore::new(repo.join(".apohara").join("claims"));

        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;

            let detected = detect_providers();
            let available = detected
                .iter()
                .filter(|d| matches!(d.status, ProviderStatus::Active))
                .count();
            let excluded: Vec<String> = detected
                .iter()
                .filter(|d| matches!(d.status, ProviderStatus::ExcludedNoMcpAdapter(_)))
                .map(|d| d.id.clone())
                .collect();

            // US-S2 — mesh on: reap stale dead-PID claims and feed a live
            // ready_count. mesh off: 0 (and no reaping), exactly as before.
            let mesh_on = mesh_enabled(std::env::var("APOHARA_MESH").ok().as_deref());
            let ready_count = mesh_ready_count_and_reap(&repo, mesh_on);

            let active_claims = store
                .list()
                .map(|recs| {
                    recs.iter()
                        .filter(|r| matches!(r.state, RunState::Claimed | RunState::Running))
                        .count()
                })
                .unwrap_or(0);

            let totals = current_totals();
            let snap = compute_utilization(
                available,
                active_claims,
                ready_count,
                excluded,
                totals.total_in,
                totals.total_out,
            );
            set_utilization(snap);
        }
    });
}

/// US-S2 — when `mesh_on`, reap stale dead-PID claims (Change 1 backstop) AND
/// return the live `ready_count` from the newest per-run DAG; otherwise 0 with
/// NO reaping. Best-effort throughout: any store error logs + degrades (0 /
/// skip), never breaks the 1s poll loop.
///
/// The reaper sweeps the SHARED claim root (run-agnostic, PID-liveness-keyed),
/// so a dead-PID record from any run is released even with no `run_dispatch`
/// active. `ready_count` reads the newest run subdir's graph — the active run
/// during a dispatch, or the most-recent (fully-`done`, ready_count 0) run
/// between dispatches.
fn mesh_ready_count_and_reap(repo: &Path, mesh_on: bool) -> usize {
    if !mesh_on {
        return 0;
    }
    let tasks_dir = newest_run_tasks_dir(repo)
        .unwrap_or_else(|| repo.join(".apohara").join("tasks"));
    let mut store = DispatchSchedulerStore::from_parts(
        TaskGraph::new(tasks_dir),
        ClaimStore::new(repo.join(".apohara").join("claims")),
    );

    // Reap stale dead-PID claims (best-effort). reap_stale only touches the
    // claim store, so it works regardless of which graph subdir we picked.
    let now_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    if let Err(e) = store.reap_stale(now_ms, REAP_TTL_MS) {
        tracing::warn!("utilization: background reap_stale failed (non-fatal): {e}");
    }

    store.ready_tasks().map(|r| r.len()).unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use apohara_dispatch::{build_master_plan, ClaimOutcome};
    use tempfile::TempDir;

    fn claims_of(repo: &Path) -> ClaimStore {
        ClaimStore::new(repo.join(".apohara").join("claims"))
    }

    #[test]
    fn mesh_off_yields_zero_and_no_reaping() {
        let dir = TempDir::new().unwrap();
        let repo = dir.path();
        let claims = claims_of(repo);
        // A dead-PID claim that WOULD be reaped if mesh were on.
        let token = match claims.try_claim("plan").unwrap() {
            ClaimOutcome::Acquired { token } => token,
            other => panic!("{other:?}"),
        };
        claims.heartbeat("plan", &token, u32::MAX, 1_000, None).unwrap();

        // mesh off -> 0 and the claim is left untouched (bake-off owns it).
        assert_eq!(mesh_ready_count_and_reap(repo, false), 0);
        assert!(
            claims.has_active_claim("plan").unwrap(),
            "mesh off must NOT reap — the bake-off owns its claim lifecycle"
        );
    }

    #[test]
    fn mesh_on_feeds_real_ready_count() {
        let dir = TempDir::new().unwrap();
        let repo = dir.path();
        // Seed a per-run DAG: linear plan -> implement -> verify (ready = plan).
        let graph = TaskGraph::new(repo.join(".apohara").join("tasks").join("run-1"));
        build_master_plan(&graph, "improve the thing", &[]).unwrap();

        let ready = mesh_ready_count_and_reap(repo, true);
        assert_eq!(ready, 1, "only the gate-free `plan` node is ready up front");

        // And it makes the anti-idle invariant fire: idle blade + ready work.
        let snap = compute_utilization(1, 0, ready, vec![], 0, 0);
        assert!(!snap.zero_idle_ok, "idle blade + ready work = wasted capacity surfaced");
    }

    #[test]
    fn mesh_on_reaps_dead_pid_claim_with_no_run_active() {
        let dir = TempDir::new().unwrap();
        let repo = dir.path();
        let claims = claims_of(repo);
        // A dead-PID Claimed record with NO active run / no DAG on disk.
        let token = match claims.try_claim("orphan").unwrap() {
            ClaimOutcome::Acquired { token } => token,
            other => panic!("{other:?}"),
        };
        claims.heartbeat("orphan", &token, u32::MAX, 1_000, None).unwrap();
        assert!(claims.has_active_claim("orphan").unwrap());

        // One poll with mesh on releases the dead claim (node claimable again).
        let _ = mesh_ready_count_and_reap(repo, true);
        assert!(
            !claims.has_active_claim("orphan").unwrap(),
            "a dead-PID claim is released by the background poll when mesh is on"
        );
    }

    #[test]
    fn mesh_on_leaves_live_pid_claim_alone() {
        let dir = TempDir::new().unwrap();
        let repo = dir.path();
        let claims = claims_of(repo);
        // A claim heartbeaten by THIS (live) process -> must NOT be reaped.
        let token = match claims.try_claim("live").unwrap() {
            ClaimOutcome::Acquired { token } => token,
            other => panic!("{other:?}"),
        };
        let me = std::process::id();
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_millis() as i64;
        claims.heartbeat("live", &token, me, now, None).unwrap();

        let _ = mesh_ready_count_and_reap(repo, true);
        assert!(
            claims.has_active_claim("live").unwrap(),
            "a live-PID claim within TTL must survive the background reap"
        );
    }
}
