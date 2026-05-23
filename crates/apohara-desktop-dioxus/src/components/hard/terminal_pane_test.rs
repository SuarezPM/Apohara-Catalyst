//! Unit + SSR tests for the TerminalPane port (G2.D.1).
//!
//! Reference: `packages/desktop/src/components/TerminalPane.tsx`.
//!
//! Targets under test:
//!   - `TerminalState::new(cols, rows)`        → headless terminal grid.
//!   - `TerminalState::process_output(bytes)`  → drains ANSI control codes
//!                                                through the vte processor.
//!   - `TerminalState::visible_text()`         → flattened screen rows.
//!   - `TerminalPane { pty_id }` Dioxus component → SSR markup with a
//!     `data-terminal-pane` attribute the integration layer can hook into.

use super::terminal_pane::{TerminalPane, TerminalState};
use dioxus::prelude::*;

#[test]
fn terminal_state_accumulates_output() {
    let mut state = TerminalState::new(80, 24);
    state.process_output(b"hello\n");
    assert!(
        state.visible_text().contains("hello"),
        "visible text missing 'hello': {:?}",
        state.visible_text()
    );
}

#[test]
fn terminal_state_handles_ansi_clear() {
    let mut state = TerminalState::new(80, 24);
    state.process_output(b"foo\n");
    // ESC [ 2 J  →  clear entire screen
    state.process_output(b"\x1b[2J");
    state.process_output(b"bar\n");
    let text = state.visible_text();
    assert!(
        text.contains("bar"),
        "post-clear write 'bar' missing: {text:?}"
    );
}

#[test]
fn terminal_state_dimensions_round_trip() {
    let state = TerminalState::new(120, 32);
    assert_eq!(state.cols(), 120);
    assert_eq!(state.rows(), 32);
}

#[test]
fn ssr_emits_terminal_pane_marker() {
    // The component is the SSR-friendly shell. Live PTY wiring (WebSocket
    // streaming via Tauri command) is deferred to Phase 3; for now we only
    // assert the markup contract the integration layer will hang onto.
    let html = dioxus_ssr::render_element(rsx! {
        TerminalPane { pty_id: "demo-pty".to_string() }
    });
    assert!(
        html.contains("data-terminal-pane"),
        "missing data-terminal-pane attr in SSR: {html}"
    );
    assert!(
        html.contains("demo-pty"),
        "pty_id not surfaced as data attr: {html}"
    );
    assert!(
        html.contains("terminal-pane"),
        "terminal-pane class missing: {html}"
    );
}
