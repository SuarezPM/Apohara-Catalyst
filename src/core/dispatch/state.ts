/**
 * Symphony state-machine vocabulary (SPEC §7.1).
 *
 * Separates "what the user thinks the run is doing" (`RunState`) from
 * "what the runner is doing right now" (`RunPhase`). The first answers
 * "is this task work I can still claim?", the second answers "if it's
 * running, where in the pipeline is it stuck?".
 *
 * The dispatcher emits the corresponding ledger event types so the UI
 * can render real-time per-task progress in the VerificationTimeline
 * (Stage 8 wire-up) and the reconciler can detect stalls
 * (`runReconciler` below).
 *
 * Naming aligns with `reference/symphony/SPEC.md §7.1, §16.5` so the
 * symphony spec is directly applicable to Apohara — same vocabulary,
 * same lifecycle, different host language.
 *
 * G5.B.1 fills the gaps the audit flagged PARCIAL (audit symphony §3):
 *   - explicit `RUN_STATES` closed list,
 *   - `isClaimable(state)` predicate (scheduler input filter),
 *   - `canTransition(from, to)` claim-DAG guard (catches race-driven
 *     stale callers that try `released → running` without re-claim),
 *   - `freshClaimToken()` RFC 4122 v4 (race-free release contract —
 *     orchestrator stores the token alongside the claim and only
 *     accepts release attempts that present the same token),
 *   - `phaseImpliesSuccess` (success ≠ done distinction needed by
 *     continuation chains, see retry-semantics.ts in G5.B.8).
 *
 * G5.B.3 / G5.B.9 / G5.B.10 then layer the secondary concerns
 *   (`BlockedReason`, `CarefulMode`, `TeammateIdle`) on top of the
 *   primary claim states without breaking the vocabulary.
 */

import { randomUUID } from "node:crypto";

export type RunState =
	| "unclaimed"
	| "claimed"
	| "running"
	| "retry_queued"
	| "released";

/** Closed enumeration for callers wanting to iterate every legal claim
 * state (UI legends, migrations, audits). Keep this in sync with the
 * `RunState` union — `canTransition` and `isClaimable` assume the set
 * is complete. */
export const RUN_STATES = [
	"unclaimed",
	"claimed",
	"running",
	"retry_queued",
	"released",
] as const satisfies readonly RunState[];

export type RunPhase =
	| "preparing_workspace"
	| "building_prompt"
	| "launching_agent_process"
	| "initializing_session"
	| "streaming_turn"
	| "finishing"
	| "succeeded"
	| "failed"
	| "timed_out"
	| "stalled"
	| "canceled_by_reconciliation";

/** Per-phase ledger event payload — small and stable. */
export interface PhaseEventPayload {
	taskId: string;
	phase: RunPhase;
	at: number;
	/** Free-form context. Kept lossy on purpose; the orchestration DB
	 * carries the structured per-task state. */
	detail?: string;
}

/** Sentinel value for `RunPhase` events that imply the task ended. */
export const TERMINAL_PHASES: ReadonlySet<RunPhase> = new Set([
	"succeeded",
	"failed",
	"timed_out",
	"stalled",
	"canceled_by_reconciliation",
]);

export function isTerminalPhase(p: RunPhase): boolean {
	return TERMINAL_PHASES.has(p);
}

/**
 * Distinguishes the single "happy ending" phase from the 4 unhappy
 * ones. The continuation pattern (symphony §10.3, see G5.B.8) treats
 * `succeeded` as "this turn ended cleanly — maybe schedule a follow-up
 * if the parent intent still wants more work"; the failure flavours
 * each map to different retry semantics (transient / stall / canceled
 * → see retry-semantics.ts).
 */
export function phaseImpliesSuccess(p: RunPhase): boolean {
	return p === "succeeded";
}

/** Scheduler input filter — picks rows the next tick can pull. */
export function isClaimable(s: RunState): boolean {
	return s === "unclaimed" || s === "released";
}

/**
 * Legal `RunState` transitions per symphony §7.1.
 *
 *   unclaimed   → claimed        (worker picked it up)
 *   claimed     → running        (worker started executing)
 *   claimed     → released       (worker died before starting; reaper)
 *   running     → retry_queued   (transient failure, will retry)
 *   running     → released       (terminal — succeeded or failed)
 *   retry_queued→ claimed        (re-pickup after back-off)
 *   retry_queued→ released       (max retries reached)
 *   released    → unclaimed      (reaper pushes it back into the pool)
 *
 * Any other from/to is REJECTED — callers should not flip `released`
 * straight to `running` (must re-claim), and must not jump from
 * `unclaimed` to `running` (must record the intermediate `claimed` so
 * the audit trail names the responsible worker).
 */
const ALLOWED_TRANSITIONS: ReadonlyMap<RunState, ReadonlySet<RunState>> = new Map([
	["unclaimed", new Set<RunState>(["claimed"])],
	["claimed", new Set<RunState>(["running", "released"])],
	["running", new Set<RunState>(["retry_queued", "released"])],
	["retry_queued", new Set<RunState>(["claimed", "released"])],
	["released", new Set<RunState>(["unclaimed"])],
]);

