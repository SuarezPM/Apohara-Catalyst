import { Box, Text } from "ink";
import React from "react";
import { useResponsiveMode } from "../hooks/useResponsiveMode.tsx";

export interface ProgressBarProps {
	/** Number of completed items */
	completed: number;
	/** Total number of items */
	total: number;
	/** Width of the bar in characters (default 30) */
	width?: number;
	/** Responsive mode override */
	mode?: "normal" | "compact" | "minimal";
}

/**
 * Renders a textual progress bar showing percentage completion.
 * Adapts to terminal width: compact shows only percentage.
 */
export function ProgressBar({
	completed,
	total,
	width = 30,
	mode: modeProp,
}: ProgressBarProps) {
	const mode = modeProp ?? useResponsiveMode();
	const percentage =
		total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;
	const filled = Math.round((percentage / 100) * width);
	const empty = Math.max(0, width - filled);
	const bar = "█".repeat(filled) + "░".repeat(empty);

	if (mode === "compact" || mode === "minimal") {
		return (
			<Box>
				<Text>
					{bar} {percentage}%
				</Text>
			</Box>
		);
	}

	return (
		<Box>
			<Text>
				{bar} {percentage}% ({completed}/{total} tareas)
			</Text>
		</Box>
	);
}
