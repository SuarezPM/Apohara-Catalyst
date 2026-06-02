//! Coordinator event loop per spec §3.2.
//!
//! Pre-T4.6, this crate exposed `manifest`, `conflict_matrix`, `blast_radius`,
//! and `scheduler_decision` as standalone libraries — useful but no caller.
//! The audit (orca #9) flagged that the 5 orchestration DB tables
//! (`messages`, `tasks`, `dispatch_contexts`, `decision_gates`,
//! `coordinator_runs`) had CRUDs but no loop driving them.
//!
//! `Coordinator::tick()` is the unit of progress: read pending state, decide
//! what to dispatch, mark in-progress, detect stalls. Designed to be called
//! N×/second by a sidecar tokio task in `apohara-daemon` (Sprint 6) or by
//! the desktop dispatch loop.
//!
//! ## US-F2.1 — real storage behind a trait
//!
//! The coordinator no longer owns a `MockTask` HashMap. It is generic over a
//! [`SchedulerStore`] (`crate::store`): the live path binds the
//! `apohara-dispatch` impl over the F1.1 `TaskGraph` + `ClaimStore`, while
//! tests bind the [`InMemoryStore`] double. Two storage operations map onto
//! the two scheduling passes:
//!   * dispatch = [`SchedulerStore::ready_tasks`] (deps-gated, slot-open), and
//!   * stall    = [`SchedulerStore::reap_stale`] — the formerly-standalone
//!     F1.1 reaper, now driven from the tick (unifies the reaper with the
//!     coordinator's `StallDetected`, per the plan).
//!
//! G7.5.A.6 wires the 4 G5.B dispatch modules (originally landed as
//! TypeScript value modules under `src/core/dispatch/`) into the
//! Rust-side tick so the same decision logic is observable:
//!
//!   continuation        — per-task flag tells the runner to REUSE the
//!                         provider's prior context (no system prompt
//!                         re-send) on this dispatch.
//!   retry-semantics     — `compute_retry_delay` computes the backoff
//!                         per `RetryReason` (continuation = fixed 1 s;
//!                         transient/stall/provider_error = 2^attempt
//!                         capped 5 min; none = 0).
//!   teammate-idle       — a simple BUSY/IDLE roster the tick consults
//!                         when dispatching: if the primary agent is
//!                         saturated, the dispatch surfaces an idle
//!                         teammate's id.
//!   careful-mode        — session-level "ASK before each tool" flag.
//!                         When set, the tick short-circuits to
//!                         `BlockedByCareful` so the UI prompts the
//!                         operator before any new work goes out.

use crate::store::{InMemoryStore, SchedulerStore};
use std::collections::HashSet;

/// Retry-semantics reasons (mirrors `RetryReason` in
/// `src/core/dispatch/retry-semantics.ts`). The semantics are:
///   - Continuation: success-but-more-work; preserve context.
///   - Transient / Stall / ProviderError: failure flavours; fresh
///     context, exponential backoff.
///   - None: do NOT retry (caller surfaces the failure).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetryReason {
    Continuation,
    Transient,
    Stall,
    ProviderError,
    None,
}

/// 5-minute hard cap on exponential backoff for failure retries.
const RETRY_CAP_MS: u64 = 5 * 60 * 1000;

/// Wall-clock epoch millis. Mirrors the `apohara-dispatch` claim clock so
/// the coordinator's TTL math lines up with the on-disk `claimed_at_ms`. A
/// pre-epoch clock (impossible in practice) folds to 0 rather than panicking.
fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[derive(Debug, PartialEq)]
pub enum TickOutcome {
    NoOp,
    Dispatched {
        task_ids: Vec<String>,
        /// Set when the dispatched task carries a continuation flag —
        /// the runner should re-use the provider context (no system
        /// prompt re-send).
        reuse_context: bool,
        /// Set when teammate-idle redirected the dispatch to an idle
        /// agent because the primary was saturated. `None` means the
        /// caller picks the default routing.
        assigned_agent: Option<String>,
    },
    StallDetected {
        task_ids: Vec<String>,
    },
    /// Careful mode is on: the tick refuses to dispatch new work until
    /// the operator clears it. Carries any pending task ids so the UI
    /// knows what's waiting.
    BlockedByCareful {
        pending: Vec<String>,
    },
}

#[derive(Default)]
struct TeammateRoster {
    /// agent_id → in_flight_task_id (None = idle).
    agents: std::collections::HashMap<String, Option<String>>,
}

