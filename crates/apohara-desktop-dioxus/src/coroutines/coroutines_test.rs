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

#[test]
fn git_apply_errors_on_invalid_patch_and_toasts_error() {
    use crate::state::toast_queue::ToastLevel;
    let dir = tempfile::tempdir().expect("tempdir");
    // git apply runs inside a repo; init a throwaway one so we never touch the
    // real working tree.
    std::process::Command::new("git")
        .arg("-C")
        .arg(dir.path())
        .arg("init")
        .arg("-q")
        .status()
        .expect("git init");
    let result =
        super::git_apply_handler::apply_diff("this is not a valid unified diff\n", dir.path());
    assert!(result.is_err(), "invalid patch must fail: {result:?}");
    let toast = super::git_apply_handler::apply_result_toast(&result);
    assert_eq!(toast.level, ToastLevel::Error);
    assert!(toast.message.contains("git apply failed"));
}

#[test]
fn git_apply_result_toast_success_is_success_level() {
    use crate::state::toast_queue::ToastLevel;
    let toast = super::git_apply_handler::apply_result_toast(&Ok(()));
    assert_eq!(toast.level, ToastLevel::Success);
}
