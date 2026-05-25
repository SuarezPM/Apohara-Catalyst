//! Center pane slot (grid-area: center). Placeholder until W3.B wires the
//! Swarm / Kanban / TaskBoard views.

use dioxus::prelude::*;

#[component]
pub fn CenterPane() -> Element {
    rsx! {
        div { class: "center", "data-testid": "layout-center", "center pane" }
    }
}