impl TeammateRoster {
    fn register(&mut self, id: &str) {
        // Re-registration MUST NOT clobber a BUSY entry — preserve
        // currentTaskId per the TS module's contract.
        self.agents.entry(id.to_string()).or_insert(None);
    }

    fn mark_busy(&mut self, id: &str, task_id: &str) {
        if let Some(slot) = self.agents.get_mut(id) {
            if slot.is_none() {
                *slot = Some(task_id.to_string());
            }
        }
    }

    /// Lex-first idle agent — deterministic across ticks.
    fn pick_idle(&self) -> Option<String> {
        let mut idle: Vec<&String> = self
            .agents
            .iter()
            .filter_map(|(id, slot)| if slot.is_none() { Some(id) } else { None })
            .collect();
        idle.sort();
        idle.first().map(|s| (*s).clone())
    }

    fn any_busy(&self) -> bool {
        self.agents.values().any(|s| s.is_some())
    }

    fn is_empty(&self) -> bool {
        self.agents.is_empty()
    }
}

/// The DAG scheduler. Generic over its [`SchedulerStore`] so the live path
/// (F1.1 `TaskGraph` + `ClaimStore` via `apohara-dispatch`) and tests (the
/// [`InMemoryStore`] double) share one tick implementation.
pub struct Coordinator<S: SchedulerStore = InMemoryStore> {
    store: S,
    /// TTL handed to the reaper each tick: a claim un-renewed for this long
    /// is treated as stalled and released.
    stall_timeout_ms: u64,
    /// G5.B.9 careful-mode session flag. When true, tick refuses to
    /// dispatch new work.
    careful_mode: bool,
    /// G5.B.4 continuation: task ids pre-flagged as continuation
    /// turns. Set membership controls the `reuse_context` bit on the
    /// next dispatch.
    continuation_tasks: HashSet<String>,
    /// G5.B.10 teammate-idle roster.
    roster: TeammateRoster,
}

impl Default for Coordinator<InMemoryStore> {
    fn default() -> Self {
        Self::new_with_mocks()
    }
}

impl<S: SchedulerStore> Coordinator<S> {
    /// Live constructor: schedule over any real [`SchedulerStore`] (the
    /// `apohara-dispatch` impl in production).
    pub fn new(store: S) -> Self {
        Self {
            store,
            stall_timeout_ms: 5 * 60 * 1000, // 5 minutes default
            careful_mode: false,
            continuation_tasks: HashSet::new(),
            roster: TeammateRoster::default(),
        }
    }

    /// Override the reaper TTL / stall window (default 5 min).
    pub fn set_stall_timeout_ms(&mut self, ms: u64) {
        self.stall_timeout_ms = ms;
    }

    /// G5.B.9 careful-mode toggle. When `true`, subsequent ticks
    /// short-circuit to `TickOutcome::BlockedByCareful`.
    pub fn set_careful_mode(&mut self, on: bool) {
        self.careful_mode = on;
    }

    /// G5.B.4 — mark a task id as a continuation turn so the next
    /// dispatch surfaces `reuse_context: true`.
    pub fn mark_continuation(&mut self, task_id: &str) {
        self.continuation_tasks.insert(task_id.to_string());
    }

    /// G5.B.10 — register an agent in the IDLE/BUSY roster. Idempotent
    /// (re-registration preserves any BUSY state).
    pub fn register_agent(&mut self, agent_id: &str) {
        self.roster.register(agent_id);
    }

    /// G5.B.10 — mark an agent as BUSY with `task_id`. No-op if the
    /// agent is unknown or already busy (preserves currentTaskId).
    pub fn mark_agent_busy(&mut self, agent_id: &str, task_id: &str) {
        self.roster.mark_busy(agent_id, task_id);
    }

    /// G5.B.8 — compute the millisecond backoff before retrying a task
    /// with the given reason and 0-indexed attempt count.
    pub fn compute_retry_delay(&self, reason: RetryReason, attempt: u32) -> u64 {
        match reason {
            RetryReason::Continuation => 1000,
            RetryReason::Transient | RetryReason::Stall | RetryReason::ProviderError => {
                // 1000 * 2^attempt, saturating, capped at 5 min.
                let shifted = 1000u64.checked_shl(attempt).unwrap_or(RETRY_CAP_MS);
                shifted.min(RETRY_CAP_MS)
            }
            RetryReason::None => 0,
        }
    }

