//! `reconciler_tick` coroutine — every 30s runs the dispatch reconciler and
//! toasts any affected tasks. The real `run_reconciler_passes` wiring lands in
//! W4.5.

use dioxus::prelude::*;
use std::time::Duration;

/// Mount the coroutine. Self-driven on a 30s timer.
pub fn mount() {
    let _ = use_coroutine(|mut _rx: UnboundedReceiver<()>| async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            // Real reconciler pass + toast land in W4.5.
        }
    });
}
