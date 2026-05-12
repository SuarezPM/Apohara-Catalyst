import { Box, Text } from "ink";
import React, { useMemo } from "react";
import { useActiveRun } from "../hooks/useDashboard.tsx";
import { useResponsiveMode } from "../hooks/useResponsiveMode.tsx";
import type { TaskStatus } from "../hooks/useTaskList.tsx";
import type { EventLog, ResponsiveMode } from "../types.ts";

const FILE_EVENT_TYPES = ["file_modified", "file_created", "file_deleted"];

const STATUS_ICON: Record<TaskStatus, string> = {
	pending: "⏳",
	in_progress: "🔄",
	completed: "✅",
	failed: "❌",
};

const STATUS_COLOR: Record<TaskStatus, string> = {
	pending: "blue",
	in_progress: "yellow",
	completed: "green",
	failed: "red",
};

export interface AgentBlock {
	taskId: string;
	description: string;
	status: TaskStatus;
	files: string[];
	provider?: string;
}

export interface SwarmBlocksProps {
	/** Override to force a specific responsive mode */
	mode?: ResponsiveMode;
	/** Maximum number of agent blocks to show (default: no limit) */
	maxItems?: number;
}

/**
 * Extracts agent blocks with their associated files from event log.
 * Maps taskId -> files[] by scanning file_* events, and derives
 * agent status/description/provider from task lifecycle events.
 */
export function extractAgentBlocks(events: EventLog[]): AgentBlock[] {
	const taskMeta = new Map<
		string,
		{ description: string; status: TaskStatus; provider?: string }
	>();
	const taskFiles = new Map<string, Set<string>>();

	for (const event of events) {
		if (!event.taskId) continue;

		// Track task lifecycle for status + description
		if (event.type === "task_scheduled") {
			const desc =
				typeof event.payload.description === "string"
					? event.payload.description
					: typeof event.payload.name === "string"
						? event.payload.name
						: event.taskId;
			const provider =
				typeof event.metadata?.provider === "string"
					? event.metadata.provider
					: undefined;
			taskMeta.set(event.taskId, {
				description: desc,
				status: "pending",
				provider,
			});
		} else if (event.type === "task_started") {
			const existing = taskMeta.get(event.taskId);
			if (existing) {
				existing.status = "in_progress";
			} else {
				taskMeta.set(event.taskId, {
					description: event.taskId,
					status: "in_progress",
				});
			}
		} else if (event.type === "task_completed") {
			const existing = taskMeta.get(event.taskId);
			if (existing) {
				existing.status = "completed";
			}
		} else if (event.type === "task_failed") {
			const existing = taskMeta.get(event.taskId);
			if (existing) {
				existing.status = "failed";
			}
		}

		// Track file events
		if (FILE_EVENT_TYPES.includes(event.type)) {
			const filePath =
				(typeof event.payload.filePath === "string" &&
					event.payload.filePath) ||
				(typeof event.payload.path === "string" && event.payload.path) ||
				undefined;
			if (filePath) {
				if (!taskFiles.has(event.taskId)) {
					taskFiles.set(event.taskId, new Set());
				}
				taskFiles.get(event.taskId)!.add(filePath);
			}
		}
	}

	// Build blocks — include tasks with files, or tasks that are in_progress/failed
	const blocks: AgentBlock[] = [];
	const allTaskIds = new Set([...taskFiles.keys(), ...taskMeta.keys()]);

	for (const taskId of allTaskIds) {
		const files = taskFiles.get(taskId);
		const meta = taskMeta.get(taskId);
		blocks.push({
			taskId,
			description: meta?.description ?? taskId,
			status: meta?.status ?? "pending",
			files: files ? Array.from(files).sort() : [],
			provider: meta?.provider,
		});
	}

	return blocks;
}

/**
 * Renders a grid of agent blocks showing which files each agent is touching.
 * Adapts to terminal width: compact shows file counts, minimal shows agent count only.
 */
export function SwarmBlocks({ mode: modeProp, maxItems }: SwarmBlocksProps) {
	const activeRun = useActiveRun();
	const mode = modeProp ?? useResponsiveMode();
	const events = activeRun?.events ?? [];

	const blocks = useMemo(() => extractAgentBlocks(events), [events]);
	const displayBlocks = maxItems ? blocks.slice(0, maxItems) : blocks;

	if (mode === "minimal") {
		return (
			<Box flexDirection="column">
				<Text dimColor>
					Swarm: {blocks.length} agent{blocks.length !== 1 ? "s" : ""},{" "}
					{blocks.reduce((sum, b) => sum + b.files.length, 0)} files
				</Text>
			</Box>
		);
	}

	if (blocks.length === 0) {
		return (
			<Box flexDirection="column" marginTop={1}>
				<Box marginBottom={1}>
					<Text bold>Swarm Blocks</Text>
				</Box>
				<Text dimColor>No file activity yet</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginTop={1}>
			<Box marginBottom={1}>
				<Text bold>Swarm Blocks</Text>
				<Text dimColor>
					{" "}
					({blocks.length} agent{blocks.length !== 1 ? "s" : ""},{" "}
					{blocks.reduce((sum, b) => sum + b.files.length, 0)} files)
				</Text>
			</Box>
			{displayBlocks.map((block) => (
				<AgentBlockView key={block.taskId} block={block} mode={mode} />
			))}
		</Box>
	);
}

function AgentBlockView({
	block,
	mode,
}: {
	block: AgentBlock;
	mode: "normal" | "compact";
}) {
	// Compact mode — single line per agent
	if (mode === "compact") {
		return (
			<Box>
				<Text color={STATUS_COLOR[block.status]}>
					{STATUS_ICON[block.status]}{" "}
				</Text>
				<Text>
					{block.taskId}
					{block.provider && <Text dimColor> ({block.provider})</Text>}
				</Text>
				<Text dimColor>
					{" "}
					— {block.files.length} file{block.files.length !== 1 ? "s" : ""}
				</Text>
			</Box>
		);
	}

	// Normal mode — full bordered block with file list
	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text>
				┌─ Agent: <Text bold>{block.taskId}</Text>
				{block.provider && <Text dimColor> ({block.provider})</Text>}
				{" ─┐"}
			</Text>
			<Box>
				<Text>│ Status: </Text>
				<Text color={STATUS_COLOR[block.status]}>
					{STATUS_ICON[block.status]} {block.status}
				</Text>
			</Box>
			{block.files.length > 0 ? (
				<Box flexDirection="column">
					<Text>│ Files:</Text>
					{block.files.map((file) => (
						<Text key={file}>
							<Text dimColor>│ </Text>
							{file}
						</Text>
					))}
				</Box>
			) : (
				<Text dimColor>│ No files yet</Text>
			)}
			<Text>└─────────────────────────────────┘</Text>
		</Box>
	);
}
