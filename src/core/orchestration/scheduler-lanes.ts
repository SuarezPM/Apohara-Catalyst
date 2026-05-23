/**
 * Scheduler lanes — agentrail hallazgo 6 (G5.B.5) + hallazgo 5 (G5.B.6).
 *
 * The legacy scheduler picked the next task by `ts ASC` alone (see
 * `tasks.ts:listReadyTasks`). That conflates four very different
 * priority classes:
 *
 *   1. `resume_in_progress`    — a worker died mid-task. Resume
 *                                BEFORE starting anything new; the
 *                                user is mid-flow and losing that
 *                                context is the worst UX.
 *   2. `retry_after_feedback`  — a blocked task got fresh user input.
 *                                Re-enter ahead of new starts; that
 *                                user typed an answer and is waiting
 *                                for the agent to react.
 *   3. `start_new`             — the default for a freshly-decomposed
 *                                task. Plenty of these; they're the
 *                                bulk lane.
 *   4. `setup_verification`    — the `LOCAL-SETUP-001` lane (G5.B.6).
 *                                Lowest priority — runs only when no
 *                                normal-runnable work is available so
 *                                a verification idle loop never
 *                                steals worktree slots from real work.
 *
 * Within a lane, ties break by user-supplied priority then deadline
 * then mtime then id — the exact agentrail ordering.
 *
 * This module is pure value-domain — it doesn't touch the
 * orchestration DB. Callers extract lane membership from their domain
 * rows (see `classifyLane`) and feed `LaneCandidate[]` into
 * `pickNextTask`.
 */

export type SchedulerLane =
	| "resume_in_progress"
	| "retry_after_feedback"
	| "start_new"
	| "setup_verification";

export const SCHEDULER_LANES = [
	"resume_in_progress",
	"retry_after_feedback",
	"start_new",
	"setup_verification",
] as const satisfies readonly SchedulerLane[];

const LANE_RANK: Record<SchedulerLane, number> = {
	resume_in_progress: 0,
	retry_after_feedback: 1,
	start_new: 2,
	setup_verification: 3,
};

export type LanePriority = "urgent" | "high" | "normal" | "low";

const PRIORITY_RANK: Record<LanePriority, number> = {
	urgent: 0,
	high: 1,
	normal: 2,
	low: 3,
};

export interface LaneCandidate {
	id: string;
	lane: SchedulerLane;
	priority: LanePriority;
	/** Epoch ms when the task is due. `null` = no deadline. */
	dueAt: number | null;
	/** Epoch ms last touched. */
	updatedAt: number;
}

export interface LaneClassification {
	id: string;
	status: string;
	/** Worker liveness probe — set by the reconciler when a row's
	 * claimed worker dies before producing a result. */
	hadWorkerDeath: boolean;
	/** True for LOCAL-SETUP-* identifiers (see
	 * `setup-verification.ts::SETUP_TASK_ID`). */
	isSetupVerification: boolean;
	/** Set when the orchestrator records that the operator answered a
	 * blocked task between the last tick and this one. */
	receivedUserInputAfterBlock: boolean;
}

/**
 * Map a domain row into the lane it belongs to. The classification is
 * disjunctive — first match wins, in priority order:
 *
 *   hadWorkerDeath               → resume_in_progress
 *   receivedUserInputAfterBlock  → retry_after_feedback
 *   isSetupVerification          → setup_verification
 *   else                         → start_new
 */
export function classifyLane(row: LaneClassification): SchedulerLane {
	if (row.hadWorkerDeath) return "resume_in_progress";
	if (row.receivedUserInputAfterBlock) return "retry_after_feedback";
	if (row.isSetupVerification) return "setup_verification";
	return "start_new";
}

/**
 * Sort comparator producing the (lane, priority, dueAt, updatedAt, id)
 * ordering. Returns negative if `a` precedes `b`, positive otherwise.
 * Stable enough for `Array.prototype.sort` use.
 */
export function compareTasksByLane(a: LaneCandidate, b: LaneCandidate): number {
	const laneDiff = LANE_RANK[a.lane] - LANE_RANK[b.lane];
	if (laneDiff !== 0) return laneDiff;

	const prioDiff = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
	if (prioDiff !== 0) return prioDiff;

	// dueAt: `null` (no deadline) loses to a real deadline.
	const aDue = a.dueAt ?? Number.POSITIVE_INFINITY;
	const bDue = b.dueAt ?? Number.POSITIVE_INFINITY;
	if (aDue !== bDue) return aDue - bDue;

	if (a.updatedAt !== b.updatedAt) return a.updatedAt - b.updatedAt;

	return a.id.localeCompare(b.id);
}

/**
 * Return the head of the pool sorted by `compareTasksByLane`, or null
 * for an empty pool. The implementation copies the input (no in-place
 * mutation) and runs a single linear pass — O(n) — rather than a full
 * sort, because callers ever need only the top candidate.
 */
export function pickNextTask(
	pool: readonly LaneCandidate[],
): LaneCandidate | null {
	if (pool.length === 0) return null;
	let best = pool[0]!;
	for (let i = 1; i < pool.length; i++) {
		const c = pool[i]!;
		if (compareTasksByLane(c, best) < 0) best = c;
	}
	return best;
}

// ---------------------------------------------------------------------
// G5.B.6 — Setup task lane bridge (agentrail #5 PARCIAL → COMPLETO)
// ---------------------------------------------------------------------

const SETUP_VERIFICATION_PREFIX = "LOCAL-SETUP-";

/**
 * Pure predicate: `true` for task ids generated by the
 * setup-verification subsystem (`LOCAL-SETUP-001` and friends). Used
 * by the lane classifier to map setup work into the lowest-priority
 * lane so verification cycles never starve real work.
 *
 * Case-sensitive on purpose — symphony / agentrail both treat the
 * prefix as a SQL-friendly literal and the existing `SETUP_TASK_ID`
 * constant in `setup-verification.ts` is upper-case.
 */
export function isSetupVerificationId(id: string): boolean {
	return id.startsWith(SETUP_VERIFICATION_PREFIX);
}

/**
 * Bridge from a "minimal task row" (id + status + recovery flags) to
 * a full LaneClassification + resolved lane. The `isSetupVerification`
 * field is filled by `isSetupVerificationId` so callers don't have to
 * remember to set it.
 *
 * The returned shape also exposes the `lane` so callers can short-
 * circuit to the lane without re-calling `classifyLane`.
 */
export interface SetupLaneInput {
	id: string;
	status: string;
	hadWorkerDeath: boolean;
	receivedUserInputAfterBlock: boolean;
}

export interface SetupLaneOutput extends LaneClassification {
	lane: SchedulerLane;
}

export function classifySetupLaneFor(
	row: SetupLaneInput,
): SetupLaneOutput {
	const classification: LaneClassification = {
		id: row.id,
		status: row.status,
		hadWorkerDeath: row.hadWorkerDeath,
		isSetupVerification: isSetupVerificationId(row.id),
		receivedUserInputAfterBlock: row.receivedUserInputAfterBlock,
	};
	return { ...classification, lane: classifyLane(classification) };
}
