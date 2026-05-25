//! Left pane slot (grid-area: left). Placeholder until W3.A.4 wires the
//! ObjectivePane.

use dioxus::prelude::*;

#[component]
pub fn LeftPane() -> Element {
    rsx! {
        div { class: "left", "data-testid": "layout-left", "left pane" }
    }
}