export function canTransition(from: RunState, to: RunState): boolean {
	return ALLOWED_TRANSITIONS.get(from)?.has(to) ?? false;
}

/**
 * Race-free release contract — RFC 4122 v4. The orchestrator stores
 * this token alongside the claim row at `unclaimed → claimed` and
 * rejects any later `running → released` that doesn't present the same
 * token. Prevents a stale or out-of-band caller from "releasing"
 * someone else's claim (the symphony Elixir code uses ets-table guards
 * for the same purpose; TS we use the bun:sqlite `WHERE token = ?`
 * conditional UPDATE).
 */
export function freshClaimToken(): string {
	return randomUUID();
}

// ---------------------------------------------------------------------
// G5.B.3 — Blocked as primary state (audit symphony §10 PARCIAL → COMPLETO)
// ---------------------------------------------------------------------

/**
 * Closed enumeration of the reasons a task ends up in `blocked` state.
 * The scheduler treats `blocked` as a primary state (separate from
 * `retry_queued` / `released`) so the UI can render "Needs Operator"
 * cards independently from the retry pool.
 *
 *   approval_required           — agent asked to approve a tool call
 *   user_input_required         — agent asked a free-form question
 *   mcp_elicitation             — an MCP server elicited additional
 *                                 spec from the user mid-tool
 *   stalled_after_input_request — input requested but no answer came,
 *                                 and the agent timed out waiting
 *   provider_rejected           — provider hard-refused (TOS, rate
 *                                 limit, auth)
 */
export type BlockedReason =
	| "approval_required"
	| "user_input_required"
	| "mcp_elicitation"
	| "stalled_after_input_request"
	| "provider_rejected";

export interface BlockedSnapshot {
	reason: BlockedReason;
	/** Epoch ms when the block started. Drives `reconciler.PASS_BLOCKED_AGING`. */
	since: number;
	/** Free-form detail (tool name, prompt label, MCP server id). */
	detail?: string;
}

/**
 * Heuristic classifier — takes an event payload coming out of the
 * provider stream and decides if it should park the task in `blocked`
 * state, with which reason.
 *
 * Bias: false negatives > false positives. We'd rather let a run
 * proceed than mis-label a normal completion as `approval_required`
 * and freeze the orchestration queue indefinitely. The classifier
 * therefore returns `null` for any event that isn't an explicit
 * approval / input / elicitation / stall-after-input / rejection
 * signal.
 *
 * Shape mirrors the symphony approach (label keyword search) without
 * coupling to a specific CLI's event vocabulary. Provider drivers
 * adapt their events into this shape before classification.
 */
export interface BlockingEvent {
	kind:
		| "permission_request"
		| "user_input_required"
		| "elicitation"
		| "provider_rejected"
		| "stall"
		| "tool_call_start"
		| "tool_call_end";
	label?: string;
	reason?: string;
	/** When kind === "stall", an earlier timestamp at which we asked
	 * the user for input. Together they trigger
	 * `stalled_after_input_request`. */
	priorInputRequestAt?: number;
}

export function classifyBlocked(ev: BlockingEvent): BlockedSnapshot | null {
	const now = Date.now();
	switch (ev.kind) {
		case "permission_request":
			return { reason: "approval_required", since: now, detail: ev.label };
		case "user_input_required":
			return { reason: "user_input_required", since: now, detail: ev.label };
		case "elicitation":
			return { reason: "mcp_elicitation", since: now, detail: ev.label };
		case "provider_rejected":
			return { reason: "provider_rejected", since: now, detail: ev.reason };
		case "stall":
			if (ev.priorInputRequestAt !== undefined) {
				return {
					reason: "stalled_after_input_request",
					since: now,
					detail: `priorInputAt=${ev.priorInputRequestAt}`,
				};
			}
			return null;
		default:
			return null;
	}
}

// ---------------------------------------------------------------------
// G7.5.A.5 — RunTransition: unified state-mutation payload
// ---------------------------------------------------------------------

/**
 * A state-machine transition that the dispatcher applies as a single
 * unit. The `state` field is `RunState` for the primary claim states
 * plus the secondary `"blocked"` tag (G5.B.3) for tasks parked awaiting
 * operator input. When `state === "blocked"`, the `blockedReason` and
 * `blockedSince` fields MUST be present so the reconciler's blocked-
 * aging pass can escalate stuck inputs.
 *
 * The shape mirrors the optional fields on `BlockedInstruction` in
 * `reconciler.ts` (`blockedSince`, `blockedReason`) so a transition
 * applied to disk doesn't need a separate translation step.
 *
 * G7.5.A.5: introduced when wiring the `classifyBlocked` classifier
 * through the protocol event handler — provider events with
 * `kind: "blocked"` now flow `ProtocolEvent` → `BlockingEvent` →
 * `BlockedSnapshot` → `RunTransition` and the resulting transition
 * carries the specific `BlockedReason` for retry decisioning.
 */
export interface RunTransition {
	state: RunState | "blocked";
	/** Set when `state === "blocked"`. */
	blockedReason?: BlockedReason;
	/** Epoch ms of the block start (set when `state === "blocked"`). */
	blockedSince?: number;
	/** Optional provenance string. */
	detail?: string;
}
