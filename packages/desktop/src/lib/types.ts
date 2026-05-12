/**
 * Shared types between the React UI and the Bun.serve backend.
 * Mirrors `src/core/types.ts` EventLog — kept as a lightweight copy here so
 * `packages/desktop/` can be developed without root TS imports.
 */

export type EventSeverity = "info" | "warning" | "error";

export interface EventLog {
	id: string;
	timestamp: string;
	type: string;
	severity: EventSeverity;
	taskId?: string;
	payload?: Record<string, unknown>;
	metadata?: {
		provider?: string;
		model?: string;
		tokens?: { prompt: number; completion: number; total: number };
		costUsd?: number;
		durationMs?: number;
	};
	prev_hash?: string;
	hash?: string;
}
