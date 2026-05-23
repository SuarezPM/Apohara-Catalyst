/**
 * G7.5.A.3 — server-side ledger → ProjectedState projection.
 *
 * Pure helper extracted from `server.ts` so the SSE state-stream route
 * is unit-testable without spawning a Bun.serve subprocess.
 *
 * The shape (`{ tasks: Record<taskId, UiTaskCard> }`) wraps the existing
 * `projectToUiCards` output into the object form `diffPatch` expects.
 * `diffPatch` only diffs plain objects key-by-key — the array shape that
 * `projectToUiCards` returns would diff as a single opaque replace on
 * every change, defeating the whole optimization.
 *
 * Insertion order is preserved by writing tasks in the order
 * `projectToUiCards` emits them (FIFO by first appearance in the
 * ledger), which matches how the TaskBoard renders columns.
 */
import {
	projectToUiCards,
	type UiTaskCard,
} from "../../../src/core/projector/transcript-transformer.js";
import type { EventLog } from "../../../src/core/types.js";

export interface ProjectedState {
	/** taskId → latest UI snapshot. */
	tasks: Record<string, UiTaskCard>;
}

export function projectLedgerToState(events: EventLog[]): ProjectedState {
	const cards = projectToUiCards(events);
	const tasks: Record<string, UiTaskCard> = {};
	for (const card of cards) {
		tasks[card.taskId] = card;
	}
	return { tasks };
}
