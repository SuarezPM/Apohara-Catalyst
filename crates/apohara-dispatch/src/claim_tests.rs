//! Acceptance tests for the atomic claim store (US-F0.0).
//!
//! These are the de-risking proofs: exactly-once claim under heavy
//! in-process contention, stale-token rejection after a reap, and a
//! cross-process smoke test proving the advisory lock is honored by
//! *separate OS processes* (the BYOC blade model).

use crate::claim::{ClaimOutcome, ClaimStore, ReportOutcome};
use crate::state::RunState;
use std::sync::{Arc, Barrier};
use tempfile::TempDir;

/// N threads claim the SAME task at once (synchronized on a `Barrier`
/// to maximize overlap). Exactly one wins; the rest get a clean
/// `AlreadyClaimed`.
#[test]
fn concurrent_claims_elect_exactly_one_winner() {
    const N: usize = 8;
    let dir = TempDir::new().unwrap();
    let store = ClaimStore::new(dir.path().join("claims"));
    let barrier = Arc::new(Barrier::new(N));
    let task_id = "task-concurrent";

    let handles: Vec<_> = (0..N)
        .map(|_| {
            let store = store.clone();
            let barrier = Arc::clone(&barrier);
            std::thread::spawn(move || {
                // All threads release the barrier together, then race the
                // very next instruction — the claim.
                barrier.wait();
                store.try_claim(task_id).unwrap()
            })
        })
        .collect();

    let outcomes: Vec<ClaimOutcome> = handles.into_iter().map(|h| h.join().unwrap()).collect();
    let acquired = outcomes
        .iter()
        .filter(|o| matches!(o, ClaimOutcome::Acquired { .. }))
        .count();
    let rejected = outcomes
        .iter()
        .filter(|o| matches!(o, ClaimOutcome::AlreadyClaimed))
        .count();

    assert_eq!(acquired, 1, "exactly one thread must win the claim");
    assert_eq!(rejected, N - 1, "every other thread must see AlreadyClaimed");

    let record = store.load(task_id).unwrap().unwrap();
    assert_eq!(record.state, RunState::Claimed);
    assert!(record.token.is_some());
}

/// Reaper race: claim with token A, reaper releases, re-claim with token
/// B. A `report_result` carrying the stale token A is REJECTED; token B
/// is ACCEPTED.
#[test]
fn stale_token_rejected_after_reap_and_reclaim() {
    let dir = TempDir::new().unwrap();
    let store = ClaimStore::new(dir.path().join("claims"));
    let task_id = "task-reap";

    let token_a = match store.try_claim(task_id).unwrap() {
        ClaimOutcome::Acquired { token } => token,
        other => panic!("expected first claim to win, got {other:?}"),
    };

    // Reaper frees the stalled blade out-of-band.
    store.release(task_id).unwrap();

    let token_b = match store.try_claim(task_id).unwrap() {
        ClaimOutcome::Acquired { token } => token,
        other => panic!("expected re-claim to win, got {other:?}"),
    };
    assert_ne!(token_a, token_b, "re-claim must mint a fresh token");

    // The zombie wakes up and reports with the stale token: rejected.
    assert_eq!(
        store.report_result(task_id, &token_a).unwrap(),
        ReportOutcome::StaleToken,
        "reaped claimer's stale token must be rejected",
    );

    // The live claimer reports with the current token: accepted.
    assert_eq!(
        store.report_result(task_id, &token_b).unwrap(),
        ReportOutcome::Accepted,
        "current claimer's token must be accepted",
    );

    // After a successful report the slot is released and claimable again.
    let record = store.load(task_id).unwrap().unwrap();
    assert_eq!(record.state, RunState::Released);
    assert!(record.token.is_none());
}

/// A released slot is claimable again (covers `Released → claimable`).
#[test]
fn released_slot_is_reclaimable() {
    let dir = TempDir::new().unwrap();
    let store = ClaimStore::new(dir.path().join("claims"));
    let task_id = "task-recycle";

    let token = match store.try_claim(task_id).unwrap() {
        ClaimOutcome::Acquired { token } => token,
        other => panic!("expected claim, got {other:?}"),
    };
    assert_eq!(
        store.report_result(task_id, &token).unwrap(),
        ReportOutcome::Accepted
    );
    // Released → claimable.
    assert!(matches!(
        store.try_claim(task_id).unwrap(),
        ClaimOutcome::Acquired { .. }
    ));
}

