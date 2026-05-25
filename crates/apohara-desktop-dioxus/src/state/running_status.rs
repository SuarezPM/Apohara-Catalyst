//! Run status — Idle / Dispatching / Verifying.
//!
//! NEW signal (Sprint 23). Drives the HeroBanner compact mode (W3.A.1) and
//! gates the Run button. Set to `Dispatching` when a goal launches, `Verifying`
//! while quality gates run, back to `Idle` on completion.

use dioxus::prelude::*;

/// The three top-level run phases reflected in the shell.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum RunStatus {
    #[default]
    Idle,
    Dispatching,
    Verifying,
}

/// Root signal carrying the active run status.
pub static RUNNING_STATUS: GlobalSignal<RunStatus> = Signal::global(RunStatus::default);

/// Replace the active run status.
pub fn set_status(status: RunStatus) {
    *RUNNING_STATUS.write() = status;
}

/// Read the active run status.
pub fn status() -> RunStatus {
    *RUNNING_STATUS.read()
}
