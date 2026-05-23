//! Run state machine types.
//!
//! Direct port of `src/core/dispatch/state.ts` (TS legacy). The TS module
//! distinguishes:
//!   * `RunState` — the *claim lifecycle* (unclaimed → claimed → running
//!     → retry_queued | released). Bounded, race-free; the scheduler
//!     uses this to decide what's pickable.
//!   * `RunPhase` — *what the runner is doing right now* inside a
//!     `running` claim. Lossy, free-form-ish; the UI uses this to render
//!     real-time per-task progress.
//!
//! Both serialize as snake_case strings so the wire format stays
//! identical during Phase 1 double-maintenance (TS and Rust both feed
//! the same orchestration DB).
//!
//! See `src/core/dispatch/state.ts` for the full design rationale —
//! this module mirrors it so the symphony SPEC.md §7.1 vocabulary
//! survives the port.

use serde::{Deserialize, Serialize};

/// Claim lifecycle states. Closed set; iterate via [`RUN_STATES`].
///
/// TS source: `type RunState = "unclaimed" | "claimed" | "running"
/// | "retry_queued" | "released"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunState {
    Unclaimed,
    Claimed,
    Running,
    RetryQueued,
    Released,
}

/// Closed enumeration for callers wanting to iterate every legal claim
/// state (UI legends, migrations, audits). Mirrors TS `RUN_STATES`.
pub const RUN_STATES: [RunState; 5] = [
    RunState::Unclaimed,
    RunState::Claimed,
    RunState::Running,
    RunState::RetryQueued,
    RunState::Released,
];

/// What the runner is doing while it holds a `running` claim.
///
/// TS source: `type RunPhase = "preparing_workspace" | "building_prompt"
/// | "launching_agent_process" | "initializing_session" | "streaming_turn"
/// | "finishing" | "succeeded" | "failed" | "timed_out" | "stalled"
/// | "canceled_by_reconciliation"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RunPhase {
    PreparingWorkspace,
    BuildingPrompt,
    LaunchingAgentProcess,
    InitializingSession,
    StreamingTurn,
    Finishing,
    Succeeded,
    Failed,
    TimedOut,
    Stalled,
    CanceledByReconciliation,
}

impl RunPhase {
    /// Mirrors TS `isTerminalPhase` — phases that imply the task ended,
    /// regardless of outcome.
    #[inline]
    pub fn is_terminal(self) -> bool {
        matches!(
            self,
            RunPhase::Succeeded
                | RunPhase::Failed
                | RunPhase::TimedOut
                | RunPhase::Stalled
                | RunPhase::CanceledByReconciliation
        )
    }
}

/// Distinguishes the single "happy ending" phase from the 4 unhappy ones.
/// Mirrors TS `phaseImpliesSuccess`. Used by the continuation pattern
/// (symphony §10.3) to decide whether to schedule follow-up work.
#[inline]
pub fn phase_implies_success(p: RunPhase) -> bool {
    matches!(p, RunPhase::Succeeded)
}

/// Scheduler input filter — picks rows the next tick can pull.
/// Mirrors TS `isClaimable`.
#[inline]
pub fn is_claimable(s: RunState) -> bool {
    matches!(s, RunState::Unclaimed | RunState::Released)
}

/// Legal `RunState` transitions per symphony §7.1. Mirrors TS
/// `ALLOWED_TRANSITIONS` / `canTransition`.
///
/// Any other from/to is REJECTED — callers should not flip `Released`
/// straight to `Running` (must re-claim), and must not jump from
/// `Unclaimed` to `Running` (must record the intermediate `Claimed` so
/// the audit trail names the responsible worker).
pub fn can_transition(from: RunState, to: RunState) -> bool {
    use RunState::*;
    matches!(
        (from, to),
        (Unclaimed, Claimed)
            | (Claimed, Running)
            | (Claimed, Released)
            | (Running, RetryQueued)
            | (Running, Released)
            | (RetryQueued, Claimed)
            | (RetryQueued, Released)
            | (Released, Unclaimed)
    )
}

