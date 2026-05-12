import { appendFile, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventLog } from "../../../src/core/types";
import { LedgerWatcher } from "./ledger-watcher";

function makeEvent(overrides: Partial<EventLog> = {}): EventLog {
	return {
		id: "evt-1",
		timestamp: new Date().toISOString(),
		type: "task_completed",
		severity: "info",
		payload: { ok: true },
		...overrides,
	};
}

describe("LedgerWatcher", () => {
	let tmpDir: string;
	let watcher: LedgerWatcher;
	let events: Array<{ filePath: string; events: EventLog[] }>;
	let errors: Error[];
	let added: string[];

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "ledger-watcher-"));
		events = [];
		errors = [];
		added = [];
		vi.clearAllMocks();
	});

	afterEach(async () => {
		watcher?.close();
		await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	});

	it("emits events from an existing file on start", async () => {
		const filePath = join(tmpDir, "run-a.jsonl");
		await writeFile(filePath, JSON.stringify(makeEvent()) + "\n");

		watcher = new LedgerWatcher({
			eventsDir: tmpDir,
			onEvents: (fp, evts) => events.push({ filePath: fp, events: evts }),
			onError: (err) => errors.push(err),
			onFileAdded: (fp) => added.push(fp),
			debug: false,
		});
		await watcher.start();
		await new Promise((r) => setTimeout(r, 100));

		expect(events.length).toBeGreaterThanOrEqual(1);
		expect(events[0].events.length).toBe(1);
		expect(added).toContain(filePath);
	});

	it("reads append-only from last position", async () => {
		const filePath = join(tmpDir, "run-b.jsonl");
		await writeFile(filePath, JSON.stringify(makeEvent({ id: "1" })) + "\n");

		watcher = new LedgerWatcher({
			eventsDir: tmpDir,
			onEvents: (fp, evts) => events.push({ filePath: fp, events: evts }),
			onError: (err) => errors.push(err),
			debug: false,
		});
		await watcher.start();
		await new Promise((r) => setTimeout(r, 100));

		const firstCount = events.reduce((sum, e) => sum + e.events.length, 0);
		expect(firstCount).toBe(1);

		await appendFile(filePath, JSON.stringify(makeEvent({ id: "2" })) + "\n");
		await new Promise((r) => setTimeout(r, 100));

		// Trigger a scan by creating a new file so the poller or watcher reacts
		const secondCount = events.reduce((sum, e) => sum + e.events.length, 0);
		// Because fs.watch is mocked, we need to manually invoke scan to simulate
		await (watcher as any).scan();

		const finalCount = events.reduce((sum, e) => sum + e.events.length, 0);
		expect(finalCount).toBe(2);
	});

	it("falls back to polling when fs.watch emits an error", async () => {
		const mockWatcher = {
			close: vi.fn(),
			on: vi.fn((event: string, handler: any) => {
				if (event === "error") {
					setTimeout(() => handler(new Error("inotify limit")), 10);
				}
			}),
		};

		const filePath = join(tmpDir, "run-c.jsonl");
		await writeFile(filePath, JSON.stringify(makeEvent()) + "\n");

		watcher = new LedgerWatcher({
			eventsDir: tmpDir,
			onEvents: (fp, evts) => events.push({ filePath: fp, events: evts }),
			onError: (err) => errors.push(err),
			debug: false,
			watchImpl: vi.fn(() => mockWatcher as any),
		});
		await watcher.start();
		await new Promise((r) => setTimeout(r, 200));

		expect(errors.some((e) => e.message.includes("inotify limit"))).toBe(true);
		expect((watcher as any).usingPoll).toBe(true);
	});

	it("handles file deleted mid-read gracefully", async () => {
		const filePath = join(tmpDir, "run-d.jsonl");
		await writeFile(filePath, JSON.stringify(makeEvent()) + "\n");

		watcher = new LedgerWatcher({
			eventsDir: tmpDir,
			onEvents: (fp, evts) => events.push({ filePath: fp, events: evts }),
			onError: (err) => errors.push(err),
			debug: false,
		});
		await watcher.start();

		// Delete after start but before next read
		await rm(filePath);
		await (watcher as any).scan();

		expect(errors.length).toBeGreaterThanOrEqual(1);
	});

	it("handles permission denied gracefully", async () => {
		const filePath = join(tmpDir, "run-e.jsonl");
		await writeFile(filePath, JSON.stringify(makeEvent()) + "\n");
		await chmod(filePath, 0o000);

		watcher = new LedgerWatcher({
			eventsDir: tmpDir,
			onEvents: (fp, evts) => events.push({ filePath: fp, events: evts }),
			onError: (err) => errors.push(err),
			debug: false,
		});
		await watcher.start();
		await new Promise((r) => setTimeout(r, 100));

		expect(errors.length).toBeGreaterThanOrEqual(1);

		await chmod(filePath, 0o644);
	});

	it("tracks malformed and unknown counters via getCounters", async () => {
		const filePath = join(tmpDir, "run-f.jsonl");
		await writeFile(
			filePath,
			JSON.stringify(makeEvent()) +
				"\n" +
				"not json\n" +
				JSON.stringify(makeEvent({ type: "unknown_type" })) +
				"\n",
		);

		watcher = new LedgerWatcher({
			eventsDir: tmpDir,
			onEvents: (fp, evts) => events.push({ filePath: fp, events: evts }),
			onError: (err) => errors.push(err),
			debug: false,
		});
		await watcher.start();
		await new Promise((r) => setTimeout(r, 100));

		const counters = watcher.getCounters();
		expect(counters.malformedLines).toBe(1);
		expect(counters.unknownEventTypes).toBe(1);
	});
});
