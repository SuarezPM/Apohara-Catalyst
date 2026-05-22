//! Shared types for Apohara — single source of truth Rust↔TS via ts-rs.
//!
//! This crate has NO runtime dependencies on indexer/sandbox/coordinator —
//! it is pure data definitions. Use `cargo run --bin generate_types`
//! from this crate (added in Task 1.2) to emit `packages/apohara-shared/types.ts`.

pub mod capabilities;
pub mod version;
pub use capabilities::Capability;
pub use version::ApoharaVersion;
