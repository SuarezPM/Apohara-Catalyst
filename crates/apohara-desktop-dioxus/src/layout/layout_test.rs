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

// --- TopBar / HeroBanner compact wiring (W3.A.1) ----------------------

/// Render `body` inside a fresh runtime after setting `RUNNING_STATUS` to
/// `status`. The set runs in `use_hook` (once, before children render) so the
/// signal is observed by the component under test in the same runtime.
fn render_with_status(status: crate::state::running_status::RunStatus) -> String {
    use crate::state::running_status::set_status;
    use dioxus::prelude::*;

    #[derive(Props, Clone, PartialEq)]
    struct HarnessProps {
        status: crate::state::running_status::RunStatus,
    }

    #[allow(non_snake_case)]
    fn Harness(props: HarnessProps) -> Element {
        use_hook(|| set_status(props.status));
        rsx! { super::TopBar {} }
    }

    let mut vdom = VirtualDom::new_with_props(Harness, HarnessProps { status });
    vdom.rebuild_in_place();
    dioxus_ssr::render(&vdom)
}

#[test]
fn hero_banner_compact_prop_renders_slim_header() {
    let html = dioxus_ssr::render_element(rsx! {
        crate::components::HeroBanner {
            compact: true,
            session_id: None,
            tasks_empty: true,
            tagline: "x".to_string(),
            on_seed_demo: None,
        }
    });
    assert!(
        html.contains("hero-banner-compact"),
        "compact strip missing: {html}"
    );
    assert!(
        !html.contains("hero-banner-tagline"),
        "compact should drop the tagline: {html}"
    );
}

#[test]
fn top_bar_full_hero_when_idle() {
    use crate::state::running_status::RunStatus;
    let html = render_with_status(RunStatus::Idle);
    assert!(
        html.contains("data-testid=\"hero-banner\""),
        "full banner missing when idle: {html}"
    );
    assert!(
        !html.contains("hero-banner-compact"),
        "should not be compact when idle: {html}"
    );
}

#[test]
fn top_bar_compact_when_dispatching() {
    use crate::state::running_status::RunStatus;
    let html = render_with_status(RunStatus::Dispatching);
    assert!(
        html.contains("hero-banner-compact"),
        "compact banner missing when dispatching: {html}"
    );
}
