//! CodeDiffPane — syntect-based syntax highlighting + naive line diff.
//!
//! Reference: `packages/desktop/src/components/CodeDiffPane.tsx` (monaco).
//!
//! Feature reduction (documented in `hard/mod.rs`): sin IntelliSense, sin
//! hover popups, sin go-to-def. Suficiente para el code-review path.
//!
//! The pure helpers (`highlight_line`, `diff_lines`) are exposed so the SSR
//! component and the unit tests can both rely on the same logic.

// Implementation lands in the next commit (TDD red phase first).
