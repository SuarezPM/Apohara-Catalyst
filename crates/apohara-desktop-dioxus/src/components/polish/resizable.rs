//! Resizable — split-pane resizer with a vertical drag handle.
//!
//! Equivalent to `react-resizable-panels`'s single-panel mode: render
//! children inside a container whose width can be dragged by a thin
//! handle on the right edge. The React original tracked
//! `pointerdown` / `pointermove` / `pointerup` to update a `useState`
//! width; here we emit the initial width as an inline style + render
//! the handle markup. The actual drag math (signal updates) is
//! deferred to G2.D when the global pointer hook lands — same
//! pattern as the cmd+K keybind.
//!
//! Two reasons we render the initial width inline rather than via a
//! signal:
//!   1. SSR rendering can pin the layout deterministically without
//!      needing a hydration step.
//!   2. The drag math is browser-only; SSR has no pointer events.
//!
//! ARIA: the handle uses `role="separator"` with
//! `aria-orientation="vertical"`, the WAI-ARIA pattern for a
//! draggable splitter between two regions.

use dioxus::prelude::*;

#[component]
pub fn Resizable(
    /// Starting width in CSS pixels. Drag updates happen in the
    /// browser; SSR pins this value as the inline width.
    initial_width: u32,
    /// Pane contents.
    children: Element,
) -> Element {
    let style = format!("width: {initial_width}px");
    rsx! {
        div {
            class: "resizable-panel",
            "data-testid": "resizable-panel",
            style: "{style}",
            {children}
            div {
                class: "resizable-handle",
                "data-testid": "resizable-handle",
                role: "separator",
                "aria-orientation": "vertical",
                "aria-label": "Resize panel",
            }
        }
    }
}
