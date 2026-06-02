//! `claim_watcher` coroutine — projects the REAL cross-process claim state
//! (the F0.0 [`ClaimStore`]) into the desktop `TASKS` signal so the TaskBoard
//! reflects what the heterogeneous blade processes actually claimed, not only
//! the hand-maintained `state/tasks.rs` projection (US-F1.5).
//!
//! ## Rescan-on-any-event + 1s poll (load-bearing past-incident)
//!
//! The claim store writes records with the §0.8 atomic-write discipline
//! (`NamedTempFile` + rename). On Linux, inotify reports an atomic rename under
//! the **temp** filename, not the renamed target — so a watcher that matched on
//! `<task_id>.json` would hear the event and ignore it (the exact `Done (0)`
//! forever bug from the TS `result-watcher.ts`). Therefore: ANY fs event →
//! rescan the WHOLE claims dir; never filename-match. The event payload is
//! drained and discarded.
//!
//! Paired with a 1s polling backup so flaky inotify (FUSE / NFS / some
//! platforms) never strands a claim transition: even with zero events the poll
//! tick re-reads the dir every second.
//!
//! ## SSR-safety & resilience
//!
//! `use_coroutine` defers the future past the SSR render, so the App SSR tests
//! never spin this loop. No `unwrap()` on runtime paths — a watcher/notify
//! setup error is logged and the poll loop still runs (the UI never panics on a
//! watcher fault). Gated behind `APOHARA_RUST_DISPATCH` (no-op when `=0`).

use std::path::PathBuf;
use std::time::Duration;

use dioxus::prelude::*;

use apohara_dispatch::api::is_enabled;
use apohara_dispatch::{ClaimStore, RunState};

use crate::state::tasks::{upsert_task, DagTask, TaskStatus, TASKS};

/// Mount the coroutine. Self-driven: rescans on any fs event and on a 1s tick.
pub fn mount() {
    let _ = use_coroutine(|_rx: UnboundedReceiver<()>| async move {
        // No-op when the Rust dispatch path is explicitly disabled (=0): the TS
        // legacy path owns claims, so there is nothing to project.
        if !is_enabled(std::env::var("APOHARA_RUST_DISPATCH").ok().as_deref()) {
            return;
        }

        let repo = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        let claims_dir = repo.join(".apohara").join("claims");
        // Ensure the watch target exists so `watcher.watch` has something to
        // bind to even before the first claim lands. Non-fatal: a failure here
        // just means notify can't bind yet — the poll loop still rescans (and
        // `list()` tolerates a missing dir).
        if let Err(e) = std::fs::create_dir_all(&claims_dir) {
            tracing::warn!(?claims_dir, "claim_watcher: create_dir_all failed (non-fatal): {e}");
        }
        let store = ClaimStore::new(&claims_dir);

        // notify runs its callback on its OWN thread, so we just SIGNAL through
        // an unbounded channel and do the actual rescan in this async loop. The
        // watcher is BOUND in this scope: dropping it (on coroutine teardown)
        // stops watching.
        let (wtx, mut wrx) = tokio::sync::mpsc::unbounded_channel::<()>();
        let _watcher = match build_watcher(&claims_dir, wtx) {
            Some(w) => Some(w),
            None => {
                // Watcher setup failed: degrade to poll-only rather than
                // panicking the UI. The 1s tick below still reconciles.
                tracing::warn!("claim_watcher: notify watcher unavailable; polling only");
                None
            }
        };

        // Initial reconcile so the board reflects any claims already on disk at
        // mount (e.g. a prior run's released records), without waiting 1s.
        rescan(&store);

        loop {
            tokio::select! {
                // 1s poll backup: reconcile even if no fs event ever fires.
                _ = tokio::time::sleep(Duration::from_secs(1)) => rescan(&store),
                // Any fs event: rescan the WHOLE dir. Drain/ignore the payload —
                // rescan-on-any-event, never filename-match.
                msg = wrx.recv() => {
                    if msg.is_none() {
                        // The watcher (and thus its sender) was dropped; keep
                        // the poll loop alive on the next iteration.
                        continue;
                    }
                    // Coalesce a burst: drain any queued signals so one rescan
                    // covers them all.
                    while wrx.try_recv().is_ok() {}
                    rescan(&store);
                }
            }
        }
    });
}

