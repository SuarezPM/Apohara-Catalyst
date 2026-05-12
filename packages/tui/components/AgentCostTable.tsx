import { Box, Text } from "ink";
import React, { useMemo } from "react";
import { useActiveRun } from "../hooks/useDashboard.tsx";
import { useResponsiveMode } from "../hooks/useResponsiveMode.tsx";
import type { EventLog } from "../types.ts";

export type TaskStatus = "pending" | "in_progress" | "completed" | "failed";

export interface AgentCostRow {
	taskId: string;
	description: string;
	status: TaskStatus;
	provider?: string;
	costUsd: number;
	tokensTotal: number;
}

export interface AgentCostTableProps {
	/** Override to force a specific responsive mode */
	mode?: "normal" | "compact" | "minimal";
}

function formatCost(cost: number): string {
	return `$${cost.toFixed(4)}`;
}

function formatTokens(n: number): string {
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
	return n.toString();
}

/**
 * Extract per-agent (taskId) cost rows from an event log.
 * Aggregates cost/tokens, derives latest status and provider.
 */
export function extractAgentCosts(events: EventLog[]): AgentCostRow[] {
	const agents = new Map<string, AgentCostRow>();

	for (const e of events) {
		const taskId = e.taskId;
		if (!taskId) continue;

		let row = agents.get(taskId);
		if (!row) {
			row = {
				taskId,
				description: taskId,
				status: "pending",
				provider: undefined,
				costUsd: 0,
				tokensTotal: 0,
			};
			agents.set(taskId, row);
		}

		// Aggregate costs from llm_request events
		if (e.metadata?.costUsd !== undefined) {
			row.costUsd += e.metadata.costUsd;
		}
		if (e.metadata?.tokens?.total !== undefined) {
			row.tokensTotal += e.metadata.tokens.total;
		}

		// Track provider from most recent event that has one
		if (e.metadata?.provider) {
			row.provider = e.metadata.provider;
		}

		// Derive status from event type
		switch (e.type) {
			case "task_scheduled":
				if (row.status === "pending") row.status = "pending";
				break;
			case "task_completed":
				row.status = "completed";
				break;
			case "task_failed":
				row.status = "failed";
				break;
			default:
				// Any other event for this taskId means work is happening
				if (row.status === "pending") {
					row.status = "in_progress";
				}
				break;
		}
	}

	return Array.from(agents.values()).sort((a, b) => b.costUsd - a.costUsd);
}

const STATUS_SYMBOLS: Record<TaskStatus, string> = {
	pending: "○",
	in_progress: "●",
	completed: "✓",
	failed: "✗",
};

/**
 * Renders a per-agent cost breakdown table.
 * Adapts to terminal width: compact/minimal show fewer columns.
 */
export function AgentCostTable({ mode: modeProp }: AgentCostTableProps) {
	const mode = modeProp ?? useResponsiveMode();
	const activeRun = useActiveRun();

	const rows = useMemo(
		() => (activeRun ? extractAgentCosts(activeRun.events) : []),
		[activeRun],
	);

	const totalCost = useMemo(
		() => rows.reduce((s, r) => s + r.costUsd, 0),
		[rows],
	);
	const totalTokens = useMemo(
		() => rows.reduce((s, r) => s + r.tokensTotal, 0),
		[rows],
	);

	if (mode === "minimal") {
		return (
			<Box flexDirection="column">
				<Text dimColor>Agent Cost: {formatCost(totalCost)}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginTop={1}>
			<Box marginBottom={1}>
				<Text bold>Agent Cost Breakdown</Text>
				<Text dimColor> Total: {formatCost(totalCost)}</Text>
			</Box>
			{rows.length === 0 ? (
				<Text dimColor>No agent cost data yet</Text>
			) : (
				<>
					{mode === "normal" && (
						<Box>
							<Text bold dimColor>
								{"Agent"}
								{"              "}
								{"Status"} {"Provider"}
								{"      "}
								{"Cost"}
								{"       "}
								{"Tokens"}
							</Text>
						</Box>
					)}
					{rows.map((row) => (
						<Box key={row.taskId}>
							{mode === "compact" ? (
								<Text>
									{row.taskId.padEnd(20)} {formatCost(row.costUsd)}
								</Text>
							) : (
								<Text>
									{row.taskId.padEnd(20)} {STATUS_SYMBOLS[row.status].padEnd(7)}{" "}
									{(row.provider ?? "—").padEnd(14)}{" "}
									{formatCost(row.costUsd).padStart(10)}{" "}
									{formatTokens(row.tokensTotal).padStart(8)}
								</Text>
							)}
						</Box>
					))}
					{mode === "normal" && rows.length > 1 && (
						<Box marginTop={1}>
							<Text bold>
								{"Total"} {" ".repeat(22)} {formatCost(totalCost).padStart(10)}{" "}
								{formatTokens(totalTokens).padStart(8)}
							</Text>
						</Box>
					)}
				</>
			)}
		</Box>
	);
}
