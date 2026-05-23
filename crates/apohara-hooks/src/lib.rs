//! Apohara Hooks — agent-hooks installer + events bridge.
//!
//! Replaces `src/core/hooks/*.ts` (TS legacy). Feature flag:
//! APOHARA_RUST_HOOKS=1 (default OFF until Phase 1 cierre).
//!
//! Integrates with the existing `apohara-hooks-server` crate (axum
//! loopback). G1.C.2 port — modules ported task-by-task following TDD.

pub mod additional_context;
pub mod compact_reinjection;
pub mod context_warnings;
pub mod events;
pub mod installer;
pub mod learnings_dump;
pub mod tauri_bridge;

pub use additional_context::{
    compose_additional_context_response, verify_additional_context_response, ComposeSources,
    ComposedResponse, VerifyResult, ADDITIONAL_CONTEXT_LIMIT_BYTES,
};
pub use compact_reinjection::{
    AdditionalContextEnvelope, CompactHookEvent, CompactReinjector, ContractSnapshot, HookOutcome,
    PreCompactContract,
};
pub use context_warnings::{
    classify_context_usage, ContextLevel, ContextUsageClassification, ContextUsageEvent,
    ContextWarningMonitor, ObserveInput,
};
pub use events::{
    parse_hook_event, HookCommonContext, HookEvent, ParseHookEventError, PermissionScope,
    StopReason,
};
pub use installer::{compute_hook_hash, install_hook, InstallReason, InstallResult};
pub use learnings_dump::{
    DumpOptions, LearningCategory, LearningEntry, LearningsCollector, LearningsHookEvent,
    LearningsHookOutcome, LearningsSnapshot, RenderedAdditionalContext,
};

#[cfg(test)]
mod additional_context_tests;
#[cfg(test)]
mod compact_reinjection_tests;
#[cfg(test)]
mod context_warnings_tests;
#[cfg(test)]
mod events_tests;
#[cfg(test)]
mod installer_tests;
#[cfg(test)]
mod learnings_dump_tests;
