/**
 * chorus hallazgo 15 — maxRounds + escalation (G5.B.7).
 *
 * Verification pipelines (critic / judge / re-coding) can loop
 * forever if the AC never converges — provider tokens burn in a tight
 * loop. chorus introduces an explicit `max_verify_rounds` cap per DAG
 * node + an `ESCALATED` terminal state.
 *
 * Once a tracker is `exhausted` (round reached max), the caller has
 * two choices: `markEscalated(tracker)` to surface the unfinished
 * work to the operator (chorus pattern), or close the task as failed
 * and let dependents that don't read its output continue (Apohara
 * default — see decision-gates.ts).
 *
 * Pure value module — zero I/O. Orchestration migrations carry
 * `round` + `maxRounds` per task; the chorus state machine then maps
 * `roundOutcome` into a TaskStatus.
 */

export interface VerificationRoundTracker {
	round: number;
	maxRounds: number;
	escalated: boolean;
}

export interface NewRoundOptions {
	maxRounds?: number;
}

const DEFAULT_MAX_ROUNDS = 3;

export function newVerificationRound(
	opts: NewRoundOptions,
): VerificationRoundTracker {
	const max = opts.maxRounds ?? DEFAULT_MAX_ROUNDS;
	return { round: 0, maxRounds: max, escalated: false };
}

/**
 * Increment the round counter. Refuses to advance past `maxRounds`:
 * once exhausted, the caller is expected to escalate or stop. Silently
 * dropping further advances flags a bug at the test layer rather than
 * letting verification spin.
 */
export function advanceRound(
	t: VerificationRoundTracker,
): VerificationRoundTracker {
	if (t.round >= t.maxRounds) return t; // exhausted — no-op
	return { ...t, round: t.round + 1 };
}

export function isExhausted(t: VerificationRoundTracker): boolean {
	return t.round >= t.maxRounds;
}

export function markEscalated(
	t: VerificationRoundTracker,
): VerificationRoundTracker {
	return { ...t, escalated: true };
}

export type RoundOutcome = "in_progress" | "exhausted" | "escalated";

export function roundOutcome(t: VerificationRoundTracker): RoundOutcome {
	if (t.escalated) return "escalated";
	if (isExhausted(t)) return "exhausted";
	return "in_progress";
}
