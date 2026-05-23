//! Composition components — Sprint 18 Wave B (G2.C.3) ports.
//!
//! These four components glue the Wave A primitives / layout pieces into
//! the higher-level surfaces the desktop shell renders. They are still
//! render-from-props in this sprint: real `GlobalSignal` wiring lands once
//! Implementer 1 publishes `state::tasks` and `state::view_mode` in the
//! same sprint window.
//!
//! - `KanbanBoard` — DnD-capable kanban view. Uses HTML5 native drag-and-drop
//!   attributes (`draggable` / `ondragstart` / `ondragover` / `ondrop`)
//!   instead of `@hello-pangea/dnd`. The drop handler is wired to an
//!   optional `on_move` callback so the SSR tree stays headlessly testable.
//! - `ViewToggle` — chip-group that switches the desktop between Graph /
//!   Board / Terminal views. Mirrors `packages/desktop/src/components/ViewToggle.tsx`.
//! - `Statusline` — bottom footer with session / tokens / context level /
//!   tool count / last hook / optional banner. 1:1 of
//!   `packages/desktop/src/components/Statusline.tsx`.
//! - `ObjectivePane` — top-left sidebar prompting the user for the next
//!   objective. Stub Enhance/Run buttons mirror the React behaviour but
//!   defer the fetch wiring to the state cutover.

pub mod kanban_board;
pub mod objective_pane;
pub mod statusline;
pub mod view_toggle;

pub use kanban_board::{KanbanBoard, KanbanTask, KanbanTaskStatus};
pub use objective_pane::{ObjectiveMode, ObjectivePane};
pub use statusline::{ContextLevel, Statusline, StatuslineState};
pub use view_toggle::{ViewMode, ViewToggle};

#[cfg(test)]
mod composition_test;
