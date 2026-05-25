//! Right pane slot (grid-area: right). Placeholder until W3.C wires the
//! CodeDiffPane.

use dioxus::prelude::*;

#[component]
pub fn RightPane() -> Element {
    rsx! {
        div { class: "right", "data-testid": "layout-right", "right pane" }
    }
}
