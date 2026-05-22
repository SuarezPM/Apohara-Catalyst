/**
 * 4-tier UI classifier React hook per spec §4 (sits on top of apohara-attention
 * band crate §1.13).
 *
 * Pure classification/sort/promotion logic lives in `./smart-attention.ts`
 * (re-exported below) so unit tests can import the functions without needing
 * `react` resolved — jotai/react's peer dependency makes pure-function tests
 * brittle when run from the repo root.
 *
 * Usage:
 *   const { tasks, paneClass } = useTaskboardSmartAttention();
 *   // tasks sorted by tier ASC, then timestamp DESC
 *   // paneClass = most urgent tier present (or "Idle" when empty)
 */
import { useMemo } from "react";
import { useTaskBoardStore } from "../../../store/use-taskboard-store.js";
import {
	type AttentionTask,
	type AttentionTier,
	TIER_ORDER,
	classifyTask,
	promotePaneClass,
	sortByAttention,
} from "./smart-attention.js";

export function useTaskboardSmartAttention() {
	const { tasks } = useTaskBoardStore();
	return useMemo(() => {
		const now = Date.now();
		const classified = Object.values(tasks).map((t) => classifyTask(t, now));
		const sorted = sortByAttention(classified);
		const paneClass = promotePaneClass(classified.map((c) => c.attentionTier));
		return { tasks: sorted, paneClass };
	}, [tasks]);
}

// Re-export pure surface so external callers can import everything from
// the hook module, matching the spec's single-entry-point intent.
export {
	type AttentionTask,
	type AttentionTier,
	TIER_ORDER,
	classifyTask,
	promotePaneClass,
	sortByAttention,
};
