use apohara_coordinator::coordinator::{Coordinator, TickOutcome};

#[tokio::test]
async fn coordinator_processes_enqueued_task() {
    let mut coord = Coordinator::new_with_mocks();
    coord.enqueue_test_task("task-1");

    let outcome = coord.tick().await;

    match outcome {
        TickOutcome::Dispatched { task_ids, .. } => {
            assert_eq!(task_ids, vec!["task-1".to_string()]);
        }
        _ => panic!("expected Dispatched, got {:?}", outcome),
    }
}

#[tokio::test]
async fn coordinator_tick_is_idempotent_on_empty_db() {
    let mut coord = Coordinator::new_with_mocks();
    let outcome = coord.tick().await;
    assert!(matches!(outcome, TickOutcome::NoOp));
}

#[tokio::test]
async fn coordinator_detects_stalled_task_after_timeout() {
    let mut coord = Coordinator::new_with_mocks();
    coord.enqueue_test_task_with_age("task-stale", 6 * 60 * 1000); // 6 min
    let outcome = coord.tick().await;
    match outcome {
        TickOutcome::StallDetected { task_ids } => {
            assert_eq!(task_ids, vec!["task-stale".to_string()]);
        }
        _ => panic!("expected StallDetected, got {:?}", outcome),
    }
}

#[tokio::test]
async fn coordinator_unblocks_task_when_deps_resolve() {
    // The deps-gated half of the F2.1 acceptance, exercised through the
    // generic tick: B is gated on A, so the first tick dispatches only A;
    // once A is marked done, the next tick unblocks B.
    let mut coord = Coordinator::new_with_mocks();
    coord.enqueue_test_task("a");
    coord.enqueue_test_task_with_deps("b", &["a"]);

    match coord.tick().await {
        TickOutcome::Dispatched { task_ids, .. } => {
            assert_eq!(task_ids, vec!["a".to_string()], "only A is ungated");
        }
        other => panic!("expected Dispatched [a], got {:?}", other),
    }

    coord.mark_test_task_done("a");

    match coord.tick().await {
        TickOutcome::Dispatched { task_ids, .. } => {
            assert_eq!(task_ids, vec!["b".to_string()], "B unblocks once A is done");
        }
        other => panic!("expected Dispatched [b], got {:?}", other),
    }
}