/// Build a recursive notify watcher on `claims_dir` whose every event sends a
/// bare `()` through `wtx`. Returns `None` (caller degrades to poll-only) on any
/// notify setup error — never panics. `notify = "6"` API (`recommended_watcher`
/// + `Watcher::watch`), mirroring `apohara-spec`'s plan watcher.
fn build_watcher(
    claims_dir: &std::path::Path,
    wtx: tokio::sync::mpsc::UnboundedSender<()>,
) -> Option<notify::RecommendedWatcher> {
    use notify::Watcher;
    let mut watcher = match notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        // We do not inspect the event: ANY change → signal a rescan. A notify
        // error is logged; we still poke the loop so the poll path re-reads.
        if let Err(e) = res {
            tracing::warn!("claim_watcher: notify event error: {e}");
        }
        let _ = wtx.send(());
    }) {
        Ok(w) => w,
        Err(e) => {
            tracing::warn!("claim_watcher: failed to create watcher: {e}");
            return None;
        }
    };
    if let Err(e) = watcher.watch(claims_dir, notify::RecursiveMode::Recursive) {
        tracing::warn!(?claims_dir, "claim_watcher: failed to watch: {e}");
        return None;
    }
    Some(watcher)
}

/// Full rescan: read every claim record and merge its state into `TASKS`. A
/// `list()` error is logged and skipped (best-effort observability — never
/// strand the UI on a transient read fault).
fn rescan(store: &ClaimStore) {
    let records = match store.list() {
        Ok(records) => records,
        Err(e) => {
            tracing::warn!("claim_watcher: claim store list failed (non-fatal): {e}");
            return;
        }
    };
    for record in records {
        let current = TASKS.read().get(&record.task_id).map(|t| t.status);
        if let Some(next) = merged_status(record.state, current) {
            // Get-or-create the DagTask, preserving the existing title/provider
            // when the loop already created it; only the status is authoritative
            // from the claim store.
            let mut task = TASKS
                .read()
                .get(&record.task_id)
                .cloned()
                .unwrap_or_else(|| DagTask {
                    id: record.task_id.clone(),
                    ..Default::default()
                });
            task.status = next;
            upsert_task(task);
        }
    }
}

/// PURE projection of a claim [`RunState`] onto the TaskBoard [`TaskStatus`].
///
/// Returns the status to set, or `None` to leave the task untouched. The two
/// `None` cases are deliberate guards against clobbering the dispatch_loop's
/// authoritative terminal outcome:
///   * `Released` → `None`: a released slot says nothing about success/failure;
///     the loop upserts the real Done/Failed from the gate outcome, so the
///     watcher must not overwrite it with a generic status.
///   * `current` already `Done`/`Failed` → `None`: never DOWNGRADE a terminal
///     status (e.g. a late `Running` record racing the loop's `Done`).
pub(crate) fn merged_status(state: RunState, current: Option<TaskStatus>) -> Option<TaskStatus> {
    // Never downgrade a terminal status the dispatch_loop already committed.
    if matches!(current, Some(TaskStatus::Done) | Some(TaskStatus::Failed)) {
        return None;
    }
    match state {
        RunState::Claimed | RunState::Running => Some(TaskStatus::Dispatched),
        RunState::RetryQueued => Some(TaskStatus::Ready),
        RunState::Unclaimed => Some(TaskStatus::Pending),
        // Preserve the loop's terminal Done/Failed (see doc comment).
        RunState::Released => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn claimed_and_running_map_to_dispatched() {
        assert_eq!(merged_status(RunState::Claimed, None), Some(TaskStatus::Dispatched));
        assert_eq!(merged_status(RunState::Running, None), Some(TaskStatus::Dispatched));
    }

    #[test]
    fn retry_queued_maps_to_ready() {
        assert_eq!(merged_status(RunState::RetryQueued, None), Some(TaskStatus::Ready));
    }

    #[test]
    fn unclaimed_maps_to_pending() {
        assert_eq!(merged_status(RunState::Unclaimed, None), Some(TaskStatus::Pending));
    }

    #[test]
    fn released_leaves_task_untouched() {
        // Released carries no outcome — the loop owns the terminal status.
        assert_eq!(merged_status(RunState::Released, None), None);
        assert_eq!(merged_status(RunState::Released, Some(TaskStatus::Dispatched)), None);
    }

    #[test]
    fn terminal_status_is_never_downgraded() {
        // A late Running/Claimed record must not clobber a committed terminal.
        for state in [
            RunState::Unclaimed,
            RunState::Claimed,
            RunState::Running,
            RunState::RetryQueued,
            RunState::Released,
        ] {
            assert_eq!(
                merged_status(state, Some(TaskStatus::Done)),
                None,
                "Done must never be downgraded by {state:?}"
            );
            assert_eq!(
                merged_status(state, Some(TaskStatus::Failed)),
                None,
                "Failed must never be downgraded by {state:?}"
            );
        }
    }

    #[test]
    fn non_terminal_current_is_overwritten() {
        // A non-terminal current status follows the claim state.
        assert_eq!(
            merged_status(RunState::Running, Some(TaskStatus::Pending)),
            Some(TaskStatus::Dispatched)
        );
        assert_eq!(
            merged_status(RunState::RetryQueued, Some(TaskStatus::Dispatched)),
            Some(TaskStatus::Ready)
        );
    }
}
