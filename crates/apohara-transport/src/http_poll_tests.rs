use super::http_poll::{apply_poll, PollRequest, PollState};
use serde_json::json;

#[test]
fn empty_state_returns_no_events() {
    let s = PollState::default_settings();
    let r = apply_poll(
        &s,
        &PollRequest {
            since: 0,
            limit: None,
        },
    );
    assert!(r.events.is_empty());
    assert_eq!(r.cursor, 0);
}

#[test]
fn push_then_poll_returns_events_in_order() {
    let mut s = PollState::default_settings();
    s.push("a", json!(1));
    s.push("b", json!(2));
    s.push("c", json!(3));
    let r = apply_poll(
        &s,
        &PollRequest {
            since: 0,
            limit: None,
        },
    );
    let ids: Vec<u64> = r.events.iter().map(|e| e.id).collect();
    assert_eq!(ids, vec![1, 2, 3]);
    assert_eq!(r.cursor, 3);
}

#[test]
fn poll_with_since_skips_already_seen() {
    let mut s = PollState::default_settings();
    s.push("a", json!(1));
    s.push("b", json!(2));
    s.push("c", json!(3));
    let r = apply_poll(
        &s,
        &PollRequest {
            since: 2,
            limit: None,
        },
    );
    assert_eq!(r.events.len(), 1);
    assert_eq!(r.events[0].kind, "c");
    assert_eq!(r.cursor, 3);
}

#[test]
fn poll_respects_limit() {
    let mut s = PollState::default_settings();
    for i in 0..10 {
        s.push("k", json!(i));
    }
    let r = apply_poll(
        &s,
        &PollRequest {
            since: 0,
            limit: Some(3),
        },
    );
    assert_eq!(r.events.len(), 3);
    assert_eq!(r.cursor, 3);
}

#[test]
fn limit_clamped_to_max() {
    let s = PollState::new(100, 4, 8);
    let mut s = s;
    for i in 0..20 {
        s.push("k", json!(i));
    }
    let r = apply_poll(
        &s,
        &PollRequest {
            since: 0,
            limit: Some(9999),
        },
    );
    assert!(r.events.len() <= 8);
}

#[test]
fn buffer_ringbuffers_when_max_reached() {
    let mut s = PollState::new(3, 32, 32);
    s.push("a", json!(1));
    s.push("b", json!(2));
    s.push("c", json!(3));
    s.push("d", json!(4));
    let r = apply_poll(
        &s,
        &PollRequest {
            since: 0,
            limit: None,
        },
    );
    let ids: Vec<u64> = r.events.iter().map(|e| e.id).collect();
    assert_eq!(ids, vec![2, 3, 4], "id=1 should have been dropped");
}

#[test]
fn cursor_reflects_caller_when_no_new_events() {
    let mut s = PollState::default_settings();
    s.push("only", json!(1));
    let r = apply_poll(
        &s,
        &PollRequest {
            since: 5,
            limit: None,
        },
    );
    assert!(r.events.is_empty());
    // Latest id is 1, since is 5 → cursor stays at 5 (caller already past us).
    assert_eq!(r.cursor, 5);
}
