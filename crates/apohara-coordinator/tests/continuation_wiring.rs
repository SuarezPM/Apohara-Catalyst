//! G7.5.A.6 — wire continuation / retry-semantics / teammate-idle /
//! careful-mode into `Coordinator::tick()`.
//!
//! The 4 G5.B dispatch modules originated on the TS side
//! (`src/core/dispatch/*.ts`); this test pins down the equivalent
//! Rust-side gating on `Coordinator::tick()` so the same decisions are
//! visible across the bridge.
//!
//! Each test exercises ONE of the 4 modules influencing tick outcome.

use apohara_coordinator::coordinator::{Coordinator, RetryReason, TickOutcome};

#[tokio::test]
async fn careful_mode_blocks_dispatch() {
    // When careful_mode is active for the session, tick MUST NOT
    // dispatch pending tasks — it surfaces a Blocked outcome so the
    // UI can prompt the operator.
    let mut coord = Coordinator::new_with_mocks();
    coord.enqueue_test_task("task-careful");
    coord.set_careful_mode(true);

    let outcome = coord.tick().await;

    assert!(
        matches!(outcome, TickOutcome::BlockedByCareful { .. }),
        "expected BlockedByCareful, got {:?}",
        outcome,
    );
}

#[tokio::test]
async fn careful_mode_off_allows_dispatch() {
    let mut coord = Coordinator::new_with_mocks();
    coord.enqueue_test_task("task-normal");
    // careful_mode defaults off
    let outcome = coord.tick().await;
    assert!(
        matches!(outcome, TickOutcome::Dispatched { .. }),
        "expected Dispatched, got {:?}",
        outcome,
    );
}

#[tokio::test]
async fn continuation_flag_routes_to_reused_context() {
    // A task pre-marked for continuation must surface as Dispatched
    // *with* the reuse-context bit set, so the runner knows not to
    // re-send the system prompt.
    let mut coord = Coordinator::new_with_mocks();
    coord.enqueue_test_task("task-cont");
    coord.mark_continuation("task-cont");

    let outcome = coord.tick().await;

    match outcome {
        TickOutcome::Dispatched {
            task_ids,
            reuse_context,
            ..
        } => {
            assert_eq!(task_ids, vec!["task-cont".to_string()]);
            assert!(reuse_context, "continuation should reuse context");
        }
        other => panic!("expected Dispatched with reuse_context, got {:?}", other),
    }
}

#[tokio::test]
async fn fresh_task_does_not_reuse_context() {
    let mut coord = Coordinator::new_with_mocks();
    coord.enqueue_test_task("task-fresh");
    let outcome = coord.tick().await;
    match outcome {
        TickOutcome::Dispatched {
            task_ids,
            reuse_context,
            ..
        } => {
            assert_eq!(task_ids, vec!["task-fresh".to_string()]);
            assert!(!reuse_context, "fresh task should NOT reuse context");
        }
        other => panic!("expected Dispatched without reuse_context, got {:?}", other),
    }
}

#[tokio::test]
async fn retry_semantics_returns_backoff_for_failed_task() {
    // After a failure, the coordinator must compute the right backoff
    // per retry reason — continuation gets a fixed delay, transient
    // gets exponential.
    let coord = Coordinator::new_with_mocks();

    let cont = coord.compute_retry_delay(RetryReason::Continuation, 3);
    assert_eq!(cont, 1000, "continuation backoff is fixed 1s");

    let trans0 = coord.compute_retry_delay(RetryReason::Transient, 0);
    assert_eq!(trans0, 1000, "transient attempt 0 = 1s");

    let trans3 = coord.compute_retry_delay(RetryReason::Transient, 3);
    assert_eq!(trans3, 8000, "transient attempt 3 = 8s");

    let capped = coord.compute_retry_delay(RetryReason::Transient, 30);
    assert_eq!(capped, 5 * 60 * 1000, "transient is capped at 5 min");

    let none = coord.compute_retry_delay(RetryReason::None, 1);
    assert_eq!(none, 0, "none reason yields 0 (do not retry)");
}

#[tokio::test]
async fn teammate_idle_redirects_dispatch_when_current_saturated() {
    // If the primary agent is saturated and a teammate is idle, tick
    // surfaces the idle teammate's id alongside the dispatched task
    // so the dispatcher can route the work to them.
    let mut coord = Coordinator::new_with_mocks();
    coord.register_agent("primary");
    coord.register_agent("backup");
    coord.mark_agent_busy("primary", "in-flight");

    coord.enqueue_test_task("task-redirect");

    let outcome = coord.tick().await;

    match outcome {
        TickOutcome::Dispatched {
            task_ids,
            assigned_agent,
            ..
        } => {
            assert_eq!(task_ids, vec!["task-redirect".to_string()]);
            assert_eq!(
                assigned_agent.as_deref(),
                Some("backup"),
                "should route to idle teammate",
            );
        }
        other => panic!("expected Dispatched with assigned_agent, got {:?}", other),
    }
}
