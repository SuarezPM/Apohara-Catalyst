/**
 * 4-tier UI classifier (pure functions) per spec §4 — split out from the React
 * hook so unit tests don't need to resolve `react` (jotai/react is a peer-dep
 * landmine when tests run outside the bundler context).
 *
 * The React hook lives in `./use-taskboard-smart-attention.ts` and re-exports
 * everything here for external callers.
 *
 * Classes (in priority order):
 *   NeedsYou  — task is blocked on user (permission, decision, force-fail confirm)
 *   Working   — task is dispatched OR in_verification (active)
 *   Done      — task is done OR failed (terminal)
 *   Idle      — task is pending OR ready (waiting for scheduler)
 *
 * Tie-break: attentionTimestamp DESC (most recent activity first).
 *
 * Min-of-pane-classes promotion: if a pane has both NeedsYou and Working
 * tasks, the pane's effective class is NeedsYou (most urgent wins).
 */
import type { DagTask } from "../../../store/dagStore.js";

export type AttentionTier = "NeedsYou" | "Working" | "Done" | "Idle";

export const TIER_ORDER: Record<AttentionTier, number> = {
	NeedsYou: 0,
	Working: 1,
	Done: 2,
	Idle: 3,
};

export interface AttentionTask extends DagTask {
	attentionTier: AttentionTier;
	attentionTimestamp: number;
}

export function classifyTask(
	task: DagTask,
	attentionTimestamp: number = Date.now(),
): AttentionTask {
	let tier: AttentionTier;
	switch (task.status) {
		case "blocked":
			tier = "NeedsYou";
			break;
		case "dispatched":
		case "in_verification":
			tier = "Working";
			break;
		case "done":
		case "failed":
			tier = "Done";
			break;
		case "pending":
		case "ready":
		default:
			tier = "Idle";
	}
	return { ...task, attentionTier: tier, attentionTimestamp };
}

export function sortByAttention(tasks: AttentionTask[]): AttentionTask[] {
	return [...tasks].sort((a, b) => {
		const tierDiff = TIER_ORDER[a.attentionTier] - TIER_ORDER[b.attentionTier];
		if (tierDiff !== 0) return tierDiff;
		return b.attentionTimestamp - a.attentionTimestamp;
	});
}

export function promotePaneClass(taskTiers: AttentionTier[]): AttentionTier {
	if (taskTiers.length === 0) return "Idle";
	return taskTiers.reduce<AttentionTier>(
		(best, t) => (TIER_ORDER[t] < TIER_ORDER[best] ? t : best),
		"Idle",
	);
}
