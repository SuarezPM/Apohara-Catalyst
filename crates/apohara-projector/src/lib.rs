//! Apohara Projector — projectToUiCards + projectToSearchRows +
//! json-patch-stream + transcript-transformer.
//!
//! Replaces `src/core/projector/*.ts` (TS legacy). Feature flag:
//! APOHARA_RUST_PROJECTOR=1 (default OFF until Phase 1 cierre).
//!
//! G1.C.4 port — modules added task-by-task following TDD.

pub mod json_patch_stream;

pub use json_patch_stream::{apply_patch, diff_patch, JsonPatchOp};

#[cfg(test)]
mod json_patch_stream_tests;
