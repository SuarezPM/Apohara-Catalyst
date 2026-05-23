//! SSR tests for composition components (G2.C.3).
//!
//! Each component lands one-by-one under TDD: a failing test goes in first,
//! the real impl replaces the stub, and the test flips green before commit.

#![allow(unused_imports)]

use super::{
    ContextLevel, KanbanBoard, KanbanTask, KanbanTaskStatus, ObjectiveMode, ObjectivePane,
    Statusline, StatuslineState, ViewMode, ViewToggle,
};
use dioxus::prelude::*;

// --- KanbanBoard (G2.C.3.1) -------------------------------------------

#[test]
fn kanban_board_renders_four_lanes_with_labels() {
    let html = dioxus_ssr::render_element(rsx! {
        KanbanBoard { tasks: Vec::<KanbanTask>::new() }
    });
    assert!(
        html.contains("data-testid=\"kanban-board\""),
        "kanban root missing testid: {html}"
    );
    assert!(html.contains("data-status=\"ready\""), "Ready lane missing");
    assert!(
        html.contains("data-status=\"in-progress\""),
        "In Progress lane missing"
    );
    assert!(
        html.contains("data-status=\"verifying\""),
        "Verifying lane missing"
    );
    assert!(html.contains("data-status=\"done\""), "Done lane missing");
    assert!(html.contains("Ready"), "Ready label missing");
    assert!(html.contains("In Progress"), "In Progress label missing");
    assert!(html.contains("Verifying"), "Verifying label missing");
    assert!(html.contains("Done"), "Done label missing");
}

#[test]
fn kanban_board_renders_draggable_cards_with_task_id_attr() {
    let tasks = vec![
        KanbanTask {
            id: "k1".into(),
            title: "Task K1".into(),
            status: KanbanTaskStatus::Ready,
        },
        KanbanTask {
            id: "k2".into(),
            title: "Task K2".into(),
            status: KanbanTaskStatus::Done,
        },
    ];
    let html = dioxus_ssr::render_element(rsx! {
        KanbanBoard { tasks }
    });
    assert!(html.contains("Task K1"), "k1 title missing: {html}");
    assert!(html.contains("Task K2"), "k2 title missing");
    assert!(
        html.contains("draggable=\"true\""),
        "draggable attribute missing: {html}"
    );
    assert!(
        html.contains("data-task-id=\"k1\""),
        "k1 data-task-id missing"
    );
    assert!(
        html.contains("data-task-id=\"k2\""),
        "k2 data-task-id missing"
    );
}

#[test]
fn kanban_board_groups_tasks_into_correct_lane() {
    let tasks = vec![
        KanbanTask {
            id: "ready-1".into(),
            title: "ready-task".into(),
            status: KanbanTaskStatus::Ready,
        },
        KanbanTask {
            id: "done-1".into(),
            title: "done-task".into(),
            status: KanbanTaskStatus::Done,
        },
    ];
    let html = dioxus_ssr::render_element(rsx! {
        KanbanBoard { tasks }
    });
    // Cards carry the lane key as a data attribute so a parent test can
    // confirm grouping without parsing the DOM structurally.
    assert!(
        html.contains("data-lane=\"ready\""),
        "ready-lane card marker missing"
    );
    assert!(
        html.contains("data-lane=\"done\""),
        "done-lane card marker missing"
    );
}

// --- ViewToggle (G2.C.3.2) --------------------------------------------

#[test]
fn view_toggle_renders_three_tabs() {
    let html = dioxus_ssr::render_element(rsx! {
        ViewToggle { current: ViewMode::Graph }
    });
    assert!(
        html.contains("data-testid=\"view-toggle\""),
        "root testid missing: {html}"
    );
    assert!(
        html.contains("data-testid=\"view-toggle-graph\""),
        "graph tab missing"
    );
    assert!(
        html.contains("data-testid=\"view-toggle-board\""),
        "board tab missing"
    );
    assert!(
        html.contains("data-testid=\"view-toggle-terminal\""),
        "terminal tab missing"
    );
    assert!(html.contains("Graph"), "Graph label missing");
    assert!(html.contains("Board"), "Board label missing");
    assert!(html.contains("Terminal"), "Terminal label missing");
}

#[test]
fn view_toggle_marks_current_tab_as_selected() {
    let html = dioxus_ssr::render_element(rsx! {
        ViewToggle { current: ViewMode::Board }
    });
    assert!(
        html.contains("aria-selected=\"true\""),
        "no aria-selected=true: {html}"
    );
    // The selected board tab carries data-active="true" so the App
    // composition can read it without relying on ARIA attributes alone.
    assert!(
        html.contains("data-testid=\"view-toggle-board\""),
        "board tab missing"
    );
    assert!(
        html.contains("data-active=\"true\""),
        "data-active=true missing for selected tab"
    );
}

#[test]
fn view_toggle_role_tablist_and_role_tab() {
    let html = dioxus_ssr::render_element(rsx! {
        ViewToggle { current: ViewMode::Terminal }
    });
    assert!(html.contains("role=\"tablist\""), "tablist role missing");
    assert!(html.contains("role=\"tab\""), "tab role missing");
}

