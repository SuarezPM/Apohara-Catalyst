//! TerminalPane — alacritty_terminal-backed headless terminal state.
//!
//! Reference: `packages/desktop/src/components/TerminalPane.tsx` (xterm.js).
//!
//! Feature reduction (documented in `hard/mod.rs`): sin links rendering, sin
//! search, sin scrollback search, sin OSC 998 badge. La pieza nativa de PTY
//! live (Tauri command + WebSocket streaming) se difiere a Phase 3
//! ContextForge — esta task solo aporta la state machine y el shell del
//! componente Dioxus, suficiente para SSR + tests.
//!
//! `TerminalState` envuelve `alacritty_terminal::Term` con un
//! `vte::ansi::Processor`. Los bytes que entran (raw stdout del PTY o un
//! buffer cualquiera) atraviesan el processor, que aplica los control codes
//! ANSI sobre el grid del Term. `visible_text` aplana el grid visible a un
//! `String` — esto es lo que el componente SSR-friendly pinta dentro de un
//! `<pre data-terminal-pane>`.

use alacritty_terminal::event::VoidListener;
use alacritty_terminal::grid::Dimensions;
use alacritty_terminal::index::Line;
use alacritty_terminal::term::test::TermSize;
use alacritty_terminal::term::{Config, Term};
use alacritty_terminal::vte::ansi::Processor;
use dioxus::prelude::*;

/// Headless terminal state. Wraps an `alacritty_terminal::Term` together
/// with a `vte::ansi::Processor` so callers can stream raw PTY bytes
/// (including ANSI control codes) and read back a flattened text snapshot.
///
/// Not `Clone`: `Term` owns mutable grid state that must not be duplicated.
/// Not `Send`/`Sync` either — keep one instance per logical PTY.
pub struct TerminalState {
    term: Term<VoidListener>,
    processor: Processor,
    cols: u16,
    rows: u16,
}

impl TerminalState {
    /// Construct a new headless terminal with the given dimensions in cells.
    ///
    /// `cols` and `rows` mirror xterm.js's `cols`/`rows` options; the
    /// upstream React component defaults to whatever fit-addon computes at
    /// mount time, so the only safe defaults here are the standard
    /// `80x24` legacy TTY size used by the upstream tests.
    pub fn new(cols: u16, rows: u16) -> Self {
        let size = TermSize::new(cols as usize, rows as usize);
        let config = Config::default();
        let term = Term::new(config, &size, VoidListener);
        Self {
            term,
            processor: Processor::new(),
            cols,
            rows,
        }
    }

    /// Feed raw bytes through the ANSI processor into the grid. Accepts
    /// any byte slice, including partial UTF-8 sequences and embedded
    /// control codes (`\x1b[2J` clears the screen, `\r` returns the
    /// cursor, etc.). Idempotent in shape — the grid stays at the same
    /// dimensions regardless of input.
    pub fn process_output(&mut self, bytes: &[u8]) {
        self.processor.advance(&mut self.term, bytes);
    }

    /// Flatten the visible screen into a newline-separated string.
    ///
    /// This is the SSR fallback for the live-PTY wiring deferred to
    /// Phase 3. It walks every visible row in order, concatenating each
    /// cell's character, and ends every row with a `\n`. Trailing
    /// whitespace inside cells is preserved so the layout matches what
    /// xterm.js would paint — callers that want stripped lines can split
    /// on `\n` and `trim_end`.
    pub fn visible_text(&self) -> String {
        let grid = self.term.grid();
        let lines = grid.screen_lines();
        let cols = grid.columns();
        // Pre-size: one char + newline per cell of visible grid.
        let mut out = String::with_capacity(lines * (cols + 1));
        for line_idx in 0..lines {
            let row = &grid[Line::from(line_idx)];
            for cell in row {
                out.push(cell.c);
            }
            out.push('\n');
        }
        out
    }

    /// Visible columns (the value passed to `new`).
    pub fn cols(&self) -> u16 {
        self.cols
    }

    /// Visible rows (the value passed to `new`).
    pub fn rows(&self) -> u16 {
        self.rows
    }
}

/// SSR-friendly Dioxus shell for an embedded PTY.
///
/// The component renders an empty terminal grid placeholder with stable
/// data attributes so the integration layer (Tauri command + WebSocket
/// in Phase 3) can hook in without changing markup. No live state is
/// piped here — wiring a `Signal<TerminalState>` through a Tauri stream
/// belongs to Phase 3 ContextForge.
///
/// Props:
///   - `pty_id` — surfaced via `data-pty-id` so the future bridge can
///     look up the right PTY when it receives chunks.
#[component]
pub fn TerminalPane(pty_id: String) -> Element {
    // Default xterm.js mount size — see TerminalState::new docs for why.
    let placeholder = TerminalState::new(80, 24);
    let visible = placeholder.visible_text();
    rsx! {
        div {
            class: "terminal-pane",
            "data-terminal-pane": "true",
            "data-pty-id": "{pty_id}",
            pre {
                class: "terminal-output",
                "data-cols": "{placeholder.cols()}",
                "data-rows": "{placeholder.rows()}",
                "{visible}"
            }
        }
    }
}
