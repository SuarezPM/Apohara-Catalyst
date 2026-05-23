//! Hard components — Sprint 19 (G2.D) ports.
//!
//! These ports replace heavy upstream React dependencies with native Rust
//! equivalents. They are the most expensive components in the React desktop
//! (Monaco editor, xterm.js, @xyflow/react graph canvas), and each one
//! drives a feature reduction that is documented in the corresponding
//! component module header.
//!
//! - `CodeDiffPane` — replaces `@monaco-editor/react` with `syntect`-based
//!   syntax highlighting + naive line diff. Feature reduction: no
//!   IntelliSense, no hover popups, no go-to-definition. Sufficient for
//!   the code-review path (G2.D.2).
//! - `SwarmCanvas` — replaces `@xyflow/react` with `petgraph`-driven
//!   topological layout + a hand-rolled SVG renderer. Feature reduction:
//!   no zoom/pan/draggable nodes (deferred to v1.1). Sufficient for the
//!   read-only swarm visualization (G2.D.3).
//! - `TerminalPane` — replaces `xterm.js` with `alacritty_terminal`'s
//!   headless Term + vte processor. Feature reduction: no link rendering,
//!   no search, no OSC 998 badge, no live PTY wiring (deferred to Phase 3
//!   ContextForge). Sufficient for the SSR-friendly shell (G2.D.1).

pub mod code_diff_pane;
pub mod swarm_canvas;
pub mod swarm_layout;
pub mod terminal_pane;

pub use code_diff_pane::CodeDiffPane;
pub use swarm_canvas::SwarmCanvas;
// `pub use terminal_pane::TerminalPane;` lands en el commit verde (G2.D.1.2).

#[cfg(test)]
mod code_diff_pane_test;
#[cfg(test)]
mod swarm_canvas_test;
// `terminal_pane_test` se cablea cuando el componente exista (G2.D.1.2).