// --- Statusline (G2.C.3.3) --------------------------------------------

fn default_status() -> StatuslineState {
    StatuslineState {
        session: None,
        tokens_used: 0,
        tokens_limit: 0,
        context_level: ContextLevel::Ok,
        active_tool_count: 0,
        last_hook: None,
        last_tool_latency_ms: None,
        banner_message: None,
    }
}

#[test]
fn statusline_renders_no_session_when_empty() {
    let html = dioxus_ssr::render_element(rsx! {
        Statusline { state: default_status() }
    });
    assert!(
        html.contains("data-testid=\"statusline\""),
        "root testid missing: {html}"
    );
    assert!(
        html.contains("data-testid=\"status-session\""),
        "session badge missing"
    );
    assert!(html.contains("no session"), "no-session text missing: {html}");
}

#[test]
fn statusline_renders_session_and_tokens_and_level() {
    let state = StatuslineState {
        session: Some("abcdef-123456".into()),
        tokens_used: 2_500,
        tokens_limit: 10_000,
        context_level: ContextLevel::Warning,
        active_tool_count: 3,
        last_hook: Some("PostToolUse".into()),
        last_tool_latency_ms: Some(42),
        banner_message: None,
    };
    let html = dioxus_ssr::render_element(rsx! {
        Statusline { state }
    });
    assert!(html.contains("abcdef-123456"), "session id missing: {html}");
    assert!(html.contains("2,500"), "tokens-used formatted missing: {html}");
    assert!(html.contains("10,000"), "tokens-limit formatted missing");
    assert!(
        html.contains("data-level=\"warning\""),
        "context-level data attr missing"
    );
    assert!(html.contains("WARNING"), "WARNING label missing");
    assert!(html.contains("3 active"), "tool count missing");
    assert!(html.contains("PostToolUse"), "last hook missing");
    assert!(html.contains("42ms"), "latency missing");
}

#[test]
fn statusline_renders_banner_when_present() {
    let mut state = default_status();
    state.banner_message = Some("Compaction imminent".into());
    let html = dioxus_ssr::render_element(rsx! {
        Statusline { state }
    });
    assert!(
        html.contains("data-testid=\"status-banner\""),
        "banner testid missing"
    );
    assert!(html.contains("Compaction imminent"), "banner text missing");
}

#[test]
fn statusline_omits_banner_when_absent() {
    let html = dioxus_ssr::render_element(rsx! {
        Statusline { state: default_status() }
    });
    assert!(
        !html.contains("data-testid=\"status-banner\""),
        "banner testid should not render when message is None: {html}"
    );
}

// --- ObjectivePane (G2.C.3.4) -----------------------------------------

#[test]
fn objective_pane_renders_title_input_and_buttons() {
    let html = dioxus_ssr::render_element(rsx! {
        ObjectivePane {
            active: false,
            mode: ObjectiveMode::Gpu,
            roster_csv: "claude-code-cli,codex-cli".to_string(),
        }
    });
    assert!(
        html.contains("data-testid=\"objective-pane\""),
        "root testid missing: {html}"
    );
    assert!(html.contains("Objective"), "Objective title missing");
    assert!(
        html.contains("data-testid=\"objective-input\""),
        "textarea testid missing"
    );
    assert!(
        html.contains("data-testid=\"objective-enhance\""),
        "enhance button missing"
    );
    assert!(
        html.contains("data-testid=\"objective-run\""),
        "run button missing"
    );
    assert!(html.contains("Enhance"), "Enhance label missing");
    assert!(html.contains("Run"), "Run label missing");
}

#[test]
fn objective_pane_disables_inputs_when_active() {
    let html = dioxus_ssr::render_element(rsx! {
        ObjectivePane {
            active: true,
            mode: ObjectiveMode::Cloud,
            roster_csv: String::new(),
        }
    });
    // textarea + both buttons should be disabled when a session is active.
    assert!(
        html.contains("disabled"),
        "disabled attribute missing on active pane: {html}"
    );
    assert!(
        html.contains("data-active=\"true\""),
        "data-active marker missing on root when active"
    );
}

#[test]
fn objective_pane_exposes_mode_attribute() {
    let html_gpu = dioxus_ssr::render_element(rsx! {
        ObjectivePane {
            active: false,
            mode: ObjectiveMode::Gpu,
            roster_csv: String::new(),
        }
    });
    let html_cloud = dioxus_ssr::render_element(rsx! {
        ObjectivePane {
            active: false,
            mode: ObjectiveMode::Cloud,
            roster_csv: String::new(),
        }
    });
    assert!(
        html_gpu.contains("data-mode=\"gpu\""),
        "data-mode=gpu missing: {html_gpu}"
    );
    assert!(
        html_cloud.contains("data-mode=\"cloud\""),
        "data-mode=cloud missing: {html_cloud}"
    );
}
