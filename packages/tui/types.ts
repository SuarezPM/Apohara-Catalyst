import type { EventLog } from "../../src/core/types.ts";

export type { EventLog };

/**
 * A run represents a single execution session — a collection of events
 * produced during one agent iteration.
 */
export interface Run {
	id: string;
	startedAt: string; // ISO string
	endedAt?: string; // ISO string
	events: EventLog[];
}

/**
 * Global dashboard state held by DashboardProvider.
 */
export interface DashboardState {
	runs: Run[];
	activeRunIndex: number;
}

/**
 * Actions that can be dispatched to mutate dashboard state.
 */
export type DashboardAction =
	| { type: "SET_RUNS"; payload: Run[] }
	| { type: "SET_ACTIVE_RUN"; payload: number }
	| { type: "ADD_RUN"; payload: Run }
	| { type: "APPEND_EVENT"; payload: { runId: string; event: EventLog } }
	| { type: "APPEND_EVENTS"; payload: { runId: string; events: EventLog[] } };

/**
 * Terminal display modes derived from viewport width.
 */
export type ResponsiveMode = "normal" | "compact" | "minimal";

/**
 * Debug counters surfaced when the user presses the 'd' key.
 */
export interface DebugCounters {
	malformedLines: number;
	unknownEventTypes: number;
}
