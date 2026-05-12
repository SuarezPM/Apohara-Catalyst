import { renderHook } from "@testing-library/react";
import type React from "react";
import { describe, expect, it } from "vitest";
import type { EventLog, Run } from "../types.ts";
import { DashboardProvider, useActiveRun } from "./useDashboard.tsx";
import { type TaskItem, useTaskList } from "./useTaskList.tsx";

function wrapper({ children }: { children: React.ReactNode }) {
	return <DashboardProvider>{children}</DashboardProvider>;
}

const mockEvents: EventLog[] = [
	{
		id: "e1",
		timestamp: "2026-04-30T12:00:00Z",
		type: "task_scheduled",
		severity: "info",
		taskId: "task-1",
		payload: { description: "Research API design" },
		metadata: { role: "research" },
	},
	{
		id: "e2",
		timestamp: "2026-04-30T12:05:00Z",
		type: "task_scheduled",
		severity: "info",
		taskId: "task-2",
		payload: { description: "Implement auth" },
		metadata: { role: "execution" },
	},
	{
		id: "e3",
		timestamp: "2026-04-30T12:10:00Z",
		type: "task_completed",
		severity: "info",
		taskId: "task-1",
		payload: { description: "Research API design" },
		metadata: { role: "research" },
	},
	{
		id: "e4",
		timestamp: "2026-04-30T12:15:00Z",
		type: "task_failed",
		severity: "error",
		taskId: "task-3",
		payload: { description: "Deploy to prod" },
		metadata: { role: "execution" },
	},
];

const mockRun: Run = {
	id: "run-1",
	startedAt: "2026-04-30T12:00:00Z",
	events: mockEvents,
};

describe("useTaskList", () => {
	it("returns empty results when no active run", () => {
		const { result } = renderHook(() => useTaskList(), { wrapper });
		expect(result.current.tasks).toEqual([]);
		expect(result.current.counts).toEqual({
			pending: 0,
			in_progress: 0,
			completed: 0,
			failed: 0,
		});
	});

	it("extracts tasks and counts from active run events", () => {
		const { result } = renderHook(() => useTaskList(), {
			wrapper: ({ children }) => (
				<DashboardProvider initialRuns={[mockRun]}>
					{children}
				</DashboardProvider>
			),
		});

		expect(result.current.tasks).toHaveLength(3);
		expect(result.current.counts.pending).toBe(1); // task-2 still scheduled
		expect(result.current.counts.completed).toBe(1); // task-1 completed
		expect(result.current.counts.failed).toBe(1); // task-3 failed
		expect(result.current.counts.in_progress).toBe(0);
	});

	it("derives latest status when task events repeat", () => {
		const eventsWithRepeat: EventLog[] = [
			{
				id: "e1",
				timestamp: "2026-04-30T12:00:00Z",
				type: "task_scheduled",
				severity: "info",
				taskId: "task-1",
				payload: { description: "Test task" },
			},
			{
				id: "e2",
				timestamp: "2026-04-30T12:05:00Z",
				type: "task_completed",
				severity: "info",
				taskId: "task-1",
				payload: { description: "Test task" },
			},
			{
				id: "e3",
				timestamp: "2026-04-30T12:10:00Z",
				type: "task_scheduled",
				severity: "info",
				taskId: "task-1",
				payload: { description: "Test task rerun" },
			},
		];

		const run: Run = {
			id: "run-repeat",
			startedAt: "2026-04-30T12:00:00Z",
			events: eventsWithRepeat,
		};

		const { result } = renderHook(() => useTaskList(), {
			wrapper: ({ children }) => (
				<DashboardProvider initialRuns={[run]}>{children}</DashboardProvider>
			),
		});

		expect(result.current.tasks).toHaveLength(1);
		expect(result.current.tasks[0].status).toBe("pending");
		expect(result.current.tasks[0].description).toBe("Test task rerun");
	});

	it("uses event type as fallback description", () => {
		const events: EventLog[] = [
			{
				id: "e1",
				timestamp: "2026-04-30T12:00:00Z",
				type: "task_scheduled",
				severity: "info",
				taskId: "task-1",
				payload: {},
			},
		];

		const run: Run = {
			id: "run-fallback",
			startedAt: "2026-04-30T12:00:00Z",
			events,
		};

		const { result } = renderHook(() => useTaskList(), {
			wrapper: ({ children }) => (
				<DashboardProvider initialRuns={[run]}>{children}</DashboardProvider>
			),
		});

		expect(result.current.tasks[0].description).toBe("task_scheduled");
	});
});
