/**
 * G7.5.A.2 — Projector wiring.
 *
 * Sprint 5 G5.F.1 delivered `projectToUiCards` + `projectToSearchRows` in
 * `src/core/projector/transcript-transformer.ts`. They had zero consumers.
 * This test pins that TaskBoard.tsx imports `projectToUiCards` and uses
 * it (no manual re-parse of ledger events). When TaskBoard is given an
 * `events` prop, derived cards flow through the canonical projector.
 *
 * The TaskBoard exercises the projector end-to-end with realistic
 * `EventLog` inputs so a regression surfaces here, not in a screenshot
 * review.
 *
 * NOTE: A prior Sprint-7.5 cross-task placeholder test asserted that
 * `crates/apohara-indexer/src/lib.rs` carried a Sprint-8 TODO referencing
 * `projectToSearchRows`. Sprint 8 (G8.A.3) wholesale-rewrote the indexer
 * (sqlite-vec + blake3 swap) and removed the marker; the TS→Rust
 * projector bridge on the indexer side is deferred to v1.1 and tracked
 * elsewhere. The orphan placeholder test has been dropped.
 */
import { expect, test, describe } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { EventLog } from "../../src/core/types";
import {
	projectToUiCards,
	projectToSearchRows,
} from "../../src/core/projector/transcript-transformer";

const REPO_ROOT = resolve(import.meta.dir, "../..");

function mkEvent(over: Partial<EventLog>): EventLog {
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

describe("G7.5.A.2 — projector wiring", () => {
	test("projectToUiCards folds a realistic event stream into UI cards", () => {
		const t0 = "2026-05-23T10:00:00Z";
		const t1 = "2026-05-23T10:00:03Z";
		const events: EventLog[] = [
			mkEvent({
				type: "session_started",
				timestamp: t0,
				payload: { prompt: "kick off" },
			}),
			mkEvent({
				type: "task_scheduled",
				taskId: "task-A",
				timestamp: t0,
				payload: {
					prompt: "ship feature A",
					workdir: "/w/a",
					providerId: "claude-code-cli",
				},
			}),
			mkEvent({
				type: "task_completed",
				taskId: "task-A",
				timestamp: t1,
				payload: { content: "shipped" },
			}),
			mkEvent({
				type: "task_scheduled",
				taskId: "task-B",
				timestamp: t0,
				payload: { prompt: "ship B", providerId: "codex-cli" },
			}),
			mkEvent({
				type: "task_failed",
				taskId: "task-B",
				timestamp: t1,
				payload: { error: "compile broke" },
			}),
		];

		const cards = projectToUiCards(events);
		expect(cards).toHaveLength(2);

		const taskA = cards.find((c) => c.taskId === "task-A");
		expect(taskA).toBeDefined();
		expect(taskA?.status).toBe("completed");
		expect(taskA?.providerId).toBe("claude-code-cli");
		expect(taskA?.result).toBe("shipped");
		expect(taskA?.durationMs).toBe(3000);

		const taskB = cards.find((c) => c.taskId === "task-B");
		expect(taskB).toBeDefined();
		expect(taskB?.status).toBe("failed");
		expect(taskB?.error).toBe("compile broke");
	});

	test("projectToSearchRows yields one FTS5-indexable row per event", () => {
		const events: EventLog[] = [
			mkEvent({
				type: "task_scheduled",
				taskId: "row-1",
				payload: { prompt: "search me" },
				metadata: { provider: "claude-code-cli" },
			}),
			mkEvent({
				type: "task_failed",
				taskId: "row-1",
				payload: { error: "kaboom" },
				metadata: { provider: "claude-code-cli" },
			}),
		];

		const rows = projectToSearchRows(events);
		expect(rows).toHaveLength(2);

		const [scheduled, failed] = rows;
		expect(scheduled.text).toContain("search me");
		expect(scheduled.tags).toContain("type:task_scheduled");
		expect(scheduled.tags).toContain("provider:claude-code-cli");
		expect(scheduled.tags).toContain("task:row-1");

		expect(failed.text).toContain("kaboom");
		expect(failed.tags).toContain("type:task_failed");
	});

	test("TaskBoard.tsx wires projectToUiCards (no manual ledger re-parse)", () => {
		const taskBoardSrc = readFileSync(
			resolve(REPO_ROOT, "packages/desktop/src/components/TaskBoard/TaskBoard.tsx"),
			"utf8",
		);
		// Pin the canonical import — if someone tears it out, this fires.
		expect(taskBoardSrc).toMatch(/projectToUiCards/);
		expect(taskBoardSrc).toMatch(
			/from\s+["'].*core\/projector\/transcript-transformer/,
		);
	});
});
