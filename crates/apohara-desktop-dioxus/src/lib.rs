//! Apohara Desktop (Dioxus rewrite, Phase 2 bake-off).
//!
//! This crate is the Rust-native rewrite of `packages/desktop/src/*`. Sprint
//! 16 (G2.A) covers the bake-off: a working window, one component ported
//! (HeroBanner), a hot-reload pipeline, and a decision document.

pub mod app;
pub mod commands;
pub mod components;
pub mod coroutines;
pub mod layout;
pub mod overlays;
pub mod state;

pub use app::App;
