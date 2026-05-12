import { Text } from "ink";
import React, { useEffect, useState } from "react";

export interface TimerProps {
	/** ISO timestamp when the run started */
	startedAt: string;
}

function formatElapsed(totalSeconds: number): string {
	const hours = Math.floor(totalSeconds / 3600);
	const minutes = Math.floor((totalSeconds % 3600) / 60);
	const seconds = totalSeconds % 60;
	return [
		hours.toString().padStart(2, "0"),
		minutes.toString().padStart(2, "0"),
		seconds.toString().padStart(2, "0"),
	].join(":");
}

function getElapsedSeconds(startedAt: string): number {
	const start = new Date(startedAt).getTime();
	const now = Date.now();
	return Math.max(0, Math.floor((now - start) / 1000));
}

/**
 * Displays elapsed time since `startedAt`, updating every second.
 */
export function Timer({ startedAt }: TimerProps) {
	const [elapsed, setElapsed] = useState(() => getElapsedSeconds(startedAt));

	useEffect(() => {
		const interval = setInterval(() => {
			setElapsed(getElapsedSeconds(startedAt));
		}, 1000);
		return () => clearInterval(interval);
	}, [startedAt]);

	return <Text>{formatElapsed(elapsed)}</Text>;
}
