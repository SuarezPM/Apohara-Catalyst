//! Canonical → dialect adapter pattern per spec §8.7.

pub mod canonical;
pub mod adapters;
pub mod jsonc;

#[cfg(test)]
mod jsonc_tests;

pub use canonical::{McpCanonical, McpServerCanonical, McpServerType};

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}