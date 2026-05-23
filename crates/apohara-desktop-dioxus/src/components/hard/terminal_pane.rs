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

// Implementation lands en el próximo commit (TDD red phase first).
