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

pub use cli_driver::{CliDriver, DispatchRequest, DispatchOutcome};
pub use reconciler::{run_reconciler_passes, ReconcilerCtx, ReconcilerResult};
pub use state::{RunState, RunTransition, BlockedReason};
