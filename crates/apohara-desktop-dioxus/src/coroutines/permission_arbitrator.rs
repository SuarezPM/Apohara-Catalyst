//! `permission_arbitrator` coroutine — resolves the `PERMISSIONS` queue one at a
//! time (W4.2).
//!
//! In v1.0 (happy-path) every prompt is resolved through the user-facing
//! PermissionDialogOverlay: it shows the head unresolved request and records the
//! Allow/Deny on click (that decision flow is covered by `overlays_test`). This
//! coroutine is the structural owner of that flow; the auto-check ceremony
//! (`safety::permission_service::check` against a PermissionCache +
//! MergedSettings) is deferred to v1.1, since the desktop does not yet wire a
//! settings/cache context. The loop is a heartbeat until that lands.

use dioxus::prelude::*;
use std::time::Duration;

/// Mount the coroutine. Self-driven heartbeat for now.
pub fn mount() {
    let _ = use_coroutine(|mut _rx: UnboundedReceiver<()>| async move {
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}
