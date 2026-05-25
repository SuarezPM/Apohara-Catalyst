//! Center pane slot (grid-area: center). Swaps between the three task views by
//! VIEW_MODE: Graph -> SwarmCanvas, Board -> KanbanBoard, Terminal -> TaskBoard
//! (W3.B). Each view is fed from the single TASKS signal (mapped to the view's
//! own local type) and reports node/row clicks back to SELECTED_TASK.

use dioxus::prelude::*;

use crate::components::hard::swarm_canvas::{SwarmEdge, SwarmTask};
use crate::components::hard::SwarmCanvas;
use crate::components::layout::task_board::{self, TaskBoard};
use crate::components::{KanbanBoard, KanbanTask, KanbanTaskStatus};
use crate::state::selected_task;
use crate::state::sse_events::{recent_events, SseEvent};
use crate::state::tasks::{DagTask, TaskStatus, TASKS};
use crate::state::view_mode::{ViewMode, VIEW_MODE};

/// Select a task by id. The three center views fire this on a node/row click
/// (their `on_select`); kept a free fn so the wiring is unit-testable.
pub(crate) fn select_task(id: String) {
    selected_task::select(id);
}

/// Filter the SSE event tape for the TerminalPane drawer. When a task is
/// selected, keep only events whose payload mentions its id — `SseEvent` has no
/// `task_id` field, so this is a best-effort substring match (W3.C.3 decision).
/// With no selection the full tape is shown.
pub(crate) fn events_for_selection(selected: Option<String>, events: &[SseEvent]) -> Vec<SseEvent> {
    match selected {
        Some(id) => events
            .iter()
            .filter(|e| e.payload.contains(&id))
            .cloned()
            .collect(),
        None => events.to_vec(),
    }
}

/// Apply a kanban drag-drop. Placeholder until W4: `dispatch::state` exposes no
/// mutating transition fn yet, and the HTML5 dataTransfer payload (the real
/// task id) is not wired, so the drop is a no-op for now (W3.B.3 decision).
pub(crate) fn move_task(_payload: (String, KanbanTaskStatus)) {}

/// Map a `state::tasks::TaskStatus` onto the SwarmCanvas free-form CSS state.
fn swarm_state(status: TaskStatus) -> &'static str {
    match status {
        TaskStatus::Pending | TaskStatus::Ready | TaskStatus::Blocked => "scheduled",
        TaskStatus::Dispatched | TaskStatus::InVerification => "running",
        TaskStatus::Done => "completed",
        TaskStatus::Failed => "failed",
    }
}

/// Project TASKS onto SwarmCanvas nodes + dependency edges. Edges come from
/// `waiting_for_task_id` (the only dependency field on the UI DagTask).
fn to_swarm(tasks: &[DagTask]) -> (Vec<SwarmTask>, Vec<SwarmEdge>) {
    let nodes = tasks
        .iter()
        .map(|t| SwarmTask {
            id: t.id.clone(),
            label: t.title.clone(),
            state: swarm_state(t.status).to_string(),
        })
        .collect();
    let edges = tasks
        .iter()
        .filter_map(|t| {
            t.waiting_for_task_id.as_ref().map(|from| SwarmEdge {
                from: from.clone(),
                to: t.id.clone(),
            })
        })
        .collect();
    (nodes, edges)
}

/// Map a `state::tasks::TaskStatus` onto the 5-lane kanban status.
fn kanban_status(status: TaskStatus) -> KanbanTaskStatus {
    match status {
        TaskStatus::Pending | TaskStatus::Blocked => KanbanTaskStatus::Pending,
        TaskStatus::Ready => KanbanTaskStatus::Ready,
        TaskStatus::Dispatched => KanbanTaskStatus::InProgress,
        TaskStatus::InVerification => KanbanTaskStatus::Verifying,
        TaskStatus::Done | TaskStatus::Failed => KanbanTaskStatus::Done,
    }
}

fn to_kanban(tasks: &[DagTask]) -> Vec<KanbanTask> {
    tasks
        .iter()
        .map(|t| KanbanTask {
            id: t.id.clone(),
            title: t.title.clone(),
            status: kanban_status(t.status),
        })
        .collect()
}

/// Map a `state::tasks::TaskStatus` onto the 4-column TaskBoard status. The MVP
/// board has no Dispatched/Failed/Blocked columns, so they fold into the
/// nearest visible one (Dispatched->Ready, Blocked->Pending, Failed->Done).
fn taskboard_status(status: TaskStatus) -> task_board::TaskStatus {
    match status {
        TaskStatus::Pending | TaskStatus::Blocked => task_board::TaskStatus::Pending,
        TaskStatus::Ready | TaskStatus::Dispatched => task_board::TaskStatus::Ready,
        TaskStatus::InVerification => task_board::TaskStatus::InVerification,
        TaskStatus::Done | TaskStatus::Failed => task_board::TaskStatus::Done,
    }
}

fn to_taskboard(tasks: &[DagTask]) -> Vec<task_board::DagTask> {
    tasks
        .iter()
        .map(|t| task_board::DagTask {
            id: t.id.clone(),
            title: t.title.clone(),
            status: taskboard_status(t.status),
        })
        .collect()
}

#[component]
pub fn CenterPane() -> Element {
    let tasks: Vec<DagTask> = TASKS.read().values().cloned().collect();
    let mode = *VIEW_MODE.read();

    // TerminalPane drawer state: collapsible, default closed (W3.C.3).
    let drawer_open = use_signal(|| false);
    let open = *drawer_open.read();
    let drawer_class = if open {
        "terminal-drawer terminal-drawer--open"
    } else {
        "terminal-drawer"
    };
    let open_attr = if open { "true" } else { "false" };
    let events = events_for_selection(selected_task::selected(), &recent_events());

    rsx! {
        div { class: "center", "data-testid": "layout-center",
            {
                match mode {
                    ViewMode::Graph => {
                        let (nodes, edges) = to_swarm(&tasks);
                        rsx! { SwarmCanvas { tasks: nodes, edges, on_select: select_task } }
                    }
                    ViewMode::Board => {
                        let kanban = to_kanban(&tasks);
                        rsx! { KanbanBoard { tasks: kanban, on_move: move_task } }
                    }
                    ViewMode::Terminal => {
                        let board = to_taskboard(&tasks);
                        rsx! { TaskBoard { tasks: board, on_select: select_task } }
                    }
                }
            }
            div {
                class: "{drawer_class}",
                "data-testid": "terminal-drawer",
                "data-open": "{open_attr}",
                header {
                    class: "terminal-drawer-header",
                    "data-testid": "terminal-drawer-toggle",
                    onclick: move |_| {
                        let next = !*drawer_open.read();
                        drawer_open.clone().set(next);
                    },
                    "Terminal"
                }
                div {
                    class: "terminal-drawer-body",
                    for ev in events {
                        div {
                            class: "terminal-event",
                            "data-event-kind": "{ev.kind}",
                            "{ev.payload}"
                        }
                    }
                }
            }
        }
    }
}
