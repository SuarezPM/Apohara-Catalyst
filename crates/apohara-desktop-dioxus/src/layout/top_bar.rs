//! Top bar slot (grid-area: top). Hosts the HeroBanner — compact while a run is
//! active, full empty-state card when idle — plus the ViewToggle that swaps the
//! center pane between Graph / Board / Terminal views (W3.A.3).

use dioxus::prelude::*;

use crate::components::{HeroBanner, ViewMode as ToggleViewMode, ViewToggle};
use crate::state::running_status::{status, RunStatus};
use crate::state::view_mode::{set_view_mode, ViewMode, VIEW_MODE};

/// Write the active view onto `VIEW_MODE`. `ViewToggle` carries its own
/// component-private `ViewMode` enum (it predates the state signal), so this
/// maps that enum onto `state::view_mode::ViewMode` before writing. This is
/// exactly what the toggle's `on_change` fires on a tab click; it stays a free
/// fn so the two-enum mapping is unit-testable without a DOM event.
pub(crate) fn select_view(mode: ToggleViewMode) {
    let next = match mode {
        ToggleViewMode::Graph => ViewMode::Graph,
        ToggleViewMode::Board => ViewMode::Board,
        ToggleViewMode::Terminal => ViewMode::Terminal,
    };
    set_view_mode(next);
}

/// Project the `VIEW_MODE` signal onto the toggle's local enum for `current`.
fn current_toggle_mode() -> ToggleViewMode {
    match *VIEW_MODE.read() {
        ViewMode::Graph => ToggleViewMode::Graph,
        ViewMode::Board => ToggleViewMode::Board,
        ViewMode::Terminal => ToggleViewMode::Terminal,
    }
}

#[component]
pub fn TopBar() -> Element {
    // Compact header while a run is active; full empty-state banner when idle.
    let compact = status() != RunStatus::Idle;
    let current = current_toggle_mode();
    rsx! {
        div { class: "top", "data-testid": "layout-top",
            HeroBanner {
                compact,
                session_id: None,
                tasks_empty: true,
                tagline: "Type a goal — Apohara plans, dispatches across claude / codex / opencode, and verifies.".to_string(),
                on_seed_demo: None,
            }
            ViewToggle {
                current,
                on_change: select_view,
            }
        }
    }
}
