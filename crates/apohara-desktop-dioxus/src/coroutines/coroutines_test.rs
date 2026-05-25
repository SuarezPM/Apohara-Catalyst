//! Tests for the effect-owner coroutines. The async loop bodies are exercised
//! through their pure/idempotent helpers (the timer/stream plumbing itself is
//! covered by the manual W4.SMOKE run).

use dioxus::prelude::*;

/// Run `f` inside a Dioxus runtime so `GlobalSignal::read/write` work.
fn with_runtime<F: FnOnce()>(f: F) {
    fn empty() -> Element {
        rsx! {}
    }
    let vdom = VirtualDom::new(empty);
    vdom.in_runtime(f);
}

#[test]
fn toast_reaper_sweep_removes_only_expired_toasts() {
    use crate::state::toast_queue::{push, sweep_expired, Toast, ToastLevel, TOAST_QUEUE};
    with_runtime(|| {
        push(Toast {
            id: "expired".into(),
            level: ToastLevel::Info,
            message: "gone".into(),
            created_at: std::time::Instant::now(),
            ttl_ms: 0, // already past its deadline
        });
        push(Toast {
            id: "fresh".into(),
            level: ToastLevel::Info,
            message: "stays".into(),
            created_at: std::time::Instant::now(),
            ttl_ms: 60_000,
        });
        sweep_expired();
        let q = TOAST_QUEUE.read();
        assert_eq!(q.len(), 1, "the expired toast should be swept: {:?}", q.len());
        assert_eq!(q[0].id, "fresh");
    });
}
