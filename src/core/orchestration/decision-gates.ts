/**
 * decision_gates table CRUD per spec §3.6.
 *
 * Each gate is an edge in the blocking matrix the coordinator builds
 * when two ready tasks have semantic overlap (writes ∩ reads/writes).
 * Open gates exclude `task_id_blocked` from `listReadyTasks`; resolving
 * all gates that point to a finished task is how completion cascades
 * unblock dependents.
 *
 * Schema enum is `open|resolved` only (no `expired`) — defense in depth
 * via SQLite CHECK matches the TS literal type.
 */
import type { OrchestrationDb } from "./db";

export interface GateInput {
	taskIdBlocked: string;
	taskIdBlocking: string;
	reason: string;
	overlapSymbols: unknown[];
}

export interface OpenGate {
	id: number;
	taskIdBlocked: string;
	taskIdBlocking: string;
	reason: string;
}

export function openGate(db: OrchestrationDb, input: GateInput): number {
	const info = db
		.raw()
		.prepare(`
			INSERT INTO decision_gates
				(task_id_blocked, task_id_blocking, reason, overlap_symbols, status, opened_at)
			VALUES (?, ?, ?, ?, 'open', ?)
		`)
		.run(
			input.taskIdBlocked,
			input.taskIdBlocking,
			input.reason,
			JSON.stringify(input.overlapSymbols),
			Date.now(),
		);
	return Number(info.lastInsertRowid);
}

export function resolveGate(db: OrchestrationDb, id: number): void {
	db.raw()
		.prepare(
			`UPDATE decision_gates SET status = 'resolved', resolved_at = ? WHERE id = ?`,
		)
		.run(Date.now(), id);
}

/**
 * Resolve every open gate whose `task_id_blocking` is the given task.
 * Returns the list of `task_id_blocked` values that just transitioned
 * from blocked → potentially-ready, so the scheduler can re-evaluate
 * them in a cascade after a task completes.
 */
export function resolveAllBlockingTask(
	db: OrchestrationDb,
	taskIdBlocking: string,
): string[] {
	const open = db
		.raw()
		.query(
			`SELECT id, task_id_blocked FROM decision_gates WHERE task_id_blocking = ? AND status = 'open'`,
		)
		.all(taskIdBlocking) as Array<{ id: number; task_id_blocked: string }>;

	if (open.length === 0) return [];

	const ids = open.map((r) => r.id);
	const placeholders = ids.map(() => "?").join(",");
	db.raw()
		.prepare(
			`UPDATE decision_gates SET status = 'resolved', resolved_at = ? WHERE id IN (${placeholders})`,
		)
		.run(Date.now(), ...ids);

	return open.map((r) => r.task_id_blocked);
}

export function listOpenGates(db: OrchestrationDb): OpenGate[] {
	const rows = db
		.raw()
		.query(
			`SELECT id, task_id_blocked, task_id_blocking, reason FROM decision_gates WHERE status = 'open' ORDER BY id ASC`,
		)
		.all() as Array<{
		id: number;
		task_id_blocked: string;
		task_id_blocking: string;
		reason: string;
	}>;

	return rows.map((r) => ({
		id: r.id,
		taskIdBlocked: r.task_id_blocked,
		taskIdBlocking: r.task_id_blocking,
		reason: r.reason,
	}));
}