/// Race-free release contract — RFC 4122 v4. The orchestrator stores
/// this token alongside the claim row at `unclaimed → claimed` and
/// rejects any later `running → released` that doesn't present the
/// same token. Mirrors TS `freshClaimToken` (which used Node's
/// `crypto.randomUUID`).
pub fn fresh_claim_token() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Closed enumeration of the reasons a task ends up in `blocked` state.
///
/// TS source: `type BlockedReason = "approval_required"
/// | "user_input_required" | "mcp_elicitation"
/// | "stalled_after_input_request" | "provider_rejected"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockedReason {
    /// Agent asked to approve a tool call.
    ApprovalRequired,
    /// Agent asked a free-form question.
    UserInputRequired,
    /// An MCP server elicited additional spec from the user mid-tool.
    McpElicitation,
    /// Input was requested but no answer came; the agent timed out
    /// waiting.
    StalledAfterInputRequest,
    /// Provider hard-refused (TOS, rate limit, auth).
    ProviderRejected,
}

/// The discriminator field on [`RunTransition`].
///
/// TS source: `state: RunState | "blocked"` — a flat string-union.
/// We represent it as a Rust enum where one branch wraps the primary
/// claim state and the other is the secondary `"blocked"` tag, with a
/// custom serde rule that flattens both into a single string on the
/// wire (so `{"state":"claimed"}` and `{"state":"blocked"}` both
/// round-trip cleanly through the same struct).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TransitionState {
    /// One of the primary claim-lifecycle states.
    Run(RunState),
    /// The secondary `"blocked"` tag — task is parked awaiting operator
    /// input. When this variant is set, [`RunTransition::blocked_reason`]
    /// and [`RunTransition::blocked_since`] MUST be populated so the
    /// reconciler's blocked-aging pass can escalate stuck inputs.
    Blocked,
}

impl Serialize for TransitionState {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        match self {
            TransitionState::Run(s) => s.serialize(serializer),
            TransitionState::Blocked => serializer.serialize_str("blocked"),
        }
    }
}

impl<'de> Deserialize<'de> for TransitionState {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let s: String = String::deserialize(deserializer)?;
        match s.as_str() {
            "blocked" => Ok(TransitionState::Blocked),
            "unclaimed" => Ok(TransitionState::Run(RunState::Unclaimed)),
            "claimed" => Ok(TransitionState::Run(RunState::Claimed)),
            "running" => Ok(TransitionState::Run(RunState::Running)),
            "retry_queued" => Ok(TransitionState::Run(RunState::RetryQueued)),
            "released" => Ok(TransitionState::Run(RunState::Released)),
            other => Err(serde::de::Error::unknown_variant(
                other,
                &[
                    "unclaimed",
                    "claimed",
                    "running",
                    "retry_queued",
                    "released",
                    "blocked",
                ],
            )),
        }
    }
}

/// A state-machine transition that the dispatcher applies as a single
/// unit.
///
/// Direct port of TS `RunTransition` (G7.5.A.5). The `state` field is
/// `RunState | "blocked"` in TS — see [`TransitionState`].
///
/// When `state == TransitionState::Blocked`, the [`Self::blocked_reason`]
/// and [`Self::blocked_since`] fields MUST be present so the
/// reconciler's blocked-aging pass can escalate stuck inputs (mirrored
/// from `reconciler.ts` PASS_BLOCKED_AGING).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunTransition {
    pub state: TransitionState,
    /// Set when `state == Blocked`.
    #[serde(rename = "blockedReason", skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<BlockedReason>,
    /// Epoch ms of the block start (set when `state == Blocked`).
    #[serde(rename = "blockedSince", skip_serializing_if = "Option::is_none")]
    pub blocked_since: Option<u64>,
    /// Optional provenance string.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}
