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
 */

export type RunState =
	| "unclaimed"
	| "claimed"
	| "running"
	| "retry_queued"
	| "released";

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
