//! Verifies spec §0.4 non-blocking overflow behavior.

use apohara_audit::{AuditEvent, AuditSink, EventKind};
use std::time::{Duration, Instant};

fn dummy_event() -> AuditEvent {
    AuditEvent {
        ts: std::time::SystemTime::now(),
        server: "test".into(),
        kind: EventKind::HookEvent,
        actor: None,
        target: None,
        payload: serde_json::Value::Null,
    }
}

#[tokio::test]
async fn write_does_not_block_on_full_queue() {
    let tmp = tempfile::tempdir().unwrap();
    let sink = AuditSink::new(tmp.path(), "test").await.unwrap();

    // Flood writes faster than the writer task can drain. Queue depth is 1024;
    // sending ~3000 should overwhelm it. With try_send, all 3000 calls must
    // complete in well under a second (no per-call await on a backpressured channel).
    let start = Instant::now();
    let mut overflow_count = 0;
    let mut ok_count = 0;
    for _ in 0..3000 {
        match sink.write(dummy_event()) {
            Ok(()) => ok_count += 1,
            Err(_) => overflow_count += 1,
        }
    }
    let elapsed = start.elapsed();

    assert!(
        elapsed < Duration::from_millis(500),
        "write() blocked under overflow: 3000 calls took {:?} (must be <500ms)",
        elapsed
    );
    assert!(overflow_count > 0, "no overflow observed — queue depth assumption wrong");
    assert_eq!(ok_count + overflow_count, 3000, "every call must return, none lost");
}
