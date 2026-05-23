//! Card — port of `packages/desktop/src/components/ui/Card.tsx`.
//!
//! The React original was a thin `<div>` with brand styling and a style
//! prop for caller overrides. Dioxus does not expose an ergonomic way to
//! spread arbitrary HTML attributes, so we surface two narrow knobs:
//!   - `extra_class`: appended to the base `card` class so callers can
//!     opt into layout variants (e.g. `card task`, `card column-card`).
//!   - `testid`: optional `data-testid` for Sprint 18 component tests.
//!
//! Anything richer (e.g. inline style overrides) should be added as a
//! prop on demand rather than via a spread.

use dioxus::prelude::*;

#[component]
pub fn Card(
    children: Element,
    /// Extra class appended after `card` (space separated).
    #[props(default)]
    extra_class: String,
    /// Optional `data-testid` attribute.
    #[props(default)]
    testid: String,
) -> Element {
    let class = if extra_class.is_empty() {
        "card".to_string()
    } else {
        format!("card {extra_class}")
    };

    rsx! {
        div {
            class: "{class}",
            "data-testid": "{testid}",
            {children}
        }
    }
}
