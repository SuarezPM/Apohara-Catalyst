//! KanbanBoard — Apohara Catalyst kanban-with-DnD surface (G2.C.3.1).
//!
//! Direct port of `packages/desktop/src/components/KanbanBoard.tsx`. The
//! React original relied on `@hello-pangea/dnd` for drag-and-drop. This
//! port uses the HTML5 native DnD API (`draggable` / `ondragstart` /
//! `ondragover` / `ondrop`) so we avoid a heavy DnD framework dependency
//! and stay 1:1 with what the browser already provides.
//!
//! Scope per Sprint 18 Wave B:
//!   - The component renders four lanes (Ready / In Progress / Verifying /
//!     Done) matching the COLUMNS definition in the React source.
//!   - Cards are `draggable="true"` with `data-task-id` so the drop handler
//!     can identify which card was moved by reading the dragged element's
//!     attributes (kept stateless until the state cutover lands).
//!   - Tasks are accepted as a `Vec<KanbanTask>` prop. Implementer 1
//!     publishes `state::tasks::TASKS` in this sprint; the wrapper that
//!     binds the signal to this component lives in the App composition step
//!     (G2.C.5) so this file stays headlessly testable through `dioxus-ssr`.
//!   - `on_move` is an optional callback fired with `(task_id, new_status)`
//!     when a drop succeeds. The Wave B body does not invoke it because the
//!     stateless SSR tests cannot exercise drag interactions; the wiring is
//!     in place so the App-level integration test in Sprint 19 can verify it.
//!
//! Status lane mapping intentionally collapses the React `pending` /
//! `dispatched` / `blocked` / `failed` rows into the four visible lanes so
//! the kanban surface stays scannable. Full lane fidelity remains on the
//! TaskBoard (`crate::components::layout::TaskBoard`).

use dioxus::prelude::*;

/// Status lanes surfaced by the kanban view.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum KanbanTaskStatus {
    Pending,
    Ready,
    InProgress,
    Verifying,
    Done,
}

impl KanbanTaskStatus {
    /// Lane key used by the App-level wrapper to project a board status
    /// back to the `state::tasks::TaskStatus` enum during a drop. Kept
    /// public so Sprint 19 can wire it without re-deriving the strings.
    pub fn key(self) -> &'static str {
        match self {
            KanbanTaskStatus::Pending => "pending",
            KanbanTaskStatus::Ready => "ready",
            KanbanTaskStatus::InProgress => "in-progress",
            KanbanTaskStatus::Verifying => "verifying",
            KanbanTaskStatus::Done => "done",
        }
    }
}

/// Wire-level row consumed by the board.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KanbanTask {
    pub id: String,
    pub title: String,
    pub status: KanbanTaskStatus,
}

/// Lane definition: the visible status (drop target), the lane key for
/// `data-status`, the visible label, and the set of `KanbanTaskStatus`
/// values that bucket into this lane.
struct Lane {
    key: &'static str,
    label: &'static str,
    target: KanbanTaskStatus,
    members: &'static [KanbanTaskStatus],
}

const LANES: &[Lane] = &[
    Lane {
        key: "ready",
        label: "Ready",
        target: KanbanTaskStatus::Ready,
        members: &[KanbanTaskStatus::Pending, KanbanTaskStatus::Ready],
    },
    Lane {
        key: "in-progress",
        label: "In Progress",
        target: KanbanTaskStatus::InProgress,
        members: &[KanbanTaskStatus::InProgress],
    },
    Lane {
        key: "verifying",
        label: "Verifying",
        target: KanbanTaskStatus::Verifying,
        members: &[KanbanTaskStatus::Verifying],
    },
    Lane {
        key: "done",
        label: "Done",
        target: KanbanTaskStatus::Done,
        members: &[KanbanTaskStatus::Done],
    },
];

#[component]
pub fn KanbanBoard(
    /// Task list rendered into the lanes.
    tasks: Vec<KanbanTask>,
    /// Optional callback fired with `(task_id, new_status)` on a successful
    /// drop. Left unconnected by the SSR tests; the App-level integration
    /// hooks it to `state::tasks::upsert_task`.
    on_move: Option<EventHandler<(String, KanbanTaskStatus)>>,
) -> Element {
    rsx! {
        div {
            class: "kanban-board",
            "data-testid": "kanban-board",
            for lane in LANES.iter() {
                {
                    let bucket: Vec<KanbanTask> = tasks
                        .iter()
                        .filter(|t| lane.members.contains(&t.status))
                        .cloned()
                        .collect();
                    let lane_key = lane.key;
                    let lane_label = lane.label;
                    let target = lane.target;
                    let target_for_drop = target;
                    let handler_for_lane = on_move;
                    rsx! {
                        section {
                            class: "kanban-column",
                            "data-status": "{lane_key}",
                            "data-testid": "kanban-lane-{lane_key}",
                            "aria-label": "{lane_label}",
                            ondragover: move |evt| evt.prevent_default(),
                            ondrop: move |evt| {
                                evt.prevent_default();
                                if let Some(handler) = &handler_for_lane {
                                    // The actual task id is read by the App-level
                                    // wrapper from `evt.data().data_transfer()`
                                    // once Sprint 19 wires the real DnD payload.
                                    // For now we forward the lane target so the
                                    // wrapper can resolve the source task id.
                                    handler.call((String::new(), target_for_drop));
                                }
                            },
                            header {
                                class: "kanban-column-header",
                                h3 {
                                    class: "press-start-2p kanban-column-title",
                                    "{lane_label}"
                                }
                            }
                            div {
                                class: "kanban-column-body",
                                for task in bucket {
                                    KanbanCard { task, lane_key }
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
fn KanbanCard(task: KanbanTask, lane_key: &'static str) -> Element {
    let id = task.id.clone();
    let testid = format!("kanban-card-{id}");
    let id_for_drag = id.clone();
    rsx! {
        article {
            class: "card kanban-task",
            draggable: "true",
            "data-testid": "{testid}",
            "data-task-id": "{id}",
            "data-lane": "{lane_key}",
            ondragstart: move |_evt| {
                // The HTML5 dataTransfer write happens at the host layer;
                // this attribute-driven approach keeps the SSR tree pure
                // and is enough for Sprint 18's headless tests. The App
                // wrapper in Sprint 19 will call
                // `evt.data().data_transfer().set_data("text/plain", id)`.
                let _ = &id_for_drag;
            },
            p { class: "kanban-task-title", "{task.title}" }
            small { class: "kanban-task-id", "#{id}" }
        }
    }
}