/// `list()` enumerates every persisted record sorted by `task_id`, tolerates
/// a never-created store (empty, not an error), and keeps a released slot in
/// the listing (state `Released`). Skips the `.lock` companions implicitly —
/// claiming a task writes both a `.json` record and a `.lock` file, yet each
/// task appears exactly once.
#[test]
fn list_returns_all_records_sorted_including_released() {
    let dir = TempDir::new().unwrap();
    let store = ClaimStore::new(dir.path().join("claims"));

    // A never-created store is empty, not an error.
    assert!(store.list().unwrap().is_empty(), "fresh store lists nothing");

    // Claim out of lexical order so the sort is actually exercised.
    let token_b = match store.try_claim("task-b").unwrap() {
        ClaimOutcome::Acquired { token } => token,
        other => panic!("expected claim, got {other:?}"),
    };
    match store.try_claim("task-a").unwrap() {
        ClaimOutcome::Acquired { .. } => {}
        other => panic!("expected claim, got {other:?}"),
    }

    // Release one task — it must still appear, now in state Released.
    assert_eq!(
        store.report_result("task-b", &token_b).unwrap(),
        ReportOutcome::Accepted
    );

    let records = store.list().unwrap();
    let ids: Vec<&str> = records.iter().map(|r| r.task_id.as_str()).collect();
    assert_eq!(ids, vec!["task-a", "task-b"], "sorted by task_id, both present");

    let a = records.iter().find(|r| r.task_id == "task-a").unwrap();
    assert_eq!(a.state, RunState::Claimed);
    let b = records.iter().find(|r| r.task_id == "task-b").unwrap();
    assert_eq!(b.state, RunState::Released, "released task still lists");
}

/// `has_active_claim` (US-F2.0c): the read the PreToolUse claim-guard hook
/// consults. True only while a live claim (`Claimed`/`Running`) exists; a
/// never-claimed task is false, and a `Released` slot is false again so a
/// blade that finished can no longer write under the old claim.
#[test]
fn has_active_claim_tracks_live_claim() {
    let dir = TempDir::new().unwrap();
    let store = ClaimStore::new(dir.path().join("claims"));
    let task_id = "task-guard";

    // No record yet → no active claim (guard blocks).
    assert!(
        !store.has_active_claim(task_id).unwrap(),
        "a never-claimed task has no active claim"
    );

    // Claimed → active (guard allows).
    let token = match store.try_claim(task_id).unwrap() {
        ClaimOutcome::Acquired { token } => token,
        other => panic!("expected claim, got {other:?}"),
    };
    assert!(
        store.has_active_claim(task_id).unwrap(),
        "a claimed task has an active claim"
    );

    // Released → no longer active (guard blocks again).
    assert_eq!(
        store.report_result(task_id, &token).unwrap(),
        ReportOutcome::Accepted
    );
    assert!(
        !store.has_active_claim(task_id).unwrap(),
        "a released task has no active claim"
    );
}

// ---------------------------------------------------------------------
// Cross-process smoke test.
//
// Two CHILD PROCESSES (re-execs of this very test binary, gated by an
// env var) race to claim the same task in a shared directory. Exactly
// one must win. This proves the advisory lock crosses the process
// boundary — the whole point of the de-risking, since blades are
// separate processes.
// ---------------------------------------------------------------------

const CLAIM_CHILD_ENV: &str = "APOHARA_CLAIM_CHILD_DIR";
const CLAIM_CHILD_TASK: &str = "cross-process-task";

/// Child entrypoint: invoked when the test binary is re-exec'd with
/// `APOHARA_CLAIM_CHILD_DIR` set. Attempts one claim and exits 10 on
/// win / 11 on already-claimed, so the parent can count winners by exit
/// code alone (no IPC needed).
#[test]
fn cross_process_child_entry() {
    let Ok(dir) = std::env::var(CLAIM_CHILD_ENV) else {
        // Not running as a child — this is a no-op when invoked as part
        // of the normal in-process test sweep.
        return;
    };
    let store = ClaimStore::new(std::path::PathBuf::from(dir).join("claims"));
    let code = match store.try_claim(CLAIM_CHILD_TASK).unwrap() {
        ClaimOutcome::Acquired { .. } => 10,
        ClaimOutcome::AlreadyClaimed => 11,
    };
    // Bypass the harness — we want a deterministic process exit code.
    std::process::exit(code);
}

#[test]
fn cross_process_claim_elects_one_winner() {
    let dir = TempDir::new().unwrap();
    let exe = std::env::current_exe().expect("test binary path");

    // Spawn both children pointed at the same claim dir, racing the same
    // task. `--exact` keeps each child to the single child-entry test;
    // `--nocapture` avoids buffering games. The child detects its role
    // via the env var and exits with a role-specific code.
    let spawn = || {
        std::process::Command::new(&exe)
            .args([
                "--exact",
                "claim_tests::cross_process_child_entry",
                "--nocapture",
            ])
            .env(CLAIM_CHILD_ENV, dir.path())
            .spawn()
            .expect("spawn child test binary")
    };

    let a = spawn();
    let b = spawn();
    let code_a = a.wait_with_output().unwrap().status.code();
    let code_b = b.wait_with_output().unwrap().status.code();

    let mut codes = vec![code_a, code_b];
    codes.sort();
    // One child acquired (10), one saw already-claimed (11). If the lock
    // failed to cross the process boundary we'd see two 10s.
    assert_eq!(
        codes,
        vec![Some(10), Some(11)],
        "exactly one child process must win the cross-process claim (got {codes:?})",
    );

    // The shared store reflects a single live claim.
    let store = ClaimStore::new(dir.path().join("claims"));
    let record = store.load(CLAIM_CHILD_TASK).unwrap().unwrap();
    assert_eq!(record.state, RunState::Claimed);
}
