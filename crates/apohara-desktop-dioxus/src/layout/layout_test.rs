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

// --- LeftPane / ProviderRoster wiring (W3.A.2) ------------------------

#[test]
fn left_pane_shows_install_empty_state_before_probe() {
    // The `use_future` probe defers past the SSR render, so ROSTER is empty and
    // the install empty-state shows.
    let html = dioxus_ssr::render_element(rsx! { super::LeftPane {} });
    assert!(
        html.contains("data-testid=\"provider-roster-empty\""),
        "empty-state missing: {html}"
    );
    assert!(
        html.contains("No providers found on PATH"),
        "empty-state text missing: {html}"
    );
    assert!(
        html.contains("data-testid=\"provider-roster-install\""),
        "install button missing: {html}"
    );
}

#[test]
fn left_pane_shows_roster_when_available_provider_present() {
    use crate::state::roster::{upsert_provider, ProviderEntry};

    #[allow(non_snake_case)]
    fn Harness() -> Element {
        use_hook(|| {
            upsert_provider(ProviderEntry {
                provider_id: "claude-code-cli".into(),
                display_name: "claude-code-cli".into(),
                roles: vec![],
                capabilities: vec![],
                permissions: vec![],
                mcp_servers: vec![],
                run_active: false,
                available: true,
            })
        });
        rsx! { super::LeftPane {} }
    }
    let mut vdom = VirtualDom::new(Harness);
    vdom.rebuild_in_place();
    let html = dioxus_ssr::render(&vdom);
    assert!(
        html.contains("data-testid=\"provider-roster\""),
        "roster missing when a provider is available: {html}"
    );
    assert!(
        html.contains("claude-code-cli"),
        "available provider id missing: {html}"
    );
}

// --- TopBar / ViewToggle wiring (W3.A.3) ------------------------------

/// Run `f` inside a Dioxus runtime so `GlobalSignal::read/write` work (mirrors
/// `state::state_test::with_runtime`). The root is an empty fragment; we only
/// need the runtime guard, never to render.
fn with_runtime<F: FnOnce()>(f: F) {
    fn empty() -> Element {
        rsx! {}
    }
    let vdom = VirtualDom::new(empty);
    vdom.in_runtime(f);
}

#[test]
fn top_bar_mounts_view_toggle() {
    let html = dioxus_ssr::render_element(rsx! { super::TopBar {} });
    assert!(
        html.contains("data-testid=\"view-toggle\""),
        "view toggle missing from top bar: {html}"
    );
}

#[test]
fn view_toggle_change_writes_view_mode_signal() {
    use crate::components::ViewMode as ToggleViewMode;
    use crate::state::view_mode::{ViewMode, VIEW_MODE};
    // `select_view` is exactly what the ViewToggle `on_change` fires on a tab
    // click; it maps the component-private enum onto the state signal.
    with_runtime(|| {
        super::top_bar::select_view(ToggleViewMode::Board);
        assert_eq!(*VIEW_MODE.read(), ViewMode::Board);
        super::top_bar::select_view(ToggleViewMode::Terminal);
        assert_eq!(*VIEW_MODE.read(), ViewMode::Terminal);
        super::top_bar::select_view(ToggleViewMode::Graph);
        assert_eq!(*VIEW_MODE.read(), ViewMode::Graph);
    });
}

// --- LeftPane / ObjectivePane wiring (W3.A.4) -------------------------

#[test]
fn left_pane_mounts_objective_pane_with_load_spec() {
    let html = dioxus_ssr::render_element(rsx! { super::LeftPane {} });
    assert!(
        html.contains("data-testid=\"objective-pane\""),
        "objective pane missing from left pane: {html}"
    );
    assert!(
        html.contains("data-testid=\"objective-load-spec\""),
        "Load SPEC button missing: {html}"
    );
}

#[test]
fn typing_objective_writes_objective_input_signal() {
    use crate::state::objective_input::OBJECTIVE_INPUT;
    // `set_objective` is the ObjectivePane `on_input` target: every keystroke
    // in the controlled textarea flows through here into OBJECTIVE_INPUT.
    with_runtime(|| {
        super::left_pane::set_objective("build a parser".to_string());
        assert_eq!(*OBJECTIVE_INPUT.read(), "build a parser");
    });
}

#[test]
fn run_objective_flips_status_to_dispatching() {
    use crate::state::running_status::{RunStatus, RUNNING_STATUS};
    with_runtime(|| {
        super::left_pane::run_objective("anything".to_string());
        assert_eq!(*RUNNING_STATUS.read(), RunStatus::Dispatching);
    });
}

#[test]
fn load_spec_decomposes_inline_spec_into_tasks() {
    use crate::state::tasks::TASKS;
    with_runtime(|| {
        super::left_pane::load_spec(
            "## Task t1: build the parser\n## Task t2: write tests\n- depends: t1\n".to_string(),
        );
        let tasks = TASKS.read();
        assert!(
            tasks.contains_key("t1"),
            "t1 missing: {:?}",
            tasks.keys().collect::<Vec<_>>()
        );
        assert!(tasks.contains_key("t2"), "t2 missing");
        assert_eq!(tasks.get("t1").unwrap().title, "build the parser");
    });
}
