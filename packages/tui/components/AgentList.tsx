import { Box, Text } from "ink";
import React, { useMemo } from "react";
import type { ProviderId } from "../../../src/core/types.ts";
import { useActiveRun } from "../hooks/useDashboard.tsx";
import { useResponsiveMode } from "../hooks/useResponsiveMode.tsx";

export interface AgentListProps {
	/** Override to force a specific responsive mode */
	mode?: "normal" | "compact" | "minimal";
}

interface AgentTaskInfo {
	provider: ProviderId;
	currentTask?: string;
	elapsedMs?: number;
}

function formatElapsed(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${Math.floor(ms / 1000)}s`;
	const m = Math.floor(ms / 60000);
	const s = Math.floor((ms % 60000) / 1000);
	return `${m}m ${s}s`;
}

/**
 * Renders active agents with their current task and elapsed time.
 */
export function AgentList({ mode: modeProp }: AgentListProps) {
	const activeRun = useActiveRun();
	const mode = modeProp ?? useResponsiveMode();

	const agents = useMemo<AgentTaskInfo[]>(() => {
		if (!activeRun) return [];

		const agentMap = new Map<ProviderId, AgentTaskInfo>();
		const now = Date.now();

		for (const event of activeRun.events) {
			const provider = event.metadata?.provider as ProviderId | undefined;
			if (!provider) continue;

			let currentTask: string | undefined;
			let elapsedMs: number | undefined;

			if (event.taskId) {
				currentTask =
					event.payload.description &&
					typeof event.payload.description === "string"
						? event.payload.description
						: event.taskId;
			}

			if (event.timestamp) {
				elapsedMs = now - new Date(event.timestamp).getTime();
			}

			agentMap.set(provider, {
				provider,
				currentTask,
				elapsedMs,
			});
		}

		return Array.from(agentMap.values());
	}, [activeRun]);

	if (mode === "minimal") {
		return (
			<Box flexDirection="column">
				<Text dimColor>
					Agents: {agents.length > 0 ? agents.length : "Sin agentes activos"}
				</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginTop={1}>
			<Box marginBottom={1}>
				<Text bold>Agentes Activos</Text>
			</Box>
			{agents.length === 0 ? (
				<Text dimColor>Sin agentes activos</Text>
			) : (
				agents.map((agent) => (
					<Box key={agent.provider}>
						<Text>● {agent.provider}</Text>
						{mode === "normal" && agent.currentTask && (
							<Text dimColor>
								{" — "}
								{agent.currentTask.length > 30
									? agent.currentTask.slice(0, 30) + "..."
									: agent.currentTask}
							</Text>
						)}
						{agent.elapsedMs !== undefined && (
							<Text dimColor> ({formatElapsed(agent.elapsedMs)})</Text>
						)}
					</Box>
				))
			)}
		</Box>
	);
}
