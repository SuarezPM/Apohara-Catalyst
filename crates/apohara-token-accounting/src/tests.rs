use crate::{TokenCounter, TokenSnapshot};

#[test]
fn counter_records_absolute_per_thread() {
    let mut c = TokenCounter::new();
    c.record_absolute("thread-1", TokenSnapshot { input: 100, output: 50, cache_creation: 10, cache_read: 5 });
    c.record_absolute("thread-1", TokenSnapshot { input: 200, output: 120, cache_creation: 30, cache_read: 15 });
    c.record_absolute("thread-2", TokenSnapshot { input: 50, output: 25, cache_creation: 0, cache_read: 0 });

    // thread-1 totals are the LAST snapshot, not summed (absolutes > deltas).
    let t1 = c.get("thread-1").expect("thread-1 missing");
    assert_eq!(t1.input, 200);
    assert_eq!(t1.output, 120);

    // Cross-thread totals SUM the last-known absolute of each thread.
    let total = c.total_across_threads();
    assert_eq!(total.input, 250);   // 200 + 50
    assert_eq!(total.output, 145);  // 120 + 25
}

#[test]
fn counter_resists_double_count_on_replay() {
    let mut c = TokenCounter::new();
    let snap = TokenSnapshot { input: 100, output: 50, cache_creation: 0, cache_read: 0 };
    c.record_absolute("thread-x", snap.clone());
    c.record_absolute("thread-x", snap.clone()); // Same snapshot replayed.
    c.record_absolute("thread-x", snap);
    let t = c.get("thread-x").unwrap();
    // Three identical absolutes → still 100/50, not 300/150.
    assert_eq!(t.input, 100);
    assert_eq!(t.output, 50);
}
