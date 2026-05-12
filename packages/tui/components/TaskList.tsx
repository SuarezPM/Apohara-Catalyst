import { Box, Text } from "ink";
import React, { useMemo } from "react";
import { useActiveRun } from "../hooks/useDashboard.tsx";
import { useResponsiveMode } from "../hooks/useResponsiveMode.tsx";
import { type TaskStatus, useTaskList } from "../hooks/useTaskList.tsx";
import type { EventLog } from "../types.ts";

const STATUS_ICON: Record<TaskStatus, string> = {
	pending: "⏳",
	in_progress: "🔄",
	completed: "✅",
	failed: "❌",
};

const STATUS_COLOR: Record<TaskStatus, string> = {
	pending: "gray",
	in_progress: "yellow",
	completed: "green",
	failed: "red",
};

export interface TaskListProps {
	/** Override to force a specific responsive mode */
	mode?: "normal" | "compact" | "minimal";
	/** Maximum number of tasks to show (default: no limit) */
	maxItems?: number;
}

function findTaskProvider(
	events: EventLog[],
	taskId: string,
): string | undefined {
	for (const event of events) {
		if (event.taskId === taskId && event.metadata?.provider) {
			return event.metadata.provider as string;
		}
	}
	return undefined;
}

function findTaskDuration(
	events: EventLog[],
	taskId: string,
): number | undefined {
	const startEvent = events.find(
		(e) =>
			e.taskId === taskId &&
			(e.type === "task_started" || e.type === "task_scheduled"),
	);
	const endEvent = events.find(
		(e) =>
			e.taskId === taskId &&
			(e.type === "task_completed" || e.type === "task_failed"),
	);
	if (startEvent && endEvent) {
		return (
			new Date(endEvent.timestamp).getTime() -
			new Date(startEvent.timestamp).getTime()
		);
	}
	return undefined;
}

function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
	const m = Math.floor(ms / 60000);
	const s = Math.floor((ms % 60000) / 1000);
	return `${m}m ${s}s`;
}

/**
 * Renders a list of tasks with status icons, provider, and duration.
 * Adapts to terminal width: minimal shows only counts.
 */
export function TaskList({ mode: modeProp, maxItems }: TaskListProps) {
	const { tasks, counts } = useTaskList();
	const activeRun = useActiveRun();
	const mode = modeProp ?? useResponsiveMode();

	const enrichedTasks = useMemo(() => {
		if (!activeRun)
			return tasks.map((t) => ({
				...t,
				provider: undefined,
				duration: undefined,
			}));
		return tasks.map((task) => ({
			...task,
			provider: findTaskProvider(activeRun.events, task.id),
			duration: findTaskDuration(activeRun.events, task.id),
		}));
	}, [tasks, activeRun]);

	if (mode === "minimal") {
		return (
			<Box flexDirection="column">
				<Text dimColor>
					Tasks: {counts.completed}/{tasks.length}
				</Text>
			</Box>
		);
	}

	const displayTasks = maxItems
		? enrichedTasks.slice(0, maxItems)
		: enrichedTasks;

	return (
		<Box flexDirection="column" marginTop={1}>
			<Box marginBottom={1}>
				<Text bold>Tasks</Text>
				<Text dimColor>
					{" "}
					({counts.completed}/{tasks.length})
				</Text>
			</Box>
			{displayTasks.length === 0 ? (
				<Text dimColor>No tasks yet</Text>
			) : (
				displayTasks.map((task) => (
					<Box key={task.id}>
						<Text color={STATUS_COLOR[task.status]}>
							{STATUS_ICON[task.status]}{" "}
						</Text>
						{mode === "compact" ? (
							<Text>
								{task.description.slice(0, 30)}
								{task.provider && <Text dimColor> ({task.provider})</Text>}
							</Text>
						) : (
							<>
								<Text>{task.description}</Text>
								{task.provider && <Text dimColor> ({task.provider})</Text>}
								{task.duration !== undefined && (
									<Text dimColor> [{formatDuration(task.duration)}]</Text>
								)}
								{task.role && <Text dimColor> [{task.role}]</Text>}
							</>
						)}
					</Box>
				))
			)}
		</Box>
	);
}
