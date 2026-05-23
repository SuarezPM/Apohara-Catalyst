//! RunningBorder — wraps `children` in a `<div>` that gets the
//! `.running-border` class while `active == true`.
//!
//! Direct port of `packages/desktop/src/components/RunningBorder.tsx`.
//! The animated gradient lives in `index.css` (now in `assets/brand.css`)
//! under `.running-border::before`; this component only toggles the class
//! based on the `active` flag, so the visual behaviour is identical to the
//! React original.
//!
//! Props:
//!   - `active` — when `true` the wrapper carries `class="running-border"`;
//!     when `false` the wrapper renders with no class attribute so DOM
//!     queries can distinguish the two states.
//!   - `children` — arbitrary Dioxus children rendered inside the wrapper.

use dioxus::prelude::*;

#[component]
pub fn RunningBorder(active: bool, children: Element) -> Element {
    if active {
        rsx! {
            div { class: "running-border", {children} }
        }
    } else {
        rsx! {
            div { {children} }
        }
    }
}
