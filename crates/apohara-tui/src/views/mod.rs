//! Render modules for the TUI. Each view is a pure `fn(&AppState, &mut
//! Frame)` so callers (main loop, snapshot tests) can drive layout
//! without owning terminal state.

pub mod agent_list;
pub mod config_wizard;
pub mod cost_table;
pub mod dashboard;
