//! Apohara Dispatch — orchestrates parallel CLI subprocess dispatch.
//!
//! Replaces `src/providers/cli-driver.ts` + `src/core/dispatch/*.ts` (TS legacy).
//! Feature flag: APOHARA_RUST_DISPATCH=1 (default OFF until Phase 1 cierre).

pub mod claim;
pub mod cli_driver;
pub mod reconciler;
pub mod state;
pub mod executor;
pub mod continuation;
pub mod retry;
pub mod teammate;
pub mod careful;
pub mod api;
pub mod task_graph;

pub use careful::CarefulMode;
pub use cli_driver::{CliDriver, DispatchOutcome, DispatchRequest};
pub use continuation::ContinuationTracker;
pub use reconciler::{run_reconciler_passes, ReconcilerCtx, ReconcilerResult};
pub use retry::{compute_retry_delay, RetryReason};
pub use claim::{ClaimError, ClaimOutcome, ClaimRecord, ClaimStore, Heartbeat, ReportOutcome};
pub use state::{BlockedReason, RunPhase, RunState, RunTransition, TransitionState};
pub use task_graph::{default_pid_alive, reap_stale_claims, TaskGraph, TaskNode};
pub use teammate::TeammateRoster;

#[cfg(test)]
mod claim_tests;

#[cfg(test)]
mod state_tests;

#[cfg(test)]
mod cli_driver_tests;

#[cfg(test)]
mod reconciler_tests;
