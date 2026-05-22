//! Scheduling decision per spec §3.2.
//!
//! The coordinator returns one of four decisions for any candidate task:
//! - `Assign`: dispatch immediately
//! - `Queue`: hold until a specific running task completes (carries `waiting_for`)
//! - `Reject`: manifest is malformed — symbol does not exist in the index
//! - `Defer`: transient failure (indexer down, low-confidence expansion) —
//!   the scheduler should retry after `retry_after`

use crate::manifest::SymbolRef;
use std::time::Duration;

/// Opaque task identifier owned by the orchestration DB. Kept as a `String`
/// alias here to avoid pulling the persistence crate into `apohara-coordinator`.
pub type TaskId = String;

/// What the coordinator tells the scheduler to do with a candidate task.
#[derive(Debug, Clone)]
pub enum SchedulingDecision {
    /// Safe to dispatch now.
    Assign,
    /// Conflict with a running task — hold until it completes.
    Queue {
        waiting_for: TaskId,
        reason: String,
        overlap: Vec<SymbolRef>,
    },
    /// Manifest references symbols that do not exist — fail fast.
    Reject {
        reason: String,
        missing_symbols: Vec<SymbolRef>,
    },
    /// Transient inability to decide (e.g. indexer unreachable) — retry later.
    Defer {
        reason: String,
        retry_after: Duration,
    },
}

impl SchedulingDecision {
    /// Discriminant tag, useful for metrics/audit lines without serializing
    /// the full payload.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Assign => "assign",
            Self::Queue { .. } => "queue",
            Self::Reject { .. } => "reject",
            Self::Defer { .. } => "defer",
        }
    }
}
