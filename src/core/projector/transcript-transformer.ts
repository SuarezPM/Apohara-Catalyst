/**
 * Two-tier canonical projection per nimbalyst #5.1 (G5.F.1).
 *
 * The ledger is the SSoT — append-only JSONL with one event per state
 * transition (`task_scheduled`, `task_completed`, `task_failed`, …). The
 * UI and the search indexer both need a structured view of those events,
 * but they want different shapes:
 *
 *   - **UI** wants one card per `taskId` (latest state wins) so the
 *     TaskBoard can render without re-parsing on every re-render.
 *   - **Search** (FTS5) wants one denormalized row per event with a
 *     `text` column tokenizable by SQLite and a `tags` array for the
 *     facet filters (provider, severity, …).
 *
 * This module parses raw ledger events ONCE and projects them into both
 * shapes. Callers store the projections wherever they like (an in-memory
 * Map for the UI, a SQLite FTS5 table for the indexer) — the projector
 * is intentionally pure: no I/O, no side effects.
 *
 * Reduces re-parse cost: previously each consumer JSON.parsed the same
 * ledger lines repeatedly. With two-tier projection we pay the parse
 * once at the boundary.
 */
import type { EventLog, ProviderId } from "../types.js";

/**
 * UI-friendly task card. One per `taskId`; latest event wins on
 * status / result / error / durationMs. Consumers render this directly
 * (`TaskBoard.tsx` maps cards to rows).
 */
export interface UiTaskCard {
	taskId: string;
	status: "pending" | "completed" | "failed";
	providerId?: ProviderId | string;
	prompt?: string;
	workdir?: string;
	result?: string;
	error?: string;
	scheduledAt?: string;
	completedAt?: string;
	durationMs?: number;
}

/**
 * Denormalized row per event for the FTS5-indexable search projection.
 * `text` is the searchable blob (free-text); `tags` are categorical
 * facets used by the indexer for `WHERE` filters and the UI's chip bar.
 */
export interface SearchRow {
	eventId: string;
	taskId?: string;
	timestamp: string;
	type: string;
	severity: EventLog["severity"];
	text: string;
	tags: string[];
}

function asString(v: unknown): string | undefined {
	return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Fold a stream of ledger events into the UI's per-task view. Insertion
 * order matches the order in which a `taskId` first appeared, which is
 * how the TaskBoard wants to render columns (FIFO).
 *
 * Events without a `taskId` (e.g. `session_started`, `hook_event`,
 * `genesis`) are skipped — they belong to the session-level lane, not
 * the per-task one.
 */
export function projectToUiCards(events: EventLog[]): UiTaskCard[] {
	const cards = new Map<string, UiTaskCard>();
	for (const ev of events) {
		const taskId = ev.taskId;
		if (!taskId) continue;

		let card = cards.get(taskId);
		if (!card) {
			card = { taskId, status: "pending" };
			cards.set(taskId, card);
		}

		const payload = ev.payload ?? {};
		switch (ev.type) {
			case "task_scheduled": {
				card.status = "pending";
				card.scheduledAt = ev.timestamp;
				card.prompt = asString((payload as Record<string, unknown>).prompt) ?? card.prompt;
				card.workdir = asString((payload as Record<string, unknown>).workdir) ?? card.workdir;
				const provider =
					asString((payload as Record<string, unknown>).providerId) ??
					asString(ev.metadata?.provider);
				if (provider) card.providerId = provider;
				break;
			}
			case "task_completed": {
				card.status = "completed";
				card.completedAt = ev.timestamp;
				card.result = asString((payload as Record<string, unknown>).content) ?? card.result;
				if (card.scheduledAt) {
					card.durationMs =
						new Date(ev.timestamp).getTime() -
						new Date(card.scheduledAt).getTime();
				}
				break;
			}
			case "task_failed": {
				card.status = "failed";
				card.completedAt = ev.timestamp;
				card.error = asString((payload as Record<string, unknown>).error) ?? card.error;
				if (card.scheduledAt) {
					card.durationMs =
						new Date(ev.timestamp).getTime() -
						new Date(card.scheduledAt).getTime();
				}
				break;
			}
			default:
				// Other event types don't change the card status but they're
				// still part of the per-task history — the UI's drawer view
				// rebuilds them from the search projection on demand.
				break;
		}
	}
	return Array.from(cards.values());
}

/**
 * Denormalize each event into a row the FTS5 indexer can `INSERT`
 * directly. `text` is a concatenation of the searchable string fields
 * we know about; `tags` carry the categorical facets.
 *
 * The projection is intentionally lossy — the indexer doesn't need the
 * full payload, just enough to power "find me runs that mentioned X".
 * The raw ledger remains the canonical source if a forensic deep-dive
 * is needed.
 */
export function projectToSearchRows(events: EventLog[]): SearchRow[] {
	const rows: SearchRow[] = [];
	for (const ev of events) {
		const payload = ev.payload ?? {};
		const fragments: string[] = [];
		for (const key of ["prompt", "content", "error", "workdir", "message"]) {
			const v = (payload as Record<string, unknown>)[key];
			if (typeof v === "string" && v.length > 0) fragments.push(v);
		}
		const tags: string[] = [`type:${ev.type}`, `severity:${ev.severity}`];
		const provider = ev.metadata?.provider ?? (payload as Record<string, unknown>).providerId;
		if (typeof provider === "string" && provider.length > 0) {
			tags.push(`provider:${provider}`);
		}
		if (ev.taskId) tags.push(`task:${ev.taskId}`);

		rows.push({
			eventId: ev.id,
			taskId: ev.taskId,
			timestamp: ev.timestamp,
			type: ev.type,
			severity: ev.severity,
			text: fragments.join(" · "),
			tags,
		});
	}
	return rows;
}
