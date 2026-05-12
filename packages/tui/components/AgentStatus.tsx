import { Box, Text } from "ink";
import React from "react";
import type { ProviderId } from "../../../src/core/types.ts";
import { useActiveRun } from "../hooks/useDashboard.tsx";
import { useResponsiveMode } from "../hooks/useResponsiveMode.tsx";

export interface AgentStatusProps {
	/** Override to force a specific responsive mode */
	mode?: "normal" | "compact" | "minimal";
}

interface AgentInfo {
	provider: ProviderId;
	modelName?: string;
	role?: string;
	lastSeen: string; // ISO timestamp
}

export function extractAgents(
	events: import("../../core/types.ts").EventLog[],
): {
	agents: AgentInfo[];
	fallbackCount: number;
	latestFallback?: { from: ProviderId; to: ProviderId; reason?: string };
} {
	const agentMap = new Map<ProviderId, AgentInfo>();
	let fallbackCount = 0;
	let latestFallback:
		| { from: ProviderId; to: ProviderId; reason?: string }
		| undefined;

	for (const event of events) {
		const provider = event.metadata?.provider;
		if (provider) {
			agentMap.set(provider, {
				provider,
				modelName: event.metadata?.modelName,
				role: event.metadata?.role,
				lastSeen: event.timestamp,
			});
		}

		if (event.type === "provider_fallback") {
			fallbackCount++;
			const from = event.metadata?.fromProvider;
			const to = event.metadata?.toProvider;
			if (from && to) {
				latestFallback = {
					from,
					to,
					reason: event.metadata?.errorReason,
				};
			}
		}
	}

	return {
		agents: Array.from(agentMap.values()),
		fallbackCount,
		latestFallback,
	};
}

/**
 * Renders active agents and provider fallback information.
 * Highlights fallback events with a warning indicator.
 */
export function AgentStatus({ mode: modeProp }: AgentStatusProps) {
	const activeRun = useActiveRun();
	const mode = modeProp ?? useResponsiveMode();
	const events = activeRun?.events ?? [];
	const { agents, fallbackCount, latestFallback } = extractAgents(events);

	if (mode === "minimal") {
		return (
			<Box flexDirection="column">
				<Text dimColor>
					Agents: {agents.length}
					{fallbackCount > 0 && (
						<Text color="yellow"> ⚠ {fallbackCount} fallback</Text>
					)}
				</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			<Box marginBottom={1}>
				<Text bold>Active Agents</Text>
				{fallbackCount > 0 && (
					<Box marginLeft={2}>
						<Text color="yellow">⚠ {fallbackCount} fallback(s)</Text>
					</Box>
				)}
			</Box>
			{agents.length === 0 ? (
				<Text dimColor>No agents active</Text>
			) : (
				agents.map((agent) => (
					<Box key={agent.provider}>
						<Text>● {agent.provider}</Text>
						{mode === "normal" && agent.modelName && (
							<Text dimColor> ({agent.modelName})</Text>
						)}
						{agent.role && <Text dimColor> [{agent.role}]</Text>}
					</Box>
				))
			)}
			{latestFallback && (
				<Box marginTop={1}>
					<Text color="yellow">
						↳ fallback: {latestFallback.from} → {latestFallback.to}
						{latestFallback.reason && ` (${latestFallback.reason})`}
					</Text>
				</Box>
			)}
		</Box>
	);
}
