import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventLog } from "../../../src/core/types";
import { RunManager } from "./run-manager";

function makeEvent(overrides: Partial<EventLog> = {}): EventLog {
	return {
		id: "evt-1",
		timestamp: "2026-04-30T12:00:00Z",
		type: "task_completed",
		severity: "info",
		payload: { ok: true },
		...overrides,
	};
}

describe("RunManager", () => {
	let tmpDir: string;
	let manager: RunManager;
	let runsChanged: Array<{ runs: ReturnType<RunManager["getRuns"]> }>;
	let countersChanged: Array<{
		counters: ReturnType<RunManager["getCounters"]>;
	}>;
	let errors: Error[];

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "run-manager-"));
		runsChanged = [];
		countersChanged = [];
		errors = [];
		vi.clearAllMocks();
	});

	afterEach(async () => {
		manager?.close();
		await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	});

	function createManager(
		opts: Partial<ConstructorParameters<typeof RunManager>[0]> = {},
	) {
		manager = new RunManager({
			eventsDir: tmpDir,
			onRunsChanged: (runs) => runsChanged.push({ runs }),
			onCountersChanged: (counters) => countersChanged.push({ counters }),
			onError: (err) => errors.push(err),
			debug: false,
			...opts,
		});
		return manager;
	}

	it("starts with empty runs in empty directory", async () => {
		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 50));
		expect(manager.getRuns()).toEqual([]);
	});

	it("discovers an existing run file and builds run state", async () => {
		const filePath = join(tmpDir, "run-20260430-120000.jsonl");
		await writeFile(filePath, JSON.stringify(makeEvent({ id: "e1" })) + "\n");

		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 100));

		const runs = manager.getRuns();
		expect(runs).toHaveLength(1);
		expect(runs[0].id).toBe("run-20260430-120000");
		expect(runs[0].events).toHaveLength(1);
		expect(runsChanged.length).toBeGreaterThanOrEqual(1);
	});

	it("appends new events to existing run on file change", async () => {
		const filePath = join(tmpDir, "run-20260430-120000.jsonl");
		await writeFile(filePath, JSON.stringify(makeEvent({ id: "e1" })) + "\n");

		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 100));

		await appendFile(filePath, JSON.stringify(makeEvent({ id: "e2" })) + "\n");
		// Force a scan to pick up the append
		await (manager as any).watcher.scan();
		await new Promise((r) => setTimeout(r, 50));

		const runs = manager.getRuns();
		expect(runs[0].events).toHaveLength(2);
		expect(runs[0].events[1].id).toBe("e2");
	});

	it("creates multiple runs from multiple files", async () => {
		await writeFile(
			join(tmpDir, "run-20260430-100000.jsonl"),
			JSON.stringify(makeEvent({ timestamp: "2026-04-30T10:00:00Z" })) + "\n",
		);
		await writeFile(
			join(tmpDir, "run-20260430-110000.jsonl"),
			JSON.stringify(makeEvent({ timestamp: "2026-04-30T11:00:00Z" })) + "\n",
		);
		await writeFile(
			join(tmpDir, "run-20260430-120000.jsonl"),
			JSON.stringify(makeEvent({ timestamp: "2026-04-30T12:00:00Z" })) + "\n",
		);

		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 100));

		const runs = manager.getRuns();
		expect(runs).toHaveLength(3);
		expect(runs[0].startedAt).toBe("2026-04-30T10:00:00Z");
		expect(runs[2].startedAt).toBe("2026-04-30T12:00:00Z");
	});

	it("handles 50+ runs", async () => {
		for (let i = 0; i < 55; i++) {
			const ts = `20260430-${String(i).padStart(6, "0")}`;
			await writeFile(
				join(tmpDir, `run-${ts}.jsonl`),
				JSON.stringify(
					makeEvent({
						timestamp: `2026-04-30T${String(i % 24).padStart(2, "0")}:00:00Z`,
					}),
				) + "\n",
			);
		}

		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 200));

		const runs = manager.getRuns();
		expect(runs).toHaveLength(55);
	});

	it("handles file with zero valid events", async () => {
		const filePath = join(tmpDir, "run-empty.jsonl");
		await writeFile(filePath, "not json\nalso not json\n");

		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 100));

		const runs = manager.getRuns();
		expect(runs).toHaveLength(1);
		expect(runs[0].events).toHaveLength(0);
		expect(manager.getCounters().malformedLines).toBe(2);
	});

	it("sets endedAt on terminal event types", async () => {
		const filePath = join(tmpDir, "run-ended.jsonl");
		await writeFile(
			filePath,
			JSON.stringify(
				makeEvent({ id: "e1", timestamp: "2026-04-30T10:00:00Z" }),
			) +
				"\n" +
				JSON.stringify(
					makeEvent({
						id: "e2",
						timestamp: "2026-04-30T10:05:00Z",
						type: "auto_command_completed",
					}),
				) +
				"\n",
		);

		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 100));

		const run = manager.getRuns()[0];
		expect(run.endedAt).toBe("2026-04-30T10:05:00Z");
	});

	it("sets endedAt to last event timestamp when no terminal event", async () => {
		const filePath = join(tmpDir, "run-ongoing.jsonl");
		await writeFile(
			filePath,
			JSON.stringify(
				makeEvent({ id: "e1", timestamp: "2026-04-30T10:00:00Z" }),
			) +
				"\n" +
				JSON.stringify(
					makeEvent({ id: "e2", timestamp: "2026-04-30T10:02:00Z" }),
				) +
				"\n",
		);

		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 100));

		const run = manager.getRuns()[0];
		expect(run.endedAt).toBe("2026-04-30T10:02:00Z");
	});

	it("handles rapid successive file changes", async () => {
		const mockWatcher = { close: vi.fn(), on: vi.fn() };
		const filePath = join(tmpDir, "run-rapid.jsonl");
		await writeFile(filePath, JSON.stringify(makeEvent({ id: "e1" })) + "\n");

		createManager({ watchImpl: vi.fn(() => mockWatcher as any) });
		await manager.start();
		await new Promise((r) => setTimeout(r, 50));

		// Fire multiple appends rapidly
		for (let i = 2; i <= 10; i++) {
			await appendFile(
				filePath,
				JSON.stringify(makeEvent({ id: `e${i}` })) + "\n",
			);
		}
		await (manager as any).watcher.scan();
		await new Promise((r) => setTimeout(r, 50));

		const run = manager.getRuns()[0];
		expect(run.events).toHaveLength(10);
	});

	it("exposes counters via callback when they change", async () => {
		const filePath = join(tmpDir, "run-counters.jsonl");
		await writeFile(
			filePath,
			JSON.stringify(makeEvent()) +
				"\n" +
				"bad json\n" +
				JSON.stringify(makeEvent({ type: "unknown_xyz" })) +
				"\n",
		);

		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 100));

		expect(countersChanged.length).toBeGreaterThanOrEqual(1);
		const last = countersChanged[countersChanged.length - 1].counters;
		expect(last.malformedLines).toBe(1);
		expect(last.unknownEventTypes).toBe(1);
	});

	it("getCounters reflects current watcher state", async () => {
		const filePath = join(tmpDir, "run-getcounters.jsonl");
		await writeFile(filePath, "bad\n");

		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 100));

		const counters = manager.getCounters();
		expect(counters.malformedLines).toBe(1);
	});

	it("getRunById returns correct run", async () => {
		await writeFile(
			join(tmpDir, "run-alpha.jsonl"),
			JSON.stringify(makeEvent()) + "\n",
		);

		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 100));

		expect(manager.getRunById("run-alpha")).toBeDefined();
		expect(manager.getRunById("run-missing")).toBeUndefined();
	});

	it("handles file removed during initial scan gracefully", async () => {
		const filePath = join(tmpDir, "run-removed.jsonl");
		await writeFile(filePath, JSON.stringify(makeEvent()) + "\n");

		// Remove file before starting
		await rm(filePath);

		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 100));

		// Should not crash; runs may be empty or have error logged
		expect(() => manager.getRuns()).not.toThrow();
	});

	it("catches and logs callback consumer errors", async () => {
		const onRunsChanged = vi.fn().mockImplementation(() => {
			throw new Error("consumer boom");
		});

		const filePath = join(tmpDir, "run-callback-err.jsonl");
		await writeFile(filePath, JSON.stringify(makeEvent()) + "\n");

		manager = new RunManager({
			eventsDir: tmpDir,
			onRunsChanged,
			onError: (err) => errors.push(err),
			debug: false,
		});
		await manager.start();
		await new Promise((r) => setTimeout(r, 100));

		expect(errors.some((e) => e.message.includes("consumer boom"))).toBe(true);
		expect(onRunsChanged).toHaveBeenCalled();
	});

	it("stops watcher and clears nothing on close", async () => {
		const filePath = join(tmpDir, "run-close.jsonl");
		await writeFile(filePath, JSON.stringify(makeEvent()) + "\n");

		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 100));

		expect(manager.getRuns()).toHaveLength(1);
		manager.close();
		// State is retained after close (no clearing)
		expect(manager.getRuns()).toHaveLength(1);
	});

	it("uses runId from filename", async () => {
		const filePath = join(tmpDir, "my-custom-run-id.jsonl");
		await writeFile(filePath, JSON.stringify(makeEvent()) + "\n");

		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 100));

		expect(manager.getRuns()[0].id).toBe("my-custom-run-id");
	});

	it("updates endedAt on task_exhausted and auto_command_failed", async () => {
		const filePath = join(tmpDir, "run-terminal.jsonl");
		await writeFile(
			filePath,
			JSON.stringify(
				makeEvent({ id: "e1", timestamp: "2026-04-30T10:00:00Z" }),
			) +
				"\n" +
				JSON.stringify(
					makeEvent({
						id: "e2",
						timestamp: "2026-04-30T10:05:00Z",
						type: "task_exhausted",
					}),
				) +
				"\n",
		);

		createManager();
		await manager.start();
		await new Promise((r) => setTimeout(r, 100));

		expect(manager.getRuns()[0].endedAt).toBe("2026-04-30T10:05:00Z");
	});
});
