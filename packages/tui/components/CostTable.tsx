import { Box, Text } from "ink";
import React, { useMemo } from "react";
import { useCostTable } from "../hooks/useCostTable.tsx";
import { useActiveRun } from "../hooks/useDashboard.tsx";
import { useResponsiveMode } from "../hooks/useResponsiveMode.tsx";

export interface CostTableProps {
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

function countTasksByProvider(
	events: import("../types.ts").EventLog[],
	provider: string,
): number {
	return events.filter(
		(e) =>
			e.metadata?.provider === provider &&
			(e.type === "task_scheduled" || e.type === "task_started"),
	).length;
}

/**
 * Renders a cost breakdown table by provider with task counts.
 * Adapts to terminal width: compact/minimal show fewer columns.
 */
export function CostTable({ mode: modeProp }: CostTableProps) {
	const { rows, totalCostUsd, totalTokens } = useCostTable();
	const mode = modeProp ?? useResponsiveMode();
	const activeRun = useActiveRun();

	const enrichedRows = useMemo(() => {
		if (!activeRun) return rows.map((r) => ({ ...r, taskCount: 0 }));
		return rows.map((row) => ({
			...row,
			taskCount: countTasksByProvider(activeRun.events, row.provider),
		}));
	}, [rows, activeRun]);

	if (mode === "minimal") {
		return (
			<Box flexDirection="column">
				<Text dimColor>Cost: {formatCost(totalCostUsd)}</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginTop={1}>
			<Box marginBottom={1}>
				<Text bold>Cost Breakdown</Text>
				<Text dimColor> Total: {formatCost(totalCostUsd)}</Text>
			</Box>
			{enrichedRows.length === 0 ? (
				<Text dimColor>No cost data yet</Text>
			) : (
				<>
					{mode === "normal" && (
						<Box>
							<Text bold dimColor>
								{"Provider"}
								{"         "}
								{"Tareas"} {"Cost"}
								{"       "}
								{"Tokens"}
							</Text>
						</Box>
					)}
					{enrichedRows.map((row) => (
						<Box key={row.provider}>
							{mode === "compact" ? (
								<Text>
									{row.provider.padEnd(14)} {formatCost(row.costUsd)}
								</Text>
							) : (
								<Text>
									{row.provider.padEnd(16)} {String(row.taskCount).padStart(6)}{" "}
									{formatCost(row.costUsd).padStart(10)}{" "}
									{formatTokens(row.tokensTotal).padStart(8)}
								</Text>
							)}
						</Box>
					))}
					{mode === "normal" && (
						<Box marginTop={1}>
							<Text bold>
								{"Total"}{" "}
								{String(
									enrichedRows.reduce((s, r) => s + r.taskCount, 0),
								).padStart(20)}{" "}
								{formatCost(totalCostUsd).padStart(10)}{" "}
								{formatTokens(totalTokens).padStart(8)}
							</Text>
						</Box>
					)}
				</>
			)}
		</Box>
	);
}
