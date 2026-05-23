//! Layout components — Sprint 17 Wave A (G2.B.3) ports.
//!
//! MVP composition only. Drag-and-drop and GlobalSignal wiring land in
//! Sprint 18 (G2.C). Components accept their data as `Vec<...>` props so
//! they stay headlessly testable via `dioxus-ssr`.
//!
//! Sprint 17 Wave A G2.B.3 closure: `TaskBoard` (4-column kanban) and
//! `ProviderRoster` (active CLI trio with health badges) are landed as
//! render-from-props components. Both are covered by SSR tests in
//! `layout_test.rs`. The Sprint 18 (G2.C) follow-up wires `GlobalSignal`
//! state, drag-and-drop, and the remaining lane variants
//! (`dispatched` / `failed` / `blocked`).

pub mod provider_roster;
pub mod task_board;

pub use provider_roster::{ProviderHealth, ProviderRoster, ProviderStatus};
pub use task_board::{DagTask, TaskBoard, TaskStatus};

#[cfg(test)]
mod layout_test;
