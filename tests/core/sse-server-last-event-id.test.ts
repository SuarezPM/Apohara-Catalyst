/**
 * G5.F.8 — Server-side Last-Event-ID handling (agentrail #12).
 *
 * G5.C.8 implemented the CLIENT side (`SseReconnectTracker`). G5.F.8
 * implements the SERVER side: when a client reconnects with the
 * `Last-Event-ID` header, the server replays only the events AFTER that
 * id instead of re-streaming the whole ledger.
 *
 * The handler scans a JSONL ledger file, finds the anchor line by event
 * id, and returns the strictly-newer slice. `null` anchor means "fresh
 * connection, deliver everything"; "unknown anchor" returns the full
 * tail (the server's log rotated past the client's anchor; the client
 * is responsible for de-duping by id).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	resolveLastEventId,
	replayAfter,
} from "../../src/core/sse-server";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "apohara-sse-server-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("G5.F.8 — resolveLastEventId", () => {
	test("returns null when header is absent", () => {
		const req = new Request("http://localhost/x");
		expect(resolveLastEventId(req)).toBeNull();
	});

	test("returns the header value when set", () => {
		const req = new Request("http://localhost/x", {
			headers: { "Last-Event-ID": "evt-42" },
		});
		expect(resolveLastEventId(req)).toBe("evt-42");
	});

	test("falls back to the lastEventId query param if header is missing", () => {
		const req = new Request("http://localhost/x?lastEventId=evt-7");
		expect(resolveLastEventId(req)).toBe("evt-7");
	});

	test("rejects malformed event ids (newline injection via query param)", () => {
		// Headers reject \n at construction time, so we exercise the
		// query-param fallback where a hostile URL CAN carry one.
		const req = new Request("http://localhost/x?lastEventId=evt%0A42");
		expect(resolveLastEventId(req)).toBeNull();
	});

	test("rejects empty strings — per EventSource spec, empty id resets to null", () => {
		const req = new Request("http://localhost/x", {
			headers: { "Last-Event-ID": "" },
		});
		expect(resolveLastEventId(req)).toBeNull();
	});
});

describe("G5.F.8 — replayAfter", () => {
	async function writeLedger(events: Array<{ id: string; type: string }>) {
		const path = join(dir, "run-x.jsonl");
		const body = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
		await writeFile(path, body);
		return path;
	}

	test("null anchor → all lines", async () => {
		const path = await writeLedger([
			{ id: "a", type: "t1" },
			{ id: "b", type: "t2" },
		]);
		const lines = await replayAfter(path, null);
		expect(lines).toHaveLength(2);
	});

	test("known anchor → strictly newer lines", async () => {
		const path = await writeLedger([
			{ id: "a", type: "t1" },
			{ id: "b", type: "t2" },
			{ id: "c", type: "t3" },
		]);
		const lines = await replayAfter(path, "a");
		expect(lines).toHaveLength(2);
		expect(lines[0]).toContain('"id":"b"');
	});

	test("anchor at tail → empty", async () => {
		const path = await writeLedger([
			{ id: "a", type: "t1" },
			{ id: "b", type: "t2" },
		]);
		const lines = await replayAfter(path, "b");
		expect(lines).toEqual([]);
	});

	test("unknown anchor → full tail (client de-dupes by id)", async () => {
		const path = await writeLedger([
			{ id: "a", type: "t1" },
			{ id: "b", type: "t2" },
		]);
		const lines = await replayAfter(path, "evt-rotated-away");
		expect(lines).toHaveLength(2);
	});

	test("malformed JSON lines are skipped, not poisoning the anchor scan", async () => {
		const path = join(dir, "run-bad.jsonl");
		await writeFile(
			path,
			`{"id":"a","type":"t1"}\nnot-json\n{"id":"b","type":"t2"}\n`,
		);
		const lines = await replayAfter(path, "a");
		expect(lines).toHaveLength(1);
		expect(lines[0]).toContain('"id":"b"');
	});
});
