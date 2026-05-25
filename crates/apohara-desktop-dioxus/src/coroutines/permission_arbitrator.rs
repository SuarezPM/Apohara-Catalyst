//! `permission_arbitrator` coroutine — drives one-at-a-time resolution of the
//! `PERMISSIONS` queue. The PermissionDialogOverlay already shows the head
//! request and records the user's Allow/Deny; the real auto-check ceremony
//! (safety::permission_service::check against settings) lands in W4.2.

use dioxus::prelude::*;
use futures_util::StreamExt;

/// Mount the coroutine. Self-driven (ignores its receiver) for now.
pub fn mount() {
    let _ = use_coroutine(|mut rx: UnboundedReceiver<()>| async move {
        while rx.next().await.is_some() {}
    });
}
