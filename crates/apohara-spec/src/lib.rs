//! Apohara Spec — SPEC.md watcher + plan documents + plan status cache.
//!
//! Replaces `src/core/spec/*.ts` (TS legacy). Feature flag:
//! APOHARA_RUST_SPEC=1 (default OFF until Phase 1 cierre).
//!
//! Uses `notify-rs` instead of chokidar (TS) for cross-platform file
//! watching. G1.B.3 skeleton — modules ported task-by-task following TDD.

pub mod rfc2119;

pub use rfc2119::{
    validate_rfc2119, Rfc2119Profile, Rfc2119Result, Rfc2119Severity, Rfc2119Violation,
};

#[cfg(test)]
mod rfc2119_tests;
