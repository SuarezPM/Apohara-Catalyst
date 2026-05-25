//! The 3-pane shell composition.
//!
//! CSS grid (`.apohara-grid`, see `assets/brand.css`) with areas
//! `"top top top" / "left center right" / "bottom bottom bottom"`. Each slot is
//! its own `#[component]` so later waves swap a slot's contents without
//! touching this composition.

use dioxus::prelude::*;

use super::{BottomBar, CenterPane, LeftPane, RightPane, TopBar};

#[component]
pub fn MainLayout() -> Element {
    rsx! {
        div { class: "apohara-grid", "data-testid": "main-layout",
            TopBar {}
            LeftPane {}
            CenterPane {}
            RightPane {}
            BottomBar {}
        }
    }
}
