//! Bottom bar slot (grid-area: bottom). Placeholder until W3.D.4 wires the
//! Statusline.

use dioxus::prelude::*;

#[component]
pub fn BottomBar() -> Element {
    rsx! {
        div { class: "bottom", "data-testid": "layout-bottom", "bottom bar" }
    }
}
