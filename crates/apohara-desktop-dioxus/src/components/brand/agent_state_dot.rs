//! AgentStateDot — pixel-art status indicator dot.
//!
//! Direct port of `packages/desktop/src/components/AgentStateDot.tsx`.
//! Maps a free-form `state` string ("idle" | "working" | "waiting" | "done"
//! | "error" or anything else) to one of the brand-token swatches defined
//! in `assets/brand.css`. The React original injects a `<style>` keyframe
//! at module load; here the keyframes (`agent-state-dot-pulse`) live in
//! `assets/brand.css` so SSR output stays deterministic and no document
//! mutation is required.
//!
//! Props match the React component shape:
//!   - `state` — required, one of the canonical values above.
//!   - `size` — `"sm"` (8px) or `"md"` (12px, default).
//!   - `label` — optional accessible label; falls back to `"agent <state>"`.
//!
//! SSR emits a single `<span>` carrying:
//!   - `data-state-dot` marker (parity with the React component, used by
//!     downstream tests / dom queries).
//!   - `data-state` for CSS attribute selectors and inspection.
//!   - `class="agent-dot dot-<state>"` so brand.css can theme each state.
//!   - inline `style` for size ONLY. Color + shape (round dot, cyan working
//!     spinner, magenta waiting pulse, lime done, danger error) live in
//!     `assets/brand.css` per the Apohara design system — the component no
//!     longer hard-codes a square solid swatch.

use dioxus::prelude::*;

/// Resolves the pixel size for the `size` prop. Defaults to 12px to match
/// React's `size = "md"` default.
fn size_px(size: Option<&str>) -> u16 {
    match size {
        Some("sm") => 8,
        _ => 12,
    }
}

#[component]
pub fn AgentStateDot(
    /// Logical agent state. Free-form so callers may pass attention bands
    /// or roster states without an enum dependency.
    state: String,
    /// Visual size — `"sm"` (8px) or `"md"` (12px, default).
    #[props(default)]
    size: Option<String>,
    /// Optional aria-label override.
    #[props(default)]
    label: Option<String>,
) -> Element {
    let px = size_px(size.as_deref());
    // Size only — brand.css owns color, radius, and per-state animation so the
    // design-system vocabulary (round dot / cyan spinner / magenta pulse) is in
    // one place. The size is inline so the dot still reserves space pre-CSS.
    let style = format!("width: {px}px; height: {px}px;");
    let aria_label = label.unwrap_or_else(|| format!("agent {state}"));

    rsx! {
        span {
            class: "agent-dot dot-{state}",
            "data-state-dot": "",
            "data-state": "{state}",
            role: "status",
            "aria-label": "{aria_label}",
            style: "{style}",
        }
    }
}
