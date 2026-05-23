//! Apohara Spec — SPEC.md watcher + plan documents + plan status cache.
//!
//! Replaces `src/core/spec/*.ts` (TS legacy). Feature flag:
//! APOHARA_RUST_SPEC=1 (default OFF until Phase 1 cierre).
//!
//! Uses `notify-rs` instead of chokidar (TS) for cross-platform file
//! watching. G1.B.3 skeleton — modules ported task-by-task following TDD.

pub mod plan_documents;
pub mod plan_status_cache;
pub mod rfc2119;
pub mod tauri_bridge;
pub mod watcher;

pub use plan_documents::{
    parse_plan_document, parse_plan_document_str, AgentSessionOutcome, AgentSessionRef,
    ChecklistItem, PlanDocument, PlanParseError, PlanPriority, PlanStatus, PlanType,
};
pub use plan_status_cache::{CacheError, PlanStatusCache};
pub use rfc2119::{
    validate_rfc2119, Rfc2119Profile, Rfc2119Result, Rfc2119Severity, Rfc2119Violation,
};
pub use watcher::{
    start_plan_watcher, PlanWatcherHandle, PlanWatcherOpts, WatcherError, WatcherEvent,
};

#[cfg(test)]
mod plan_documents_tests;
#[cfg(test)]
mod plan_status_cache_tests;
#[cfg(test)]
mod rfc2119_tests;
#[cfg(test)]
mod watcher_tests;
