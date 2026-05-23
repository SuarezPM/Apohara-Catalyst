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
