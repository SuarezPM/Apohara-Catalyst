//! Badge — small inline status / tag chip.
//!
//! There is no direct React precedent in `packages/desktop/src/components/ui/`;
//! the upstream React tree used ad-hoc `<span>` chips inline. We add a
//! first-class component here so Wave B layouts (TaskBoard lanes, provider
//! roster status) can opt into a single canonical chip and the brand CSS
//! has one well-known selector to target.
//!
//! Tones:
//!   - `default` (lime / ink, the brand mark — used when `tone` is unset)
//!   - any caller-supplied string → class `badge-<tone>` (warn, danger,
//!     muted are reserved by the CSS but the component is permissive).
//!
//! `announce` flips the badge to `role="status"` so screen readers
//! announce live updates (e.g. when a task transitions to ready).

use dioxus::prelude::*;

#[component]
pub fn Badge(
    children: Element,
    /// Optional tone variant, appended as `badge-<tone>`.
    #[props(default)]
    tone: String,
    /// When true, the badge becomes a live region (`role="status"`).
    #[props(default = false)]
    announce: bool,
) -> Element {
    let class = if tone.is_empty() {
        "badge".to_string()
    } else {
        format!("badge badge-{tone}")
    };

    rsx! {
        span {
            class: "{class}",
            role: if announce { "status" },
            {children}
        }
    }
}
