/**
 * Tests for the `apohara state` command (M018 Pattern F).
 *
 * Each test sets up an isolated tmp dir with `.events/` and
 * `.apohara/` subtrees, then feeds it to `collectState({ cwd })`
 * so we never touch the user's real workspace.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectState } from "../src/commands/state";
import type { EventLog } from "../src/core/types";

async function seedEvents(
	cwd: string,
	runId: string,
	events: Omit<EventLog, "id">[],
): Promise<string> {
	const dir = join(cwd, ".events");
	await mkdir(dir, { recursive: true });
	const path = join(dir, `run-${runId}.jsonl`);
	const lines = events
		.map((e, i) =>
			JSON.stringify({ id: `evt-${i}`, ...e } satisfies EventLog),
		)
		.join("\n");
	await writeFile(path, `${lines}\n`, "utf-8");
	return path;
}

async function seedCapabilityStats(cwd: string): Promise<void> {
	const dir = join(cwd, ".apohara");
	await mkdir(dir, { recursive: true });
	const payload = {
		version: 1,
		updatedAt: new Date().toISOString(),
		entries: [
			{
				provider: "groq",
				role: "codegen",
				successes: 3,
				failures: 1,
				lastUpdated: new Date().toISOString(),
			},
			{
				provider: "groq",
				role: "planning",
				successes: 2,
				failures: 0,
				lastUpdated: new Date().toISOString(),
			},
		],
	};
	await writeFile(
		join(dir, "capability-stats.json"),
		JSON.stringify(payload, null, 2),
		"utf-8",
	);
}

describe("apohara state (M018 Pattern F)", () => {
	let cwd: string;

	beforeEach(async () => {
		cwd = await mkdtemp(join(tmpdir(), "apohara-state-cmd-"));
	});

	afterEach(async () => {
		await rm(cwd, { recursive: true, force: true });
	});

	it("returns an empty snapshot when no runs have happened", async () => {
		const snap = await collectState({ cwd });
		expect(snap.runId).toBeNull();
		expect(snap.currentTaskId).toBeNull();
		expect(snap.taskStates).toEqual([]);
		expect(snap.providers).toEqual([]);
		expect(snap.ledgerPath).toBeNull();
		expect(snap.sandboxAvailable).toBe(false);
		expect(snap.schemaVersion).toBe("v0-alpha");
	});

	it("reports a finished run with completed tasks", async () => {
		const runId = "2026-05-12T20-00-00-000Z";
		const ledger = await seedEvents(cwd, runId, [
			{
				timestamp: "2026-05-12T20:00:00.000Z",
				type: "genesis",
				severity: "info",
				payload: { runId },
			},
			{
				timestamp: "2026-05-12T20:00:01.000Z",
				type: "task_started",
				severity: "info",
				taskId: "T01",
				payload: {},
			},
			{
				timestamp: "2026-05-12T20:00:02.000Z",
				type: "task_completed",
				severity: "info",
				taskId: "T01",
				payload: {},
			},
			{
				timestamp: "2026-05-12T20:00:03.000Z",
				type: "task_started",
				severity: "info",
				taskId: "T02",
				payload: {},
			},
			{
				timestamp: "2026-05-12T20:00:04.000Z",
				type: "task_completed",
				severity: "info",
				taskId: "T02",
				payload: {},
			},
		]);
		await seedCapabilityStats(cwd);

		const snap = await collectState({ cwd });

		expect(snap.runId).toBe(runId);
		expect(snap.ledgerPath).toBe(ledger);
		expect(snap.currentTaskId).toBeNull();
		expect(snap.taskStates).toHaveLength(2);
		expect(snap.taskStates.map((t) => t.id).sort()).toEqual(["T01", "T02"]);
		for (const t of snap.taskStates) {
			expect(t.status).toBe("completed");
			expect(t.startedAt).toBeDefined();
			expect(t.completedAt).toBeDefined();
		}
		expect(snap.providers).toHaveLength(1);
		expect(snap.providers[0]).toEqual({ id: "groq", trials: 6 });
		expect(snap.schemaVersion).toBe("v0-alpha");
	});

	it("reports an in-flight run with currentTaskId set", async () => {
		const runId = "2026-05-12T21-00-00-000Z";
		await seedEvents(cwd, runId, [
			{
				timestamp: "2026-05-12T21:00:00.000Z",
				type: "genesis",
				severity: "info",
				payload: { runId },
			},
			{
				timestamp: "2026-05-12T21:00:01.000Z",
				type: "task_started",
				severity: "info",
				taskId: "T10",
				payload: {},
			},
			{
				timestamp: "2026-05-12T21:00:02.000Z",
				type: "task_completed",
				severity: "info",
				taskId: "T10",
				payload: {},
			},
			{
				timestamp: "2026-05-12T21:00:03.000Z",
				type: "task_started",
				severity: "info",
				taskId: "T11",
				payload: {},
			},
		]);

		const snap = await collectState({ cwd });

		expect(snap.runId).toBe(runId);
		expect(snap.currentTaskId).toBe("T11");
		const t10 = snap.taskStates.find((t) => t.id === "T10");
		const t11 = snap.taskStates.find((t) => t.id === "T11");
		expect(t10?.status).toBe("completed");
		expect(t11?.status).toBe("in_progress");
		expect(t11?.completedAt).toBeUndefined();
	});
});
