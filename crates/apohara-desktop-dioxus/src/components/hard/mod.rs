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

pub mod code_diff_pane;
pub mod swarm_canvas;
pub mod swarm_layout;

pub use code_diff_pane::CodeDiffPane;
pub use swarm_canvas::SwarmCanvas;

#[cfg(test)]
mod code_diff_pane_test;
#[cfg(test)]
mod swarm_canvas_test;
