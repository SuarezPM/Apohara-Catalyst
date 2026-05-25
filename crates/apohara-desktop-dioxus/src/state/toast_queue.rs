//! Toast notification queue.
//!
//! NEW signal (Sprint 23). The ToastContainer overlay (W3.D.2) renders the
//! queue FIFO; the `toast_reaper` coroutine (W4.6) calls `sweep_expired` every
//! 5s to evict toasts past their `created_at + ttl_ms` deadline.

use dioxus::prelude::*;
use std::collections::VecDeque;
use std::time::Instant;

/// Severity level for a toast — drives color/icon in the ToastContainer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ToastLevel {
    Info,
    Success,
    Warning,
    Error,
}

/// A single transient notification.
#[derive(Debug, Clone, PartialEq)]
pub struct Toast {
    pub id: String,
    pub level: ToastLevel,
    pub message: String,
    pub created_at: Instant,
    pub ttl_ms: u64,
}

/// Root signal carrying the FIFO toast queue.
pub static TOAST_QUEUE: GlobalSignal<VecDeque<Toast>> = Signal::global(VecDeque::new);

/// Enqueue a toast at the back of the queue.
pub fn push(toast: Toast) {
    TOAST_QUEUE.write().push_back(toast);
}

/// Remove the toast with `id`, if present.
pub fn remove(id: &str) {
    TOAST_QUEUE.write().retain(|t| t.id != id);
}

/// Drop every toast whose `created_at + ttl_ms` has elapsed.
pub fn sweep_expired() {
    let now = Instant::now();
    TOAST_QUEUE
        .write()
        .retain(|t| now.saturating_duration_since(t.created_at).as_millis() < t.ttl_ms as u128);
}
