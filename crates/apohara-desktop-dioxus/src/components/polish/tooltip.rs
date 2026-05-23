//! Tooltip — hover-driven label wrapper.
//!
//! Equivalent to Radix's `Tooltip` primitive: wrap any element with a
//! `<Tooltip label="…">` and a small popover appears on hover. The
//! React original used `@radix-ui/react-tooltip` for focus-trap and
//! pointer event coalescing; in Dioxus we rely on CSS `:hover` of
//! `.tooltip-wrapper` to toggle the inner `.tooltip` visibility.
//!
//! SSR rendering pins the surrounding markup (wrapper + label span)
//! so tests can verify the contract; the actual show/hide is
//! pure-CSS (driven by `:hover` / `:focus-within`). That keeps the
//! component allocation-free and avoids per-tooltip signals.
//!
//! `label` is plain text; rich tooltips are out of scope (Radix
//! supports MDX content but no consumer in Apohara has asked for
//! that).

use dioxus::prelude::*;

#[component]
pub fn Tooltip(
    /// Text shown inside the popover on hover.
    label: String,
    /// Trigger element(s) — typically a button or icon.
    children: Element,
) -> Element {
    rsx! {
        span {
            class: "tooltip-wrapper",
            "data-testid": "tooltip-wrapper",
            {children}
            span {
                class: "tooltip",
                role: "tooltip",
                "data-testid": "tooltip-label",
                "{label}"
            }
        }
    }
}
