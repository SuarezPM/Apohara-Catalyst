/**
 * useTaskBoardStore — selector hook over `dagStore`.
 *
 * Both TaskBoard (kanban) and SwarmCanvas (DAG) read from the same
 * atoms (spec §4 rule: one source of truth per task).
 */
import { useAtomValue } from "jotai/react";
import {
	ALL_STATUSES,
	type DagTask,
	type TaskStatus,
	tasksAtom,
	tasksByStatusAtom,
} from "./dagStore.js";

export function useTaskBoardStore() {
	const tasks = useAtomValue(tasksAtom);
	const tasksByStatus = useAtomValue(tasksByStatusAtom);
	return { tasks, tasksByStatus, statuses: ALL_STATUSES };
}

export { ALL_STATUSES };
export type { DagTask, TaskStatus };
