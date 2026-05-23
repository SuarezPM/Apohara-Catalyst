use super::{Hub, HubError, HubMessage, StampedePolicy};
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
async fn publish_then_subscribe_delivers_message() {
    let hub = Hub::new();
    let mut sub = hub.subscribe("alpha").await.unwrap();
    let id = Uuid::new_v4();
    let msg = HubMessage {
        channel: "alpha".into(),
        message_id: id,
        payload: json!({"x": 1}),
    };
    hub.publish(msg.clone()).await.unwrap();
    let got = sub.rx.recv().await.unwrap();
    assert_eq!(got, msg);
}

#[tokio::test]
async fn duplicate_message_id_is_dropped() {
    let hub = Hub::new();
    let mut sub = hub.subscribe("alpha").await.unwrap();
    let id = Uuid::new_v4();
    let msg = HubMessage {
        channel: "alpha".into(),
        message_id: id,
        payload: json!({"a": 1}),
    };
    let first = hub.publish(msg.clone()).await.unwrap();
    let second = hub.publish(msg.clone()).await.unwrap();
    assert!(first);
    assert!(!second);
    // Receiver gets exactly one delivery.
    let got = sub.rx.recv().await.unwrap();
    assert_eq!(got.message_id, id);
    let no_more = tokio::time::timeout(
        std::time::Duration::from_millis(20),
        sub.rx.recv(),
    )
    .await;
    assert!(no_more.is_err(), "expected timeout — no second delivery");
}

#[tokio::test]
async fn dedupe_isolated_per_channel() {
    let hub = Hub::new();
    let id = Uuid::new_v4();
    let msg_a = HubMessage {
        channel: "a".into(),
        message_id: id,
        payload: json!(1),
    };
    let msg_b = HubMessage {
        channel: "b".into(),
        message_id: id,
        payload: json!(2),
    };
    assert!(hub.publish(msg_a).await.unwrap());
    assert!(hub.publish(msg_b).await.unwrap());
}

#[tokio::test]
async fn subscriber_count_tracks_live_receivers() {
    let hub = Hub::new();
    assert_eq!(hub.subscriber_count("k").await, 0);
    let s = hub.subscribe("k").await.unwrap();
    assert_eq!(hub.subscriber_count("k").await, 1);
    drop(s);
    // broadcast::Sender::receiver_count is eventually consistent; allow a yield.
    tokio::task::yield_now().await;
    assert_eq!(hub.subscriber_count("k").await, 0);
}

#[tokio::test]
async fn two_subscribers_both_receive() {
    let hub = Hub::new();
    let mut a = hub.subscribe("multi").await.unwrap();
    let mut b = hub.subscribe("multi").await.unwrap();
    let id = Uuid::new_v4();
    hub.publish(HubMessage {
        channel: "multi".into(),
        message_id: id,
        payload: json!("hi"),
    })
    .await
    .unwrap();
    let ra = a.rx.recv().await.unwrap();
    let rb = b.rx.recv().await.unwrap();
    assert_eq!(ra.message_id, id);
    assert_eq!(rb.message_id, id);
}

#[tokio::test]
async fn stampede_cap_rejects_extra_subscribers() {
    let policy = StampedePolicy::with_max(2);
    let hub = Hub::with_policy(policy);
    let _s1 = hub.subscribe("hot").await.unwrap();
    let _s2 = hub.subscribe("hot").await.unwrap();
    let err = hub.subscribe("hot").await.unwrap_err();
    assert!(matches!(err, HubError::StampedeCapReached(c) if c == "hot"));
}

#[tokio::test]
async fn dropping_subscription_releases_stampede_slot() {
    let policy = StampedePolicy::with_max(1);
    let hub = Hub::with_policy(policy);
    {
        let _s = hub.subscribe("solo").await.unwrap();
        // While `_s` is alive, second subscribe must fail.
        assert!(hub.subscribe("solo").await.is_err());
    }
    // After drop, the slot is back.
    let _new = hub.subscribe("solo").await.unwrap();
}
