//! Brand primitives — Sprint 17 G2.B.1 ports of the React originals in
//! `packages/desktop/src/components/ui/{Button,Input,Card}.tsx`.
//!
//! The React tree did not ship a dedicated `Badge` primitive; we add one
//! here because the upstream design system (and the plan's CSS append)
//! expects it, and several Wave B layouts depend on it for status chips.
//! The Badge is a thin label container — no logic, just brand styling.

pub mod button;
pub mod card;
pub mod input;

pub use button::Button;
pub use card::Card;
pub use input::Input;

#[cfg(test)]
mod primitives_test;
