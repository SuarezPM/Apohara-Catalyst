//! Objective input buffer — the user's free-text goal in the ObjectivePane.
//!
//! NEW signal (Sprint 23). Backs the controlled textarea (W3.A.4); the
//! dispatch loop reads it when the user hits Run.

use dioxus::prelude::*;

/// Current objective text.
pub static OBJECTIVE_INPUT: GlobalSignal<String> = Signal::global(String::new);

/// Replace the objective text.
pub fn set(s: impl Into<String>) {
    *OBJECTIVE_INPUT.write() = s.into();
}

/// Read the objective text (cloned).
pub fn get() -> String {
    OBJECTIVE_INPUT.read().clone()
}
