//! `toast_reaper` coroutine — every 5s evicts toasts past their
//! `created_at + ttl_ms` deadline (W4.6).

use dioxus::prelude::*;
use std::time::Duration;

use crate::state::toast_queue;

/// Mount the coroutine. Self-driven on a 5s timer.
pub fn mount() {
    let _ = use_coroutine(|mut _rx: UnboundedReceiver<()>| async move {
        loop {
            tokio::time::sleep(Duration::from_secs(5)).await;
            toast_queue::sweep_expired();
        }
    });
}
