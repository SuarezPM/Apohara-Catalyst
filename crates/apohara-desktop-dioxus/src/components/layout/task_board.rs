//! TaskBoard — Apohara Catalyst kanban view (MVP, G2.B.3).
//!
//! Direct port of `packages/desktop/src/components/TaskBoard/TaskBoard.tsx`.
//! This MVP renders four status columns (Pending / Ready / Verifying / Done)
//! and a card per task. Drag-and-drop, blocked / failed / dispatched lanes,
//! and live GlobalSignal wiring all land in Sprint 18 (G2.C); the React
//! original carries those on `TaskBoardLane` + `TaskBoardCard` and we will
//! port them when the store cutover lands.
//!
//! The component accepts a `Vec<DagTask>` prop so it stays headlessly
//! testable through `dioxus-ssr`. A future revision will replace this with
//! a `GlobalSignal<DagTaskMap>` subscription — see Sprint 18.

use dioxus::prelude::*;

/// Lifecycle states represented in the Wave A MVP board. Mirrors the
/// `pending` / `ready` / `in_verification` / `done` subset of the React
/// `TaskStatus` union from `packages/desktop/src/store/dagStore.ts`. The
/// remaining variants (`dispatched`, `failed`, `blocked`) land in G2.C
/// alongside drag-and-drop.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TaskStatus {
    Pending,
    Ready,
    InVerification,
    Done,
}

/// Single-task row consumed by the board. Wire-level subset of the React
/// `DagTask` shape — only the fields needed to render a Wave A card.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DagTask {
    pub id: String,
    pub title: String,
    pub status: TaskStatus,
}

#[component]
pub fn TaskBoard(
    tasks: Vec<DagTask>,
    /// Optional callback fired with a task id when its card is clicked. The
    /// CenterPane binds this to `SELECTED_TASK` (W3.B.4).
    on_select: Option<EventHandler<String>>,
) -> Element {
    let columns: [(TaskStatus, &str, &str); 4] = [
        (TaskStatus::Pending, "col-pending", "Pending"),
        (TaskStatus::Ready, "col-ready", "Ready"),
        (TaskStatus::InVerification, "col-in-verification", "Verifying"),
        (TaskStatus::Done, "col-done", "Done"),
    ];

    rsx! {
        div {
            class: "task-board",
            "data-testid": "task-board",
            for (status, class, label) in columns {
                {
                    let bucket: Vec<DagTask> = tasks
                        .iter()
                        .filter(|t| t.status == status)
                        .cloned()
                        .collect();
                    let count = bucket.len();
                    rsx! {
                        section {
                            class: "task-column {class}",
                            "data-testid": "{class}",
                            header {
                                class: "task-column-header",
                                h3 {
                                    class: "press-start-2p task-column-title",
                                    "{label} ({count})"
                                }
                            }
                            div {
                                class: "task-column-body",
                                for task in bucket {
                                    TaskCard { task, on_select }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[component]
fn TaskCard(task: DagTask, on_select: Option<EventHandler<String>>) -> Element {
    let testid = format!("task-card-{}", task.id);
    let id_for_click = task.id.clone();
    rsx! {
        article {
            class: "card task-card",
            "data-testid": "{testid}",
            onclick: move |_| {
                if let Some(h) = &on_select {
                    h.call(id_for_click.clone());
                }
            },
            p { class: "task-title", "{task.title}" }
            small { class: "task-id", "#{task.id}" }
        }
    }
}
