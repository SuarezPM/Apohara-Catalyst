//! F2.4 utilization watcher — computes the dashboard snapshot and publishes it
//! to the [`UTILIZATION`](crate::state::utilization::UTILIZATION) signal.
//!
//! Poll-only (1s), a sibling of `claim_watcher` without the notify hookup:
//! utilization is a cheap roll-up, so a steady 1s tick is plenty. Each tick
//! derives the live counts (active claims from `ClaimStore::list`, available +
//! excluded from `detect_providers`, tokens from `current_totals`), runs the
//! pure `compute_utilization`, and writes the snapshot.
//!
//! `ready_count` is 0 for now: the deps-gated ready set lives in the F2.1
//! coordinator, which is not yet wired into the desktop dispatch path (it stays
//! bake-off). When the coordinator is wired, feed its `ready_tasks().len()`
//! here and the anti-idle flag goes live end-to-end.

use std::path::PathBuf;
use std::time::Duration;

use dioxus::prelude::*;

use apohara_dispatch::api::{detect_providers, ProviderStatus};
use apohara_dispatch::{ClaimStore, RunState};
use apohara_token_accounting::api::current_totals;

use crate::state::utilization::{compute_utilization, set_utilization};

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
                0, // ready_count — wired once the coordinator drives the desktop
                excluded,
                totals.total_in,
                totals.total_out,
            );
            set_utilization(snap);
        }
    });
}
