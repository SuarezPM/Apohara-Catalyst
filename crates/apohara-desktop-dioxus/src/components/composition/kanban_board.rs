//! KanbanBoard — Wave B (G2.C.3.1) stub. Real implementation lands in the
//! same task; this stub keeps the crate compiling while the failing test is
//! authored under TDD.

use dioxus::prelude::*;

/// Status lanes surfaced by the kanban view. Subset of the React
/// `TaskStatus` union; lanes that are not displayed in the kanban (e.g.
/// `dispatched` / `blocked` / `failed`) collapse to `InProgress` when the
/// store cutover lands.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum KanbanTaskStatus {
    Pending,
    Ready,
    InProgress,
    Verifying,
    Done,
}

/// Wire-level row consumed by the board. Mirrors the React `DagTask` shape
/// minus the fields the kanban does not render.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KanbanTask {
    pub id: String,
    pub title: String,
    pub status: KanbanTaskStatus,
}

#[component]
pub fn KanbanBoard(tasks: Vec<KanbanTask>) -> Element {
    let _ = tasks;
    rsx! { div { class: "kanban-board-stub" } }
}
