/**
 * G7.C.4 — Last-Event-ID server-side helpers (agentrail #12).
 *
 * Covers:
 *   - `resolveLastEventId`: header > query param > null.
 *     - Rejects empty + newline-injected ids.
 *   - `replayAfter`: pure file scan, anchored to a JSONL `id` field.
 *     - null anchor → all valid lines.
 *     - Known anchor → strict-after.
 *     - Unknown anchor → full tail (rotated past).
 *     - Malformed lines dropped pre-anchor scan.
 *     - Missing file → [].
 */
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayAfter, resolveLastEventId } from "./sse-server.js";

function req(opts: { header?: string; query?: string }): Request {
	const url =
		opts.query !== undefined
			? `http://x/?lastEventId=${encodeURIComponent(opts.query)}`
			: "http://x/";
	const headers: Record<string, string> = {};
	if (opts.header !== undefined) headers["last-event-id"] = opts.header;
	return new Request(url, { headers });
}

describe("resolveLastEventId", () => {
	it("returns null when neither header nor query present", () => {
		expect(resolveLastEventId(req({}))).toBeNull();
	});

	it("reads the Last-Event-ID header when present", () => {
		expect(resolveLastEventId(req({ header: "evt-42" }))).toBe("evt-42");
	});

	it("reads the ?lastEventId= query when header is missing", () => {
		expect(resolveLastEventId(req({ query: "evt-99" }))).toBe("evt-99");
	});

	it("prefers header over query when both present", () => {
		expect(
			resolveLastEventId(req({ header: "from-header", query: "from-query" })),
		).toBe("from-header");
	});

	it("treats empty header as null (no anchor)", () => {
		expect(resolveLastEventId(req({ header: "" }))).toBeNull();
	});

	it("rejects newline-injected ids via query param (header path is sanitized by Bun)", () => {
		// Bun's `Request` constructor rejects `\n` in header values directly, so
		// the only injection vector that can actually reach `resolveLastEventId`
		// is the query parameter — which we explicitly reject with the
		// `/[\n\r]/` guard.
		expect(resolveLastEventId(req({ query: "good\nbad" }))).toBeNull();
	});

	it("rejects carriage-return-injected ids via query param", () => {
		expect(resolveLastEventId(req({ query: "x\r" }))).toBeNull();
	});

	it("survives UUID-shaped ids untouched", () => {
		const uuid = "01996b00-2a4d-7c4e-9f1a-43e2c0a1b2c3";
		expect(resolveLastEventId(req({ header: uuid }))).toBe(uuid);
	});
});

describe("replayAfter", () => {
	let dir: string;
	let path: string;
	beforeAll(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-sse-"));
		path = join(dir, "ledger.jsonl");
	});
	afterAll(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("returns [] when the file is missing", async () => {
		const missing = join(dir, "no-such-file.jsonl");
		expect(await replayAfter(missing, null)).toEqual([]);
	});

	it("returns all valid lines when anchor is null", async () => {
		const lines = [
			JSON.stringify({ id: "a", type: "x" }),
			JSON.stringify({ id: "b", type: "y" }),
			JSON.stringify({ id: "c", type: "z" }),
		];
		await writeFile(path, `${lines.join("\n")}\n`);
		const out = await replayAfter(path, null);
		expect(out).toEqual(lines);
	});

	it("returns strict-after when anchor is known", async () => {
		const out = await replayAfter(path, "a");
		expect(out.length).toBe(2);
		expect(JSON.parse(out[0]).id).toBe("b");
		expect(JSON.parse(out[1]).id).toBe("c");
	});

	it("returns full tail when anchor is unknown (server rotated past)", async () => {
		const out = await replayAfter(path, "missing-anchor");
		expect(out.length).toBe(3);
	});

	it("returns [] when anchor is the last id", async () => {
		const out = await replayAfter(path, "c");
		expect(out).toEqual([]);
	});

	it("skips malformed lines before anchor scan", async () => {
		const lines = [
			JSON.stringify({ id: "a" }),
			"not-json-at-all",
			JSON.stringify({ id: "b" }),
			"",
			JSON.stringify({ id: "c" }),
		];
		await writeFile(path, `${lines.join("\n")}\n`);
		const out = await replayAfter(path, "a");
		expect(out.length).toBe(2);
		expect(JSON.parse(out[0]).id).toBe("b");
		expect(JSON.parse(out[1]).id).toBe("c");
	});
});
