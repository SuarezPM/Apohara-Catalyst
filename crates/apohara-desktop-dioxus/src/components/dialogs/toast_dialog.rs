//! ToastDialog — Sonner-style toast container stub.
//!
//! This is a **placeholder** so dependents can wire the slot in Wave A.
//! Sprint 18 (G2.C) replaces the body with a real toast feed (subscribing
//! to a `GlobalSignal<VecDeque<Toast>>`) and per-toast severity styling.
//!
//! Intentionally renders an empty fixed container with `data-toast` so:
//!   - integration tests can assert the slot exists in the app shell,
//!   - the layout reserves the screen-corner gutter even before toasts
//!     start flowing, avoiding a content shift when G2.C lights up,
//!   - assistive tech can announce toast text once it lands
//!     (`aria-live="polite"`).
//!
//! No props yet — the real component will take a toast queue + handlers.

use dioxus::prelude::*;

#[component]
pub fn ToastDialog() -> Element {
    rsx! {
        div {
            class: "toast-container",
            "data-toast": "true",
            "data-testid": "toast-container",
            role: "status",
            "aria-live": "polite",
            "aria-atomic": "false",
            // Sprint 18: iterate the toast queue here.
        }
    }
}
