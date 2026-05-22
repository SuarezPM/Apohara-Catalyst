/**
 * Shared task store per spec §4 — same store backs the DAG canvas
 * (SwarmCanvas) AND the TaskBoard kanban view. Both views render from
 * `tasksAtom` so the two surfaces never drift.
 *
 * - `tasksAtom`            : root keyed by task id
 * - `tasksByStatusAtom`    : derived view grouped by the 7 spec statuses
 * - `upsertTaskAtom`       : write helper — inserts or replaces
 * - `removeTaskAtom`       : write helper — drops the task by id
 *
 * Status order matters: it's the left→right column order rendered by
 * TaskBoard, so keep `pending → blocked` as defined here.
 */
// Import from `jotai/vanilla` (not `jotai`) so this module stays React-free
// and can be unit-tested headlessly with bun:test + jotai/vanilla's
// `createStore`. The selector hook (`use-taskboard-store.ts`) is the only
// surface that pulls `jotai/react`.
import { atom } from "jotai/vanilla";

export type TaskStatus =
	| "pending"
	| "ready"
	| "dispatched"
	| "in_verification"
	| "done"
	| "failed"
	| "blocked";

export const ALL_STATUSES: readonly TaskStatus[] = [
	"pending",
	"ready",
	"dispatched",
	"in_verification",
	"done",
	"failed",
	"blocked",
] as const;

export interface DagTask {
	id: string;
	title: string;
	status: TaskStatus;
	agentRole?:
		| "planner"
		| "coder"
		| "critic"
		| "judge"
		| "explorer"
		| "editor";
	providerId?: "claude-code-cli" | "codex-cli" | "opencode-go";
	worktreeSlug?: string;
	durationMs?: number;
	costUsd?: number;
	tokensIn?: number;
	tokensOut?: number;
	blockedReason?: string;
	waitingForTaskId?: string;
	overlapSymbols?: string[];
}

/** Root atom: Map<TaskId, DagTask>. */
export const tasksAtom = atom<Record<string, DagTask>>({});

/** Derived: tasks grouped by status, one bucket per `ALL_STATUSES` entry. */
export const tasksByStatusAtom = atom((get) => {
	const tasks = get(tasksAtom);
	const grouped: Record<TaskStatus, DagTask[]> = {
		pending: [],
		ready: [],
		dispatched: [],
		in_verification: [],
		done: [],
		failed: [],
		blocked: [],
	};
	for (const task of Object.values(tasks)) {
		const bucket = grouped[task.status];
		if (bucket) bucket.push(task);
	}
	return grouped;
});

/** Insert or replace a task keyed by `task.id`. */
export const upsertTaskAtom = atom(null, (get, set, task: DagTask) => {
	const current = get(tasksAtom);
	set(tasksAtom, { ...current, [task.id]: task });
});

/** Remove a task by id; no-op if it doesn't exist. */
export const removeTaskAtom = atom(null, (get, set, taskId: string) => {
	const current = get(tasksAtom);
	if (!(taskId in current)) return;
	const { [taskId]: _removed, ...rest } = current;
	set(tasksAtom, rest);
});
