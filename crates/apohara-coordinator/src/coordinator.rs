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
//! the bun process directly via ts-rs bridge (today).
//!
//! G7.5.A.6 wires the 4 G5.B dispatch modules (originally landed as
//! TypeScript value modules under `src/core/dispatch/`) into the
//! Rust-side tick so the same decision logic is observable across the
//! ts-rs bridge:
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

use std::collections::{HashMap, HashSet};

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
    agents: HashMap<String, Option<String>>,
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

pub struct Coordinator {
    // Mock storage for now — Sprint 5 wires real bun:sqlite via ts-rs bridge.
    tasks: HashMap<String, MockTask>,
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

#[derive(Clone)]
struct MockTask {
    id: String,
    #[allow(dead_code)] // surfaced via ts-rs bridge in Sprint 5
    enqueued_at_ms: u64,
    dispatched_at_ms: Option<u64>,
}

impl Default for Coordinator {
    fn default() -> Self {
        Self::new_with_mocks()
    }
}

impl Coordinator {
    pub fn new_with_mocks() -> Self {
        Self {
            tasks: HashMap::new(),
            stall_timeout_ms: 5 * 60 * 1000, // 5 minutes default
            careful_mode: false,
            continuation_tasks: HashSet::new(),
            roster: TeammateRoster::default(),
        }
    }

    pub fn enqueue_test_task(&mut self, id: &str) {
        self.tasks.insert(
            id.to_string(),
            MockTask {
                id: id.to_string(),
                enqueued_at_ms: 0,
                dispatched_at_ms: None,
            },
        );
    }

    pub fn enqueue_test_task_with_age(&mut self, id: &str, age_ms: u64) {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;
        self.tasks.insert(
            id.to_string(),
            MockTask {
                id: id.to_string(),
                enqueued_at_ms: now.saturating_sub(age_ms),
                dispatched_at_ms: Some(now.saturating_sub(age_ms)),
            },
        );
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
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_millis() as u64;

        // Pass 0 (G5.B.9 careful-mode): if careful mode is active,
        // refuse to dispatch and surface pending ids so the UI can
        // prompt the operator. Stalls still get detected below — the
        // operator can still see a stalled task even while careful.
        if self.careful_mode {
            let mut pending: Vec<String> = self
                .tasks
                .values()
                .filter(|t| t.dispatched_at_ms.is_none())
                .map(|t| t.id.clone())
                .collect();
            pending.sort();
            return TickOutcome::BlockedByCareful { pending };
        }

        // Pass 1: stall detection on dispatched tasks.
        let mut stalled: Vec<String> = self
            .tasks
            .values()
            .filter(|t| {
                t.dispatched_at_ms
                    .map(|d| now.saturating_sub(d) > self.stall_timeout_ms)
                    .unwrap_or(false)
            })
            .map(|t| t.id.clone())
            .collect();
        if !stalled.is_empty() {
            stalled.sort();
            return TickOutcome::StallDetected { task_ids: stalled };
        }

        // Pass 2: dispatch pending tasks.
        let mut pending: Vec<String> = self
            .tasks
            .values()
            .filter(|t| t.dispatched_at_ms.is_none())
            .map(|t| t.id.clone())
            .collect();
        if pending.is_empty() {
            return TickOutcome::NoOp;
        }
        pending.sort();

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

        for id in &pending {
            if let Some(t) = self.tasks.get_mut(id) {
                t.dispatched_at_ms = Some(now);
            }
        }
        TickOutcome::Dispatched {
            task_ids: pending,
            reuse_context,
            assigned_agent,
        }
    }
}
