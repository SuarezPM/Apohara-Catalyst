//! ObjectivePane — Wave B (G2.C.3.4) stub. Real impl follows TDD in this task.

use dioxus::prelude::*;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ObjectiveMode {
    Gpu,
    Cloud,
}

#[component]
pub fn ObjectivePane(
    active: bool,
    mode: ObjectiveMode,
    roster_csv: String,
) -> Element {
    let _ = (active, mode, roster_csv);
    rsx! { div { class: "objective-pane-stub" } }
}
