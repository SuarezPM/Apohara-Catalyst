//! Top bar slot (grid-area: top). Placeholder until W3.A wires HeroBanner /
//! ViewToggle / ProviderRoster into it.

use dioxus::prelude::*;

#[component]
pub fn TopBar() -> Element {
    rsx! {
        div { class: "top", "data-testid": "layout-top", "Apohara — top bar" }
    }
}
