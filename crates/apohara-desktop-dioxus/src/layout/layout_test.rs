//! SSR test for the 3-pane layout shell (W2.6).

use super::MainLayout;
use dioxus::prelude::*;

#[test]
fn main_layout_renders_grid_and_all_zones() {
    let html = dioxus_ssr::render_element(rsx! { MainLayout {} });
    assert!(
        html.contains("apohara-grid"),
        "grid container missing: {html}"
    );
    for zone in [
        "layout-top",
        "layout-left",
        "layout-center",
        "layout-right",
        "layout-bottom",
    ] {
        assert!(html.contains(zone), "zone {zone} missing: {html}");
    }
}
