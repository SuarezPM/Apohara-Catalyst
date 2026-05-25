//! Apohara Decomposer — SPEC → tasks manifest decomposer.
//!
//! Replaces `src/core/decomposer/*.ts` (TS legacy). Feature flag:
//! APOHARA_RUST_DECOMPOSER=1 (default OFF until Phase 1 cierre).
//!
//! G1.C.3 port — modules added task-by-task following TDD.

pub mod api;
pub mod manifests;
pub mod spec_to_manifest;

pub use manifests::{
    parse_task_with_manifest, validate_manifest, AgentRole, ManifestError, RawTask, SymbolKind,
    SymbolRef, TaskSymbolManifest,
};
pub use spec_to_manifest::{decompose_spec, DecomposedManifest};
