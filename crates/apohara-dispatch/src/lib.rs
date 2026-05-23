//! Apohara Dispatch — orchestrates parallel CLI subprocess dispatch.
//!
//! Replaces `src/providers/cli-driver.ts` + `src/core/dispatch/*.ts` (TS legacy).
//! Feature flag: APOHARA_RUST_DISPATCH=1 (default OFF until Phase 1 cierre).

pub mod cli_driver;
pub mod reconciler;
pub mod state;
pub mod executor;
pub mod continuation;
pub mod retry;
pub mod teammate;
pub mod careful;
pub mod tauri_bridge;

pub use careful::CarefulMode;
pub use cli_driver::{CliDriver, DispatchOutcome, DispatchRequest};
pub use continuation::ContinuationTracker;
pub use reconciler::{run_reconciler_passes, ReconcilerCtx, ReconcilerResult};
pub use retry::{compute_retry_delay, RetryReason};
pub use state::{BlockedReason, RunPhase, RunState, RunTransition, TransitionState};
pub use teammate::TeammateRoster;

#[cfg(test)]
mod state_tests;

#[cfg(test)]
mod cli_driver_tests;

#[cfg(test)]
mod reconciler_tests;
