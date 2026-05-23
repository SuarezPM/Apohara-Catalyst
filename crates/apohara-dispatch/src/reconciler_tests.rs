use crate::reconciler::{run_reconciler_passes, ReconcilerCtx};

#[test]
fn reconciler_runs_stall_detection_and_blocked_aging_passes() {
    let ctx = ReconcilerCtx {
        ledger_path: "/tmp/test-reconciler-ledger.jsonl".to_string(),
        workspace: "/tmp/test-reconciler-workspace".to_string(),
        session_id: "test".to_string(),
        blocked_aging_ms: 300_000,
        stall_timeout_ms: 300_000,
    };
    std::fs::create_dir_all(&ctx.workspace).ok();
    std::fs::write(&ctx.ledger_path, "").ok();

    let result = run_reconciler_passes(&ctx).unwrap();
    let pass_names: Vec<&str> = result.pass_results.iter().map(|p| p.name.as_str()).collect();
    assert!(pass_names.contains(&"stall_detection"));
    assert!(pass_names.contains(&"blocked_aging"));

    std::fs::remove_file(&ctx.ledger_path).ok();
    std::fs::remove_dir_all(&ctx.workspace).ok();
}

#[test]
fn reconciler_with_no_tasks_returns_empty_actions() {
    let ctx = ReconcilerCtx {
        ledger_path: "/tmp/test-empty-ledger.jsonl".to_string(),
        workspace: "/tmp/test-empty-workspace".to_string(),
        session_id: "empty".to_string(),
        blocked_aging_ms: 300_000,
        stall_timeout_ms: 300_000,
    };
    std::fs::create_dir_all(&ctx.workspace).ok();
    std::fs::write(&ctx.ledger_path, "").ok();

    let result = run_reconciler_passes(&ctx).unwrap();
    assert_eq!(result.total_affected.len(), 0);

    std::fs::remove_file(&ctx.ledger_path).ok();
    std::fs::remove_dir_all(&ctx.workspace).ok();
}

#[test]
fn reconciler_detects_stalled_dispatched_task() {
    let workspace = "/tmp/test-stall-detection";
    let ledger_path = format!("{}/ledger.jsonl", workspace);
    std::fs::create_dir_all(workspace).ok();

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let stalled_ms = now_ms - 600_000;

    let entry = serde_json::json!({
        "kind": "task_dispatched",
        "task_id": "t1",
        "ts": stalled_ms,
    });
    std::fs::write(&ledger_path, format!("{}\n", entry)).unwrap();

    let ctx = ReconcilerCtx {
        ledger_path: ledger_path.clone(),
        workspace: workspace.to_string(),
        session_id: "stall-test".to_string(),
        blocked_aging_ms: 300_000,
        stall_timeout_ms: 300_000,
    };

    let result = run_reconciler_passes(&ctx).unwrap();
    let stall_pass = result
        .pass_results
        .iter()
        .find(|p| p.name == "stall_detection")
        .unwrap();
    assert!(
        stall_pass.affected.contains(&"t1".to_string()),
        "t1 should be detected as stalled"
    );

    std::fs::remove_dir_all(workspace).ok();
}

#[test]
fn reconciler_ignores_completed_dispatched_task() {
    let workspace = "/tmp/test-stall-completed";
    let ledger_path = format!("{}/ledger.jsonl", workspace);
    std::fs::create_dir_all(workspace).ok();

    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_millis() as u64;
    let stalled_ms = now_ms - 600_000;

    let dispatched = serde_json::json!({
        "kind": "task_dispatched",
        "task_id": "t2",
        "ts": stalled_ms,
    });
    let completed = serde_json::json!({
        "kind": "task_completed",
        "task_id": "t2",
        "ts": stalled_ms + 1000,
    });
    std::fs::write(
        &ledger_path,
        format!("{}\n{}\n", dispatched, completed),
    )
    .unwrap();

    let ctx = ReconcilerCtx {
        ledger_path: ledger_path.clone(),
        workspace: workspace.to_string(),
        session_id: "stall-completed-test".to_string(),
        blocked_aging_ms: 300_000,
        stall_timeout_ms: 300_000,
    };

    let result = run_reconciler_passes(&ctx).unwrap();
    let stall_pass = result
        .pass_results
        .iter()
        .find(|p| p.name == "stall_detection")
        .unwrap();
    assert!(
        !stall_pass.affected.contains(&"t2".to_string()),
        "completed t2 must NOT be flagged as stalled"
    );

    std::fs::remove_dir_all(workspace).ok();
}
