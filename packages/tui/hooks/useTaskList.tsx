import { useMemo } from "react";
import type { EventLog } from "../types.ts";
import { useActiveRun } from "./useDashboard.tsx";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";

export interface TaskItem {
	id: string;
	description: string;
	status: TaskStatus;
	role?: string;
}

export interface TaskListResult {
	tasks: TaskItem[];
	counts: Record<TaskStatus, number>;
}

const TASK_EVENT_TYPES = ["task_scheduled", "task_completed", "task_failed"];

function getStatusFromEventType(type: string): TaskStatus {
	switch (type) {
		case "task_scheduled":
			return "pending";
		case "task_completed":
			return "completed";
		case "task_failed":
			return "failed";
		default:
			return "pending";
	}
}

export function extractTasks(events: EventLog[]): TaskItem[] {
	// Track latest state per taskId
	const taskMap = new Map<string, TaskItem>();

	for (const event of events) {
		if (!TASK_EVENT_TYPES.includes(event.type)) continue;
		if (!event.taskId) continue;

		const description =
			event.payload.description && typeof event.payload.description === "string"
				? event.payload.description
				: event.payload.name && typeof event.payload.name === "string"
					? event.payload.name
					: event.type;

		const role =
			event.metadata?.role && typeof event.metadata.role === "string"
				? event.metadata.role
				: undefined;

		// If a task was previously completed but re-scheduled, it's now pending again
		taskMap.set(event.taskId, {
			id: event.taskId,
			description,
			status: getStatusFromEventType(event.type),
			role,
		});
	}

	return Array.from(taskMap.values());
}

/**
 * Extracts and aggregates task information from the active run's events.
 * Returns a sorted list of tasks and counts per status.
 */
export function useTaskList(): TaskListResult {
	const activeRun = useActiveRun();

	return useMemo(() => {
		const events = activeRun?.events ?? [];
		const tasks = extractTasks(events);

		const counts: Record<TaskStatus, number> = {
			pending: 0,
			in_progress: 0,
			completed: 0,
			failed: 0,
		};

		for (const task of tasks) {
			counts[task.status]++;
		}

		return { tasks, counts };
	}, [activeRun]);
}
