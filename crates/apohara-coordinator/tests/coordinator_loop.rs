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
