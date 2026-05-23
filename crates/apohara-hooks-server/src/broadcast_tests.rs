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
    // tokio::broadcast::send returns Err(SendError) when no subscribers; we
    // accept either Ok or Err — neither should panic. The production
    // handler treats Err as benign and logs at warn.
    let _ = bc.send(sample_payload());
}
