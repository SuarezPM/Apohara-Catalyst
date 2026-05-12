import { Box, Text } from "ink";
import type React from "react";
import { useResponsiveMode } from "../hooks/useResponsiveMode.tsx";
import type { DebugCounters, ResponsiveMode } from "../types.ts";
import { ProgressBar } from "./ProgressBar.tsx";
import { Timer } from "./Timer.tsx";

export interface DashboardProps {
	/** Content rendered in the body area */
	children?: React.ReactNode;
	/** ISO timestamp when the current run started */
	startedAt?: string;
	/** Number of completed tasks */
	completedTasks?: number;
	/** Total number of tasks */
	totalTasks?: number;
	/** Debug counters surfaced in debug mode */
	debugCounters?: DebugCounters;
	/** Whether debug mode is active */
	debugMode?: boolean;
	/** Active run ID to display in header */
	runId?: string;
	/** Total number of runs */
	totalRuns?: number;
	/** Current active run index (0-based) */
	activeRunIndex?: number;
}

function Header({
	startedAt,
	mode,
	runId,
	totalRuns,
	activeRunIndex,
}: {
	startedAt?: string;
	mode: ResponsiveMode;
	runId?: string;
	totalRuns?: number;
	activeRunIndex?: number;
}) {
	if (mode === "minimal") {
		return (
			<Box>
				<Text bold>Clarity</Text>
			</Box>
		);
	}

	return (
		<Box justifyContent="space-between">
			<Box>
				<Text bold>Clarity Dashboard</Text>
				{runId && totalRuns && totalRuns > 1 && (
					<Text dimColor>
						Run: {runId} ({(activeRunIndex ?? 0) + 1}/{totalRuns})
					</Text>
				)}
			</Box>
			{startedAt && (
				<Box>
					<Text dimColor>Elapsed: </Text>
					<Timer startedAt={startedAt} />
				</Box>
			)}
		</Box>
	);
}

function Footer({
	completedTasks,
	totalTasks,
	mode,
	debugCounters,
	debugMode,
}: {
	completedTasks: number;
	totalTasks: number;
	mode: ResponsiveMode;
	debugCounters?: DebugCounters;
	debugMode?: boolean;
}) {
	if (mode === "minimal") {
		return (
			<Box>
				<Text dimColor>[q]uit</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginTop={1}>
			<ProgressBar
				completed={completedTasks}
				total={totalTasks}
				width={mode === "compact" ? 20 : 40}
			/>
			{debugMode && debugCounters && (
				<Box marginTop={1}>
					<Text dimColor>
						Debug: malformed={debugCounters.malformedLines} unknown=
						{debugCounters.unknownEventTypes}
					</Text>
				</Box>
			)}
			<Box marginTop={1}>
				<Text dimColor>
					{mode === "compact"
						? "[q]uit [d]ebug"
						: "[q]uit [d]ebug [r]efresh [→]next [←]prev"}
				</Text>
			</Box>
		</Box>
	);
}

/**
 * Main dashboard shell that adapts to terminal width.
 * Renders a header (title + timer), body area, and footer (progress + shortcuts).
 */
export function Dashboard({
	children,
	startedAt,
	completedTasks = 0,
	totalTasks = 0,
	debugCounters,
	debugMode = false,
	runId,
	totalRuns,
	activeRunIndex,
}: DashboardProps) {
	const mode = useResponsiveMode();

	return (
		<Box flexDirection="column" paddingX={1}>
			<Header
				startedAt={startedAt}
				mode={mode}
				runId={runId}
				totalRuns={totalRuns}
				activeRunIndex={activeRunIndex}
			/>
			<Box flexDirection="column" marginY={1}>
				{children}
			</Box>
			<Footer
				completedTasks={completedTasks}
				totalTasks={totalTasks}
				mode={mode}
				debugCounters={debugCounters}
				debugMode={debugMode}
			/>
		</Box>
	);
}
