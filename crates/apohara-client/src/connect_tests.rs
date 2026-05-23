use super::connect::{
    connect_with_backoff, BackoffPolicy, ConnectError, DeterministicClock, RetryClock,
};
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};

#[test]
fn default_policy_matches_spec() {
    let p = BackoffPolicy::default();
    assert_eq!(p.initial_ms, 100);
    assert_eq!(p.max_ms, 30_000);
    assert_eq!(p.max_attempts, 3);
}

#[test]
fn delay_returns_none_after_max_attempts() {
    let p = BackoffPolicy::default();
    let clock = DeterministicClock { fixed_offset_ms: 0 };
    assert!(p.delay_for(0, &clock).is_none());
    assert!(p.delay_for(4, &clock).is_none());
    assert!(p.delay_for(3, &clock).is_some());
}

#[test]
fn delay_doubles_until_max_with_zero_jitter() {
    let p = BackoffPolicy {
        initial_ms: 100,
        max_ms: 30_000,
        max_attempts: 8,
        jitter_pct: 0,
    };
    let clock = DeterministicClock { fixed_offset_ms: 0 };
    let d1 = p.delay_for(1, &clock).unwrap().as_millis();
    let d2 = p.delay_for(2, &clock).unwrap().as_millis();
    let d3 = p.delay_for(3, &clock).unwrap().as_millis();
    assert_eq!(d1, 100);
    assert_eq!(d2, 200);
    assert_eq!(d3, 400);
}

#[test]
fn delay_caps_at_max_ms() {
    let p = BackoffPolicy {
        initial_ms: 1_000,
        max_ms: 5_000,
        max_attempts: 10,
        jitter_pct: 0,
    };
    let clock = DeterministicClock { fixed_offset_ms: 0 };
    let d_big = p.delay_for(10, &clock).unwrap().as_millis();
    assert_eq!(d_big, 5_000);
}

#[test]
fn jitter_is_bounded_by_window() {
    let p = BackoffPolicy {
        initial_ms: 1_000,
        max_ms: 1_000,
        max_attempts: 1,
        jitter_pct: 50,
    };
    let pos = DeterministicClock { fixed_offset_ms: 100_000 };
    let neg = DeterministicClock { fixed_offset_ms: -100_000 };
    let d_pos = p.delay_for(1, &pos).unwrap().as_millis();
    let d_neg = p.delay_for(1, &neg).unwrap().as_millis();
    // window = 1000 * 50% = 500
    assert_eq!(d_pos, 1500);
    assert_eq!(d_neg, 500);
}

#[tokio::test(start_paused = true)]
async fn succeeds_on_first_attempt() {
    let p = BackoffPolicy {
        initial_ms: 10,
        max_ms: 100,
        max_attempts: 3,
        jitter_pct: 0,
    };
    let clock = DeterministicClock { fixed_offset_ms: 0 };
    let count = Arc::new(AtomicU32::new(0));
    let c = count.clone();
    let result = connect_with_backoff(&p, &clock, |_| {
        let c = c.clone();
        async move {
            c.fetch_add(1, Ordering::Relaxed);
            Ok::<_, String>(())
        }
    })
    .await;
    assert_eq!(result.unwrap(), 1);
    assert_eq!(count.load(Ordering::Relaxed), 1);
}

#[tokio::test(start_paused = true)]
async fn fails_after_max_attempts() {
    let p = BackoffPolicy {
        initial_ms: 10,
        max_ms: 100,
        max_attempts: 3,
        jitter_pct: 0,
    };
    let clock = DeterministicClock { fixed_offset_ms: 0 };
    let count = Arc::new(AtomicU32::new(0));
    let c = count.clone();
    let result = connect_with_backoff(&p, &clock, |_| {
        let c = c.clone();
        async move {
            c.fetch_add(1, Ordering::Relaxed);
            Err::<(), String>("nope".into())
        }
    })
    .await;
    assert!(matches!(result, Err(ConnectError::MaxAttemptsExhausted(3))));
    assert_eq!(count.load(Ordering::Relaxed), 3);
}

#[tokio::test(start_paused = true)]
async fn succeeds_on_second_attempt() {
    let p = BackoffPolicy {
        initial_ms: 10,
        max_ms: 100,
        max_attempts: 3,
        jitter_pct: 0,
    };
    let clock = DeterministicClock { fixed_offset_ms: 0 };
    let count = Arc::new(AtomicU32::new(0));
    let c = count.clone();
    let attempt_idx = connect_with_backoff(&p, &clock, |_attempt| {
        let c = c.clone();
        async move {
            let n = c.fetch_add(1, Ordering::Relaxed) + 1;
            if n < 2 {
                Err::<(), String>("flaky".into())
            } else {
                Ok(())
            }
        }
    })
    .await
    .unwrap();
    assert_eq!(attempt_idx, 2);
    assert_eq!(count.load(Ordering::Relaxed), 2);
}

#[test]
fn deterministic_clock_clamps_to_window() {
    let c = DeterministicClock { fixed_offset_ms: 5_000 };
    assert_eq!(c.jitter_ms(100), 100);
    let c2 = DeterministicClock { fixed_offset_ms: -5_000 };
    assert_eq!(c2.jitter_ms(100), -100);
}
