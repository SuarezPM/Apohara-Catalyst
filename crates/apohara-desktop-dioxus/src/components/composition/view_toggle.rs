//! ViewToggle — Wave B (G2.C.3.2) stub. Real impl follows TDD in this task.

use dioxus::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewMode {
    Graph,
    Board,
    Terminal,
}

#[component]
pub fn ViewToggle(current: ViewMode) -> Element {
    let _ = current;
    rsx! { div { class: "view-toggle-stub" } }
}
