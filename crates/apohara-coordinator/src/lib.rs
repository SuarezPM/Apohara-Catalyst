//! Apohara Coordinator per spec §3.2.
//!
//! Semantic conflict coordinator for parallel task scheduling. The crate is
//! deliberately **slim**: public functions operate on slices/IDs and delegate
//! persistence to the orchestration DB. State lives elsewhere.
//!
//! Modules:
//! - [`manifest`]: `TaskSymbolManifest` = `{ reads, writes, renames }` of `SymbolRef`
//! - [`conflict_matrix`]: applies the 9-cell read/write/rename matrix between two manifests
//! - [`blast_radius`]: indexer-expanded reachability set with confidence
//! - [`scheduler_decision`]: the four possible outcomes the scheduler acts on

pub mod blast_radius;
pub mod conflict_matrix;
pub mod manifest;
pub mod scheduler_decision;

/// Crate version, for smoke tests and version surfacing.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
