//! Apohara Hooks — agent-hooks installer + events bridge.
//!
//! Replaces `src/core/hooks/*.ts` (TS legacy). Feature flag:
//! APOHARA_RUST_HOOKS=1 (default OFF until Phase 1 cierre).
//!
//! Integrates with the existing `apohara-hooks-server` crate (axum
//! loopback). G1.C.2 port — modules ported task-by-task following TDD.

pub mod additional_context;
pub mod events;

pub use additional_context::{
    compose_additional_context_response, verify_additional_context_response, ComposeSources,
    ComposedResponse, VerifyResult, ADDITIONAL_CONTEXT_LIMIT_BYTES,
};
pub use events::{
    parse_hook_event, HookCommonContext, HookEvent, ParseHookEventError, PermissionScope,
    StopReason,
};

#[cfg(test)]
mod additional_context_tests;
#[cfg(test)]
mod events_tests;
