/**
 * dispatch_contexts table CRUD per spec §3.6.
 *
 * One row per dispatch attempt: durable record of which agent handle
 * received which preamble for which task, plus lifecycle status. The
 * `countRecentFailedDispatches` helper is the substrate for the
 * circuit breaker landing in Task 2.16 (consecutive-failures cap).
 */
import type { OrchestrationDb } from "./db";

export type DispatchStatus =
	| "spawning"
	| "running"
	| "completed"
	| "failed"
	| "aborted";

const TERMINAL_STATUSES: DispatchStatus[] = ["completed", "failed", "aborted"];
const VALID_STATUSES: DispatchStatus[] = [
	"spawning",
	"running",
	"completed",
	"failed",
	"aborted",
];

export interface DispatchInput {
	taskId: string;
	agentHandle: string;
	worktreeId?: string;
	preamble: string;
}

export function insertDispatchContext(
	db: OrchestrationDb,
	input: DispatchInput,
): number {
	const now = Date.now();
	const info = db
		.raw()
		.prepare(`
			INSERT INTO dispatch_contexts
				(task_id, agent_handle, worktree_id, preamble, status, started_at, ts)
			VALUES (?, ?, ?, ?, 'spawning', ?, ?)
		`)
		.run(
			input.taskId,
			input.agentHandle,
			input.worktreeId ?? null,
			input.preamble,
			now,
			now,
		);
	return Number(info.lastInsertRowid);
}

export function updateDispatchStatus(
	db: OrchestrationDb,
	id: number,
	status: DispatchStatus,
): void {
	if (!VALID_STATUSES.includes(status)) {
		throw new Error(`invalid dispatch status: ${status}`);
	}
	const completedAt = TERMINAL_STATUSES.includes(status) ? Date.now() : null;
	db.raw()
		.prepare(
			`UPDATE dispatch_contexts SET status = ?, completed_at = ? WHERE id = ?`,
		)
		.run(status, completedAt, id);
}

/**
 * Count failed dispatches for `taskId` strictly after the most recent
 * successful completion. Zero successes ⇒ counts every failed attempt.
 * Used by the circuit breaker (Task 2.16) to decide when to stop
 * retrying a doomed task.
 *
 * Uses the AUTOINCREMENT `id` (strictly monotonic) instead of
 * `started_at` to avoid same-millisecond ties when dispatches happen
 * back-to-back — `Date.now()` resolution on hot loops can collide.
 */
export function countRecentFailedDispatches(
	db: OrchestrationDb,
	taskId: string,
): number {
	const lastCompletedId = (
		db
			.raw()
			.query(
				`SELECT COALESCE(MAX(id), 0) AS i FROM dispatch_contexts WHERE task_id = ? AND status = 'completed'`,
			)
			.get(taskId) as { i: number }
	).i;

	const row = db
		.raw()
		.query(
			`SELECT COUNT(*) AS c FROM dispatch_contexts WHERE task_id = ? AND status = 'failed' AND id > ?`,
		)
		.get(taskId, lastCompletedId) as { c: number };

	return row.c;
}
