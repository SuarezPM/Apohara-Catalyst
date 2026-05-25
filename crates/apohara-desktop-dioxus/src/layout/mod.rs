//! 3-pane layout shell (Sprint 23 W2.6).
//!
//! CSS grid with areas `"top top top" / "left center right" / "bottom bottom
//! bottom"` (see `assets/brand.css` `.apohara-grid`). `MainLayout` composes the
//! five slot components; each slot swaps in later waves without touching the
//! shell.

pub mod bottom_bar;
pub mod center_pane;
pub mod left_pane;
pub mod main_layout;
pub mod right_pane;
pub mod top_bar;

pub use bottom_bar::BottomBar;
pub use center_pane::CenterPane;
pub use left_pane::LeftPane;
pub use main_layout::MainLayout;
pub use right_pane::RightPane;
pub use top_bar::TopBar;

#[cfg(test)]
mod layout_test;
