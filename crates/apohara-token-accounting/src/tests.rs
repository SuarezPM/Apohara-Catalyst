use crate::{TokenCounter, TokenSnapshot};

#[test]
fn counter_records_absolute_per_thread() {
    let mut c = TokenCounter::new();
    c.record_absolute(
        "claude",
        "thread-1",
        TokenSnapshot { input: 100, output: 50, cache_creation: 10, cache_read: 5 },
    );
    c.record_absolute(
        "claude",
        "thread-1",
        TokenSnapshot { input: 200, output: 120, cache_creation: 30, cache_read: 15 },
    );
    c.record_absolute(
        "claude",
        "thread-2",
        TokenSnapshot { input: 50, output: 25, cache_creation: 0, cache_read: 0 },
    );

    // thread-1 totals are the LAST snapshot, not summed (absolutes > deltas).
    let t1 = c.get("claude", "thread-1").expect("thread-1 missing");
    assert_eq!(t1.input, 200);
    assert_eq!(t1.output, 120);

    // Cross-thread totals SUM the last-known absolute of each (provider, thread).
    let total = c.total_across_threads();
    assert_eq!(total.input, 250); // 200 + 50
    assert_eq!(total.output, 145); // 120 + 25
}

#[test]
fn counter_resists_double_count_on_replay() {
    let mut c = TokenCounter::new();
    let snap = TokenSnapshot { input: 100, output: 50, cache_creation: 0, cache_read: 0 };
    c.record_absolute("claude", "thread-x", snap.clone());
    c.record_absolute("claude", "thread-x", snap.clone()); // Same snapshot replayed.
    c.record_absolute("claude", "thread-x", snap);
    let t = c.get("claude", "thread-x").unwrap();
    // Three identical absolutes → still 100/50, not 300/150.
    assert_eq!(t.input, 100);
    assert_eq!(t.output, 50);
}

#[test]
fn counter_isolates_providers_on_same_thread() {
    // multica #18 (G5.H.6): same thread_id, different provider_id MUST
    // remain isolated. Earlier prototype keyed on thread_id alone and
    // silently overwrote one provider's absolutes with the other's.
    let mut c = TokenCounter::new();
    c.record_absolute(
        "claude",
        "thread-shared",
        TokenSnapshot { input: 1000, output: 500, cache_creation: 0, cache_read: 0 },
    );
    c.record_absolute(
        "codex",
        "thread-shared",
        TokenSnapshot { input: 200, output: 100, cache_creation: 0, cache_read: 0 },
    );

    assert_eq!(c.get("claude", "thread-shared").unwrap().input, 1000);
    assert_eq!(c.get("codex", "thread-shared").unwrap().input, 200);

    // total_for_thread SUMS across providers (per-thread budget check)
    let per_thread = c.total_for_thread("thread-shared");
    assert_eq!(per_thread.input, 1200);
    assert_eq!(per_thread.output, 600);

    // total_for_provider SUMS across threads (per-provider attention bands)
    let per_provider = c.total_for_provider("claude");
    assert_eq!(per_provider.input, 1000);
}

#[test]
fn total_for_provider_skips_other_providers() {
    let mut c = TokenCounter::new();
    c.record_absolute(
        "claude",
        "t1",
        TokenSnapshot { input: 100, output: 0, cache_creation: 0, cache_read: 0 },
    );
    c.record_absolute(
        "claude",
        "t2",
        TokenSnapshot { input: 50, output: 0, cache_creation: 0, cache_read: 0 },
    );
    c.record_absolute(
        "codex",
        "t3",
        TokenSnapshot { input: 999, output: 0, cache_creation: 0, cache_read: 0 },
    );
    assert_eq!(c.total_for_provider("claude").input, 150);
    assert_eq!(c.total_for_provider("codex").input, 999);
    assert_eq!(c.total_for_provider("nonexistent").input, 0);
}

#[test]
fn get_returns_none_for_missing_key() {
    let c = TokenCounter::new();
    assert!(c.get("claude", "missing").is_none());
}
