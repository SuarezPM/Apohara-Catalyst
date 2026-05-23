//! Polish components — Sprint 18 G2.C.2 Wave B.
//!
//! - `CommandPalette`: cmd+K palette. Fuzzy-filters a list of commands
//!   using `fuzzy-matcher` (SkimMatcherV2). Replacement for the React
//!   `cmdk` library; the cmd+K global keybind is wired in G2.D.
//! - `Toast`: Sonner-style fixed-corner notification. Replaces the
//!   empty `ToastDialog` stub from G2.B.4. Queue + auto-dismiss are
//!   deferred to G2.D.
//!
//! Sibling polish components (Tooltip / Resizable) land in subsequent
//! commits of this same task.

pub mod command_palette;
pub mod toast;

pub use command_palette::CommandPalette;
pub use toast::Toast;

#[cfg(test)]
mod command_palette_test;
#[cfg(test)]
mod polish_test;
