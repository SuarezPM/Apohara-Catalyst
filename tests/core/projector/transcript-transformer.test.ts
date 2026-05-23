/**
 * G5.F.1 — Two-tier canonical projection (nimbalyst #5.1).
 *
 * Raw ledger events → two views:
 *   1. UI view: TaskBoard-shaped cards (one per `taskId`, latest state wins).
 *   2. Search view: FTS5-indexable rows (denormalized: searchable text + tags).
 *
 * Goal: parse the raw JSONL once; consumers (React + the indexer) read from
 * cheap projections instead of re-parsing on every render / search.
 */
import { describe, expect, test } from "bun:test";
import type { EventLog } from "../../../src/core/types";
import {
	projectToUiCards,
	projectToSearchRows,
	type UiTaskCard,
	type SearchRow,
} from "../../../src/core/projector/transcript-transformer";

function mkEvt(over: Partial<EventLog>): EventLog {
	return {
		id: over.id ?? crypto.randomUUID(),
		timestamp: over.timestamp ?? new Date().toISOString(),
		type: over.type ?? "task_scheduled",
		severity: over.severity ?? "info",
		taskId: over.taskId,
		payload: over.payload ?? {},
		metadata: over.metadata,
	};
}

describe("G5.F.1 — projectToUiCards", () => {
	test("empty events → empty cards", () => {
		expect(projectToUiCards([])).toEqual([]);
	});

	test("single task_scheduled → one pending card", () => {
		const events: EventLog[] = [
			mkEvt({
				type: "task_scheduled",
				taskId: "t-1",
				payload: { prompt: "build x", workdir: "/w", providerId: "claude-code-cli" },
			}),
		];
		const cards = projectToUiCards(events);
		expect(cards).toHaveLength(1);
		expect(cards[0].taskId).toBe("t-1");
		expect(cards[0].status).toBe("pending");
		expect(cards[0].providerId).toBe("claude-code-cli");
		expect(cards[0].prompt).toBe("build x");
	});

	test("task_scheduled + task_completed → completed card with duration", () => {
		const t0 = new Date("2026-05-23T10:00:00Z").toISOString();
		const t1 = new Date("2026-05-23T10:00:05Z").toISOString();
		const events: EventLog[] = [
			mkEvt({
				type: "task_scheduled",
				taskId: "t-2",
				timestamp: t0,
				payload: { prompt: "p", providerId: "codex-cli" },
			}),
			mkEvt({
				type: "task_completed",
				taskId: "t-2",
				timestamp: t1,
				payload: { content: "done" },
			}),
		];
		const [card] = projectToUiCards(events);
		expect(card.status).toBe("completed");
		expect(card.durationMs).toBe(5000);
		expect(card.result).toBe("done");
	});

	test("task_failed marks card as failed and captures error", () => {
		const events: EventLog[] = [
			mkEvt({ type: "task_scheduled", taskId: "t-3", payload: {} }),
			mkEvt({ type: "task_failed", taskId: "t-3", payload: { error: "boom" } }),
		];
		const [card] = projectToUiCards(events);
		expect(card.status).toBe("failed");
		expect(card.error).toBe("boom");
	});

	test("events without taskId are ignored (e.g. session_started)", () => {
		const events: EventLog[] = [
			mkEvt({ type: "session_started", payload: { prompt: "x" } }),
			mkEvt({ type: "task_scheduled", taskId: "t-4", payload: {} }),
		];
		const cards = projectToUiCards(events);
		expect(cards).toHaveLength(1);
		expect(cards[0].taskId).toBe("t-4");
	});

	test("cards are ordered by first-seen taskId (insertion order)", () => {
		const events: EventLog[] = [
			mkEvt({ type: "task_scheduled", taskId: "t-A", payload: {} }),
			mkEvt({ type: "task_scheduled", taskId: "t-B", payload: {} }),
			mkEvt({ type: "task_completed", taskId: "t-A", payload: {} }),
		];
		const ids = projectToUiCards(events).map((c) => c.taskId);
		expect(ids).toEqual(["t-A", "t-B"]);
	});
});

describe("G5.F.1 — projectToSearchRows", () => {
	test("empty input → empty rows", () => {
		expect(projectToSearchRows([])).toEqual([]);
	});

	test("each event becomes one row with denormalized text", () => {
		const events: EventLog[] = [
			mkEvt({
				id: "e1",
				type: "task_scheduled",
				taskId: "t-x",
				payload: { prompt: "implement feature y", workdir: "/w" },
				metadata: { provider: "claude-code-cli" },
			}),
		];
		const rows = projectToSearchRows(events);
		expect(rows).toHaveLength(1);
		const row = rows[0];
		expect(row.eventId).toBe("e1");
		expect(row.taskId).toBe("t-x");
		expect(row.text).toContain("implement feature y");
		expect(row.tags).toContain("provider:claude-code-cli");
		expect(row.tags).toContain("type:task_scheduled");
	});

	test("search rows include severity tag for triage filters", () => {
		const events: EventLog[] = [
			mkEvt({
				type: "task_failed",
				taskId: "t-x",
				severity: "error",
				payload: { error: "OOM" },
			}),
		];
		const [row] = projectToSearchRows(events);
		expect(row.tags).toContain("severity:error");
		expect(row.text).toContain("OOM");
	});
});
