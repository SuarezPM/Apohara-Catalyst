//! Command palette visibility — drives the Cmd+K overlay (W3.D.1).
//!
//! NEW signal (Sprint 23). No TS antecedent: the React desktop tracked palette
//! open/closed inside component state. The Dioxus shell promotes it to a
//! `GlobalSignal` so both the global Cmd+K shortcut (registered on the desktop
//! event loop) and in-app affordances (e.g. the "How to install" empty-state
//! button) can toggle the same overlay.

use dioxus::prelude::*;

/// Whether the command palette overlay is currently shown.
pub static COMMAND_PALETTE_OPEN: GlobalSignal<bool> = Signal::global(|| false);

/// Show the palette.
pub fn open() {
    *COMMAND_PALETTE_OPEN.write() = true;
}

/// Hide the palette.
pub fn close() {
    *COMMAND_PALETTE_OPEN.write() = false;
}

/// Flip the palette's visibility (the Cmd+K binding).
pub fn toggle() {
    let now = *COMMAND_PALETTE_OPEN.read();
    *COMMAND_PALETTE_OPEN.write() = !now;
}

/// Read the current visibility.
pub fn is_open() -> bool {
    *COMMAND_PALETTE_OPEN.read()
}