    pub async fn tick(&mut self) -> TickOutcome {
        let now = now_ms();

        // Pass 0 (G5.B.9 careful-mode): if careful mode is active,
        // refuse to dispatch and surface the ready ids so the UI can
        // prompt the operator. Stalls still get detected on later ticks
        // once careful is cleared.
        if self.careful_mode {
            let pending = self.ready_or_log();
            return TickOutcome::BlockedByCareful { pending };
        }

        // Pass 1: stall detection — the unified reaper path. A claim aged
        // past `stall_timeout_ms` (or whose holder PID is dead) is released
        // by the store and surfaced as StallDetected. This is the F1.1
        // reaper, now driven from the coordinator instead of standalone.
        //
        // Clamp the u64→i64 casts: a `stall_timeout_ms > i64::MAX` would wrap
        // negative and make the reaper free every claim every tick. `now`
        // won't overflow for ~292M years, but clamp it the same way for
        // uniformity.
        let now_i64 = now.min(i64::MAX as u64) as i64;
        let ttl_i64 = self.stall_timeout_ms.min(i64::MAX as u64) as i64;
        let reaped = match self.store.reap_stale(now_i64, ttl_i64) {
            Ok(reaped) => reaped,
            Err(e) => {
                // A failing reaper must not wedge the loop; log and treat as
                // "nothing reaped this tick" — the next tick retries.
                tracing::warn!(error = %e, "reap_stale failed during tick");
                Vec::new()
            }
        };
        if !reaped.is_empty() {
            return TickOutcome::StallDetected { task_ids: reaped };
        }

        // Pass 2: dispatch the deps-gated, slot-open set.
        let pending = self.ready_or_log();
        if pending.is_empty() {
            return TickOutcome::NoOp;
        }

        // G5.B.4 continuation: if ANY pending task is flagged as a
        // continuation, the dispatch carries `reuse_context: true`.
        // The runner-side then suppresses the system prompt re-send.
        let reuse_context = pending.iter().any(|id| self.continuation_tasks.contains(id));

        // G5.B.10 teammate-idle: if the roster has any busy agent
        // (primary saturated) and at least one idle teammate, surface
        // the idle teammate so the dispatcher routes the new work
        // there. Empty rosters get `None` (caller does default
        // routing).
        let assigned_agent = if self.roster.is_empty() {
            None
        } else if self.roster.any_busy() {
            self.roster.pick_idle()
        } else {
            None
        };

        TickOutcome::Dispatched {
            task_ids: pending,
            reuse_context,
            assigned_agent,
        }
    }

    /// Read the ready set, logging (not propagating) a store error — a
    /// transient read failure degrades to "nothing ready this tick".
    fn ready_or_log(&self) -> Vec<String> {
        match self.store.ready_tasks() {
            Ok(ready) => ready,
            Err(e) => {
                tracing::warn!(error = %e, "ready_tasks failed during tick");
                Vec::new()
            }
        }
    }

    /// Borrow the backing store (e.g. to seed real tasks before ticking).
    pub fn store_mut(&mut self) -> &mut S {
        &mut self.store
    }
}

impl Coordinator<InMemoryStore> {
    /// Test/dev constructor backed by the [`InMemoryStore`] double. The name
    /// is kept for backward compatibility; the double is no longer the live
    /// path's storage (US-F2.1).
    pub fn new_with_mocks() -> Self {
        Self::new(InMemoryStore::new())
    }

    /// Enqueue a ready (no-dep, unclaimed) task into the in-memory double.
    pub fn enqueue_test_task(&mut self, id: &str) {
        self.store.enqueue(id);
    }

    /// Enqueue a node claimed `age_ms` ago and never heartbeaten — it goes
    /// stale (reaper-releasable) once `age_ms` exceeds `stall_timeout_ms`.
    pub fn enqueue_test_task_with_age(&mut self, id: &str, age_ms: u64) {
        self.store.enqueue_claimed_with_age(id, age_ms, now_ms() as i64);
    }

    /// Enqueue a dep-gated node into the in-memory double.
    pub fn enqueue_test_task_with_deps(&mut self, id: &str, deps: &[&str]) {
        self.store.enqueue_with_deps(id, deps);
    }

    /// Mark a node done in the in-memory double (unblocks its dependents).
    pub fn mark_test_task_done(&mut self, id: &str) {
        self.store.mark_done(id);
    }
}
