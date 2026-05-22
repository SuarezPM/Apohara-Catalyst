use apohara_audit::{AuditEvent, AuditSink, EventKind};
use std::time::SystemTime;
use tempfile::tempdir;

#[tokio::test]
async fn writes_event_and_persists_jsonl() {
    let dir = tempdir().unwrap();
    let sink = AuditSink::new(dir.path(), "test-instance").await.unwrap();

    sink.write(AuditEvent {
        ts: SystemTime::now(),
        server: "test".into(),
        kind: EventKind::McpToolInvoked,
        actor: Some("agent:claude:t1".into()),
        target: Some("apohara.runs.list_runs".into()),
        payload: serde_json::json!({ "limit": 5 }),
    })
    .await
    .unwrap();

    sink.flush().await.unwrap();

    let files: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|e| e.file_name().to_string_lossy().ends_with(".jsonl"))
        .collect();
    assert_eq!(files.len(), 1);

    let content = std::fs::read_to_string(files[0].path()).unwrap();
    assert!(content.contains("mcp_tool_invoked"));
    assert!(content.contains("apohara.runs.list_runs"));
}

#[tokio::test]
async fn enforces_0600_perms_on_unix() {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempdir().unwrap();
        let sink = AuditSink::new(dir.path(), "perm-test").await.unwrap();
        sink.write(AuditEvent {
            ts: SystemTime::now(),
            server: "test".into(),
            kind: EventKind::PolicyViolation,
            actor: None,
            target: None,
            payload: serde_json::json!({}),
        })
        .await
        .unwrap();
        sink.flush().await.unwrap();

        let files: Vec<_> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .filter(|e| e.file_name().to_string_lossy().ends_with(".jsonl"))
            .collect();
        let mode = files[0].metadata().unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600, "expected 0600, got {:o}", mode);
    }
}
