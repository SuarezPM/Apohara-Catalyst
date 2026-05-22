/**
 * tasks table CRUD per spec §3.6.
 */
import type { OrchestrationDb } from "./db";

export type TaskStatus = "pending" | "ready" | "dispatched" | "completed" | "failed" | "blocked";

const VALID_STATUSES: TaskStatus[] = ["pending", "ready", "dispatched", "completed", "failed", "blocked"];

export interface TaskSpec {
	description: string;
	agentRole: "planner" | "coder" | "critic" | "judge";
	symbols: {
		reads: unknown[];
		writes: unknown[];
		renames: unknown[];
	};
}

export interface TaskInput {
	id: string;
	parentId?: string;
	createdByTerminalHandle?: string;
	spec: TaskSpec;
	deps: string[];
}

export interface TaskRow {
	id: string;
	parentId: string | null;
	createdByTerminalHandle: string | null;
	spec: TaskSpec;
	status: TaskStatus;
	deps: string[];
	result: unknown;
	completedAt: number | null;
	ts: number;
}

export function insertTask(db: OrchestrationDb, input: TaskInput): void {
	db.raw().prepare(`
		INSERT INTO tasks (id, parent_id, created_by_terminal_handle, spec, status, deps, result, completed_at, ts)
		VALUES (?, ?, ?, ?, 'pending', ?, NULL, NULL, ?)
	`).run(
		input.id,
		input.parentId ?? null,
		input.createdByTerminalHandle ?? null,
		JSON.stringify(input.spec),
		JSON.stringify(input.deps),
		Date.now(),
	);
}

export function updateTaskStatus(db: OrchestrationDb, id: string, status: TaskStatus, result?: unknown): void {
	if (!VALID_STATUSES.includes(status)) {
		throw new Error(`invalid status: ${status}`);
	}
	const completedAt = (status === "completed" || status === "failed") ? Date.now() : null;
	db.raw().prepare(`UPDATE tasks SET status = ?, result = ?, completed_at = ? WHERE id = ?`)
		.run(status, result === undefined ? null : JSON.stringify(result), completedAt, id);
}

export function listReadyTasks(db: OrchestrationDb): TaskRow[] {
	// Ready = pending AND all deps completed AND not blocked by an open decision_gate
	const sql = `
		SELECT id, parent_id, created_by_terminal_handle, spec, status, deps, result, completed_at, ts
		FROM tasks
		WHERE status = 'pending'
		  AND id NOT IN (SELECT task_id_blocked FROM decision_gates WHERE status = 'open')
		ORDER BY ts ASC
	`;
	const rows = db.raw().query(sql).all() as Array<{
		id: string;
		parent_id: string | null;
		created_by_terminal_handle: string | null;
		spec: string;
		status: string;
		deps: string;
		result: string | null;
		completed_at: number | null;
		ts: number;
	}>;

	// Filter by dep completion
	const completed = new Set(
		(db.raw().query("SELECT id FROM tasks WHERE status = 'completed'").all() as { id: string }[]).map(r => r.id)
	);

	return rows
		.map(r => ({
			id: r.id,
			parentId: r.parent_id,
			createdByTerminalHandle: r.created_by_terminal_handle,
			spec: JSON.parse(r.spec) as TaskSpec,
			status: r.status as TaskStatus,
			deps: JSON.parse(r.deps) as string[],
			result: r.result ? JSON.parse(r.result) : null,
			completedAt: r.completed_at,
			ts: r.ts,
		}))
		.filter(t => t.deps.every(d => completed.has(d)));
}
