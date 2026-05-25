//! `reconciler_tick` coroutine — every 30s runs the dispatch reconciler and
//! toasts any affected tasks (W4.5).
//!
//! v1.0 uses a minimal `ReconcilerCtx` (no ledger wired yet), so a failed pass
//! is silently skipped — the real ledger/session context lands when the
//! orchestration store is wired into the desktop.

use dioxus::prelude::*;
use std::time::Duration;

use apohara_dispatch::reconciler::{run_reconciler_passes, ReconcilerCtx};

use crate::state::toast_queue::{self, Toast, ToastLevel};

/// Mount the coroutine. Self-driven on a 30s timer.
pub fn mount() {
    let _ = use_coroutine(|mut _rx: UnboundedReceiver<()>| async move {
        loop {
            tokio::time::sleep(Duration::from_secs(30)).await;
            tick();
        }
    });
}

/// One reconciler pass: run the dispatch reconciler and toast affected tasks.
pub(crate) fn tick() {
    if let Ok(result) = run_reconciler_passes(&default_ctx()) {
        if !result.total_affected.is_empty() {
            toast_queue::push(reconciler_toast(&result.total_affected));
        }
    }
}

fn default_ctx() -> ReconcilerCtx {
    ReconcilerCtx {
        ledger_path: String::new(),
        workspace: ".".into(),
        session_id: "desktop".into(),
        blocked_aging_ms: 300_000,
        stall_timeout_ms: 120_000,
    }
}

/// Build the toast announcing reconciler-affected tasks.
pub(crate) fn reconciler_toast(affected: &[String]) -> Toast {
    Toast {
        id: format!("reconciler-{}", affected.join("-")),
        level: ToastLevel::Info,
        message: format!("Reconciler updated {} task(s).", affected.len()),
        created_at: std::time::Instant::now(),
        ttl_ms: 5000,
    }
}
