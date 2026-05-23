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
