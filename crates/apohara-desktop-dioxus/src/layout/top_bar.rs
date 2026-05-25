//! Top bar slot (grid-area: top). Hosts the HeroBanner — compact while a run is
//! active, full empty-state card when idle. ViewToggle (W3.A.3) mounts here next.

use dioxus::prelude::*;

use crate::components::HeroBanner;
use crate::state::running_status::{status, RunStatus};

#[component]
pub fn TopBar() -> Element {
    // Compact header while a run is active; full empty-state banner when idle.
    let compact = status() != RunStatus::Idle;
    rsx! {
        div { class: "top", "data-testid": "layout-top",
            HeroBanner {
                compact,
                session_id: None,
                tasks_empty: true,
                tagline: "Type a goal — Apohara plans, dispatches across claude / codex / opencode, and verifies.".to_string(),
                on_seed_demo: None,
            }
        }
    }
}
