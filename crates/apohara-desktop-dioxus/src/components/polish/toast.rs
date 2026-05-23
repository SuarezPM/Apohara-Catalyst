//! Toast — Sonner-style fixed-corner notification.
//!
//! Replaces the empty `ToastDialog` stub shipped in G2.B.4. This is the
//! single-toast renderer; the toast queue + auto-dismiss live in
//! Sprint 19 G2.D when the global toast feed signal lands. The
//! reference React app delegated to the `sonner` library, which
//! renders one `<li>` per toast inside a fixed container; we expose
//! the same shape.
//!
//! `kind` is a free-form string so callers (the queue) can pick the
//! brand variant — `success`, `error`, `info`, etc. The class
//! `toast-{kind}` lights up the matching border accent from
//! brand.css. ARIA pins `role="status"` + `aria-live="polite"` so
//! screen readers announce the message without stealing focus.

use dioxus::prelude::*;

#[component]
pub fn Toast(
    /// Plain-text message rendered inside the toast.
    message: String,
    /// Brand variant: `success`, `error`, `info`, etc. Drives the
    /// `toast-{kind}` modifier class.
    kind: String,
) -> Element {
    rsx! {
        div {
            class: "toast toast-{kind}",
            "data-testid": "toast",
            "data-kind": "{kind}",
            role: "status",
            "aria-live": "polite",
            "{message}"
        }
    }
}
