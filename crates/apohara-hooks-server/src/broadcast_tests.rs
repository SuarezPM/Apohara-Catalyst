//! Unit tests for the in-process broadcast channel that fans hook events
//! out to subscribers (UI bridge, ledger appender, future Coordinator loop).

use crate::broadcast::Broadcaster;
use crate::event::HookEventPayload;

fn sample_payload() -> HookEventPayload {
    HookEventPayload::PreToolUse {
        tool_name: "bash".into(),
        tool_input: serde_json::json!({"cmd": "echo hi"}),
        timestamp: 1_700_000_000,
    }
}

#[tokio::test]
async fn broadcast_delivers_to_subscriber() {
    let bc: Broadcaster<HookEventPayload> = Broadcaster::new(16);
    let mut rx = bc.subscribe();

    let evt = sample_payload();
    bc.send(evt.clone()).expect("send ok");

    let received = rx.recv().await.expect("recv ok");
    // HookEventPayload doesn't derive PartialEq (serde_json::Value isn't Eq)
    // so we compare the serialized JSON instead — equivalent for our purposes.
    assert_eq!(
        serde_json::to_value(&received).unwrap(),
        serde_json::to_value(&evt).unwrap()
    );
}

#[tokio::test]
async fn broadcast_with_no_subscribers_does_not_panic() {
    let bc: Broadcaster<HookEventPayload> = Broadcaster::new(16);
    // tokio::broadcast::send returns Err(SendError) when no subscribers.
    // We assert the specific contract (Err) rather than accepting "either".
    // The production handler treats this Err as benign and logs at warn —
    // pinning the assertion catches a regression where send would silently
    // drop the payload on a queue overflow (a different failure mode that
    // would ALSO return Ok in the no-subscribers case, masking the bug).
    let result = bc.send(sample_payload());
    assert!(
        matches!(result, Err(_)),
        "expected Err(SendError) when no subscribers, got Ok"
    );
}

#[tokio::test]
async fn broadcast_lagged_subscriber_does_not_crash_sender() {
    // Capacity 2, one subscriber that never reads. After 3 sends, the
    // subscriber lags but sender keeps returning Ok (the broadcast channel
    // drops the oldest for the lagged receiver, not the sender).
    let bc: Broadcaster<HookEventPayload> = Broadcaster::new(2);
    let _rx = bc.subscribe(); // intentionally not awaited
    assert!(bc.send(sample_payload()).is_ok());
    assert!(bc.send(sample_payload()).is_ok());
    assert!(bc.send(sample_payload()).is_ok()); // forces lag on _rx
}
