/**
 * Statusline state — G5.C.2 (claude-octopus #3).
 *
 * Footer badge atoms read by `<Statusline />`. Hook listeners push state
 * updates here so the UI re-renders without prop drilling.
 */
import { atom } from "jotai/vanilla";

export type ContextLevel = "ok" | "caution" | "warning" | "critical";

export interface StatusSnapshot {
	/** Provider/session label shown in the leftmost badge. */
	session: string | null;
	/** Cumulative token usage for the active session. */
	tokensUsed: number;
	tokensLimit: number;
	/** Context band — drives caution/warning/critical color. */
	contextLevel: ContextLevel;
	/** Number of in-flight tool calls. */
	activeToolCount: number;
	/** Most recent hook-event label (1-line summary). */
	lastHook: string | null;
	/** Latency in ms of the last completed tool call (null if none yet). */
	lastToolLatencyMs: number | null;
	/** Optional free-form message (e.g. "compaction imminent"). */
	bannerMessage: string | null;
}

export const INITIAL_STATUS: StatusSnapshot = {
	session: null,
	tokensUsed: 0,
	tokensLimit: 0,
	contextLevel: "ok",
	activeToolCount: 0,
	lastHook: null,
	lastToolLatencyMs: null,
	bannerMessage: null,
};

export const statusAtom = atom<StatusSnapshot>(INITIAL_STATUS);

export const patchStatusAtom = atom(
	null,
	(get, set, patch: Partial<StatusSnapshot>) => {
		const cur = get(statusAtom);
		set(statusAtom, { ...cur, ...patch });
	},
);

export const resetStatusAtom = atom(null, (_get, set) => {
	set(statusAtom, INITIAL_STATUS);
});
