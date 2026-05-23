//! Dioxus component modules — Sprint 9 React → Rust ports.

pub mod brand;
pub mod dialogs;
pub mod hero_banner;
pub mod layout;
pub mod polish;
pub mod primitives;

pub use brand::{AgentStateDot, PixelCanvas, RunningBorder};
pub use dialogs::{PermissionDialog, PermissionScope, ToastDialog};
pub use hero_banner::HeroBanner;
pub use layout::{ProviderRoster, TaskBoard};
pub use polish::CommandPalette;
pub use primitives::Button;

#[cfg(test)]
mod hero_banner_test;
