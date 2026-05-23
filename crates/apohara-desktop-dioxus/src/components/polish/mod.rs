//! Polish components — Sprint 18 G2.C.2 Wave B.
//!
//! - `CommandPalette`: cmd+K palette. Fuzzy-filters a list of commands
//!   using `fuzzy-matcher` (SkimMatcherV2). Replacement for the React
//!   `cmdk` library; the cmd+K global keybind is wired in G2.D.
//!
//! Sibling polish components (Toast / Tooltip / Resizable) land in
//! subsequent commits of this same task.

pub mod command_palette;

pub use command_palette::CommandPalette;

#[cfg(test)]
mod command_palette_test;
