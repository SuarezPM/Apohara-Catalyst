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

// --- CenterPane view swap (W3.B.1 / B.2 / B.3 / B.4) ------------------

#[test]
fn center_pane_graph_mode_mounts_swarm_canvas() {
    use crate::state::tasks::{upsert_task, DagTask, TaskStatus};
    use crate::state::view_mode::{set_view_mode, ViewMode};
    #[allow(non_snake_case)]
    fn Harness() -> Element {
        use_hook(|| {
            set_view_mode(ViewMode::Graph);
            upsert_task(DagTask {
                id: "t1".into(),
                title: "build".into(),
                status: TaskStatus::Dispatched,
                ..Default::default()
            });
        });
        rsx! { super::CenterPane {} }
    }
    let mut vdom = VirtualDom::new(Harness);
    vdom.rebuild_in_place();
    let html = dioxus_ssr::render(&vdom);
    assert!(
        html.contains("data-testid=\"swarm-canvas\""),
        "swarm canvas missing in Graph mode: {html}"
    );
    assert!(
        html.contains("data-task-id=\"t1\""),
        "task node missing: {html}"
    );
}

#[test]
fn center_pane_board_mode_mounts_kanban_with_four_lanes_grouped() {
    use crate::state::tasks::{upsert_task, DagTask, TaskStatus};
    use crate::state::view_mode::{set_view_mode, ViewMode};
    #[allow(non_snake_case)]
    fn Harness() -> Element {
        use_hook(|| {
            set_view_mode(ViewMode::Board);
            upsert_task(DagTask {
                id: "r1".into(),
                title: "ready task".into(),
                status: TaskStatus::Ready,
                ..Default::default()
            });
            upsert_task(DagTask {
                id: "d1".into(),
                title: "done task".into(),
                status: TaskStatus::Done,
                ..Default::default()
            });
        });
        rsx! { super::CenterPane {} }
    }
    let mut vdom = VirtualDom::new(Harness);
    vdom.rebuild_in_place();
    let html = dioxus_ssr::render(&vdom);
    assert!(
        html.contains("data-testid=\"kanban-board\""),
        "kanban board missing in Board mode: {html}"
    );
    for lane in [
        "kanban-lane-ready",
        "kanban-lane-in-progress",
        "kanban-lane-verifying",
        "kanban-lane-done",
    ] {
        assert!(html.contains(lane), "lane {lane} missing: {html}");
    }
    assert!(html.contains("kanban-card-r1"), "ready card missing: {html}");
    assert!(html.contains("kanban-card-d1"), "done card missing: {html}");
}

#[test]
fn center_pane_terminal_mode_mounts_task_board() {
    use crate::state::tasks::{upsert_task, DagTask, TaskStatus};
    use crate::state::view_mode::{set_view_mode, ViewMode};
    #[allow(non_snake_case)]
    fn Harness() -> Element {
        use_hook(|| {
            set_view_mode(ViewMode::Terminal);
            upsert_task(DagTask {
                id: "t9".into(),
                title: "flat row".into(),
                status: TaskStatus::Ready,
                ..Default::default()
            });
        });
        rsx! { super::CenterPane {} }
    }
    let mut vdom = VirtualDom::new(Harness);
    vdom.rebuild_in_place();
    let html = dioxus_ssr::render(&vdom);
    assert!(
        html.contains("data-testid=\"task-board\""),
        "task board missing in Terminal mode: {html}"
    );
    assert!(html.contains("task-card-t9"), "task card missing: {html}");
}

#[test]
fn select_task_writes_selected_task_signal() {
    use crate::state::selected_task::SELECTED_TASK;
    // `select_task` is what SwarmCanvas/TaskBoard fire via `on_select` on click.
    with_runtime(|| {
        super::center_pane::select_task("t1".to_string());
        assert_eq!(*SELECTED_TASK.read(), Some("t1".to_string()));
    });
}

// --- RightPane / CodeDiff (W3.C.1, W3.C.2) ----------------------------

#[test]
fn right_pane_empty_state_when_no_diff() {
    let html = dioxus_ssr::render_element(rsx! { super::RightPane {} });
    assert!(
        html.contains("data-testid=\"code-diff-empty\""),
        "empty-state missing: {html}"
    );
    assert!(html.contains("No diff yet"), "empty-state text missing: {html}");
}

#[test]
fn right_pane_renders_diff_when_present() {
    use crate::state::code_diff::{set, Diff};
    #[allow(non_snake_case)]
    fn Harness() -> Element {
        use_hook(|| {
            set(Diff {
                unified: "--- a/foo.rs\n+++ b/foo.rs\n-old line\n+new line\n unchanged\n".into(),
                files_changed: vec!["foo.rs".into()],
                provider_winner: "claude-code-cli".into(),
            })
        });
        rsx! { super::RightPane {} }
    }
    let mut vdom = VirtualDom::new(Harness);
    vdom.rebuild_in_place();
    let html = dioxus_ssr::render(&vdom);
    assert!(
        html.contains("data-testid=\"code-diff-pane\""),
        "diff pane missing: {html}"
    );
    assert!(
        html.contains("claude-code-cli"),
        "provider_winner badge missing: {html}"
    );
    assert!(html.contains("foo.rs"), "files_changed missing: {html}");
    assert!(html.contains("diff-added"), "added line class missing: {html}");
    assert!(
        html.contains("diff-removed"),
        "removed line class missing: {html}"
    );
}

#[test]
fn reject_diff_clears_code_diff_signal() {
    use crate::state::code_diff::{set, Diff, CODE_DIFF};
    with_runtime(|| {
        set(Diff {
            unified: "x".into(),
            files_changed: vec![],
            provider_winner: "p".into(),
        });
        assert!(CODE_DIFF.read().is_some());
        super::right_pane::reject_diff();
        assert!(CODE_DIFF.read().is_none());
    });
}

// --- TerminalPane drawer (W3.C.3) -------------------------------------

#[test]
fn events_for_selection_filters_by_payload_contains_id() {
    use crate::state::sse_events::SseEvent;
    let events = vec![
        SseEvent {
            kind: "state-patch".into(),
            payload: "{\"task\":\"t1\"}".into(),
            ts: 1,
        },
        SseEvent {
            kind: "state-patch".into(),
            payload: "{\"task\":\"t2\"}".into(),
            ts: 2,
        },
    ];
    let only_t1 = super::center_pane::events_for_selection(Some("t1".to_string()), &events);
    assert_eq!(only_t1.len(), 1, "expected only the t1 event");
    assert_eq!(only_t1[0].ts, 1);
    let all = super::center_pane::events_for_selection(None, &events);
    assert_eq!(all.len(), 2, "no selection should show the full tape");
}

#[test]
fn center_pane_mounts_terminal_drawer_closed_by_default() {
    use crate::state::view_mode::{set_view_mode, ViewMode};
    #[allow(non_snake_case)]
    fn Harness() -> Element {
        use_hook(|| set_view_mode(ViewMode::Graph));
        rsx! { super::CenterPane {} }
    }
    let mut vdom = VirtualDom::new(Harness);
    vdom.rebuild_in_place();
    let html = dioxus_ssr::render(&vdom);
    assert!(
        html.contains("data-testid=\"terminal-drawer\""),
        "terminal drawer missing: {html}"
    );
    assert!(
        html.contains("data-open=\"false\""),
        "drawer should default to closed: {html}"
    );
}
