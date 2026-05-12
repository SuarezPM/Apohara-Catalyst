import { useEffect, useState } from "react";
import type { ResponsiveMode } from "../types.ts";

function getModeFromColumns(columns: number): ResponsiveMode {
	if (columns >= 100) return "normal";
	if (columns >= 60) return "compact";
	return "minimal";
}

/**
 * Returns the current responsive mode based on terminal width.
 * Listens to `process.stdout` resize events and updates reactively.
 */
export function useResponsiveMode(): ResponsiveMode {
	const [mode, setMode] = useState<ResponsiveMode>(() =>
		getModeFromColumns(process.stdout.columns ?? 80),
	);

	useEffect(() => {
		function handleResize() {
			setMode(getModeFromColumns(process.stdout.columns ?? 80));
		}

		process.stdout.on("resize", handleResize);
		return () => {
			process.stdout.off("resize", handleResize);
		};
	}, []);

	return mode;
}
