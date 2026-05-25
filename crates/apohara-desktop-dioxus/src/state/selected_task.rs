//! Selected task id — drives the detail panes (CodeDiff, Terminal filter).
//!
//! NEW signal (Sprint 23). No TS antecedent: the TS desktop tracked selection
//! inside React component state. The Dioxus shell promotes it to a
//! `GlobalSignal` so SwarmCanvas / KanbanBoard / TaskBoard / TerminalPane all
//! read one source of truth.

use dioxus::prelude::*;

/// Currently-selected task id, or `None` when nothing is selected.
pub static SELECTED_TASK: GlobalSignal<Option<String>> = Signal::global(|| None);

/// Select a task by id.
pub fn select(id: impl Into<String>) {
    *SELECTED_TASK.write() = Some(id.into());
}

/// Clear the current selection.
pub fn clear() {
    *SELECTED_TASK.write() = None;
}

/// Read the current selection (cloned).
pub fn selected() -> Option<String> {
    SELECTED_TASK.read().clone()
}
