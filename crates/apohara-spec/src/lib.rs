//! Apohara Spec — SPEC.md watcher + plan documents + plan status cache.
//!
//! Replaces `src/core/spec/*.ts` (TS legacy). Feature flag:
//! APOHARA_RUST_SPEC=1 (default OFF until Phase 1 cierre).
//!
//! Uses `notify-rs` instead of chokidar (TS) for cross-platform file
//! watching. G1.B.3 skeleton — modules ported task-by-task following TDD.
