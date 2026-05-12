import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	EventLedger,
	GENESIS_PREV_HASH,
	LEDGER_VERSION,
} from "../src/core/ledger";
import type { EventLog } from "../src/core/types";

async function readLines(filePath: string): Promise<EventLog[]> {
	const content = await readFile(filePath, "utf-8");
	return content
		.split("\n")
		.filter((l) => l.length > 0)
		.map((l) => JSON.parse(l) as EventLog);
}

describe("EventLedger — SHA-256 hash chain (Phase 4.1)", () => {
	let dir: string;
	let filePath: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-ledger-"));
		filePath = join(dir, "run-test.jsonl");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("emits a genesis block as the first line", async () => {
		const ledger = new EventLedger("test-run", { filePath });
		await ledger.log("noop", { foo: "bar" });

		const lines = await readLines(filePath);
		expect(lines.length).toBe(2);

		const genesis = lines[0];
		expect(genesis.type).toBe("genesis");
		expect(genesis.prev_hash).toBe(GENESIS_PREV_HASH);
		expect(genesis.payload.runId).toBe("test-run");
		expect(genesis.payload.ledgerVersion).toBe(LEDGER_VERSION);
		expect(typeof genesis.hash).toBe("string");
		expect(genesis.hash?.length).toBe(64);
	});

	it("chains hashes: each event's prev_hash equals previous event's hash", async () => {
		const ledger = new EventLedger("chain-test", { filePath });
		await ledger.log("a", { i: 1 });
		await ledger.log("b", { i: 2 });
		await ledger.log("c", { i: 3 });

		const lines = await readLines(filePath);
		expect(lines.length).toBe(4); // genesis + 3 events

		for (let i = 1; i < lines.length; i++) {
			expect(lines[i].prev_hash).toBe(lines[i - 1].hash);
		}
	});

	it("preserves chain consistency under concurrent log() calls", async () => {
		const ledger = new EventLedger("concurrent", { filePath });
		await Promise.all([
			ledger.log("a", { i: 1 }),
			ledger.log("b", { i: 2 }),
			ledger.log("c", { i: 3 }),
			ledger.log("d", { i: 4 }),
			ledger.log("e", { i: 5 }),
		]);

		const lines = await readLines(filePath);
		expect(lines.length).toBe(6); // genesis + 5 events

		for (let i = 1; i < lines.length; i++) {
			expect(lines[i].prev_hash).toBe(lines[i - 1].hash);
		}
	});
});

describe("EventLedger.verify() — tamper detection (Phase 4.3)", () => {
	let dir: string;
	let filePath: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-ledger-"));
		filePath = join(dir, "run-test.jsonl");
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	it("returns ok for an untouched ledger", async () => {
		const ledger = new EventLedger("verify-ok", { filePath });
		await ledger.log("a", { i: 1 });
		await ledger.log("b", { i: 2 });
		await ledger.log("c", { i: 3 });

		const result = await EventLedger.verify(filePath);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.legacy).toBe(false);
			expect(result.events).toBe(4);
		}
	});

	it("detects mutated payload", async () => {
		const ledger = new EventLedger("mutate-payload", { filePath });
		await ledger.log("a", { i: 1 });
		await ledger.log("b", { i: 2 });

		const content = await readFile(filePath, "utf-8");
		const lines = content.split("\n").filter((l) => l.length > 0);
		const evt = JSON.parse(lines[1]) as EventLog;
		evt.payload = { i: 999 }; // tamper
		lines[1] = JSON.stringify(evt);
		await writeFile(filePath, `${lines.join("\n")}\n`, "utf-8");

		const result = await EventLedger.verify(filePath);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.brokenAt).toBe(1);
			expect(result.reason).toContain("hash mismatch");
		}
	});

	it("detects mutated hash field", async () => {
		const ledger = new EventLedger("mutate-hash", { filePath });
		await ledger.log("a", { i: 1 });

		const content = await readFile(filePath, "utf-8");
		const lines = content.split("\n").filter((l) => l.length > 0);
		const evt = JSON.parse(lines[1]) as EventLog;
		evt.hash = "f".repeat(64); // tamper
		lines[1] = JSON.stringify(evt);
		await writeFile(filePath, `${lines.join("\n")}\n`, "utf-8");

		const result = await EventLedger.verify(filePath);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.brokenAt).toBe(1);
	});

	it("detects broken prev_hash linkage", async () => {
		const ledger = new EventLedger("break-link", { filePath });
		await ledger.log("a", { i: 1 });
		await ledger.log("b", { i: 2 });

		const content = await readFile(filePath, "utf-8");
		const lines = content.split("\n").filter((l) => l.length > 0);
		const evt = JSON.parse(lines[2]) as EventLog;
		evt.prev_hash = "0".repeat(64); // wrong link
		lines[2] = JSON.stringify(evt);
		await writeFile(filePath, `${lines.join("\n")}\n`, "utf-8");

		const result = await EventLedger.verify(filePath);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain("prev_hash");
	});

	it("returns legacy=true for pre-Phase-4 files (no hashes)", async () => {
		const legacyEvents = [
			{
				id: "11111111-1111-1111-1111-111111111111",
				timestamp: "2026-01-01T00:00:00.000Z",
				type: "old_event",
				severity: "info",
				payload: { msg: "legacy" },
			},
			{
				id: "22222222-2222-2222-2222-222222222222",
				timestamp: "2026-01-01T00:00:01.000Z",
				type: "old_event",
				severity: "info",
				payload: { msg: "legacy2" },
			},
		];
		await writeFile(
			filePath,
			`${legacyEvents.map((e) => JSON.stringify(e)).join("\n")}\n`,
			"utf-8",
		);

		const result = await EventLedger.verify(filePath);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.legacy).toBe(true);
			expect(result.events).toBe(2);
		}
	});

	it("rejects mixed legacy + hashed events", async () => {
		const ledger = new EventLedger("mixed", { filePath });
		await ledger.log("a", { i: 1 });
		const legacyLine = JSON.stringify({
			id: "33333333-3333-3333-3333-333333333333",
			timestamp: "2026-01-01T00:00:00.000Z",
			type: "old_event",
			severity: "info",
			payload: {},
		});
		const existing = await readFile(filePath, "utf-8");
		await writeFile(filePath, `${existing}${legacyLine}\n`, "utf-8");

		const result = await EventLedger.verify(filePath);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toContain("Mixed");
	});

	it("returns brokenAt=-1 with read error for missing file", async () => {
		const result = await EventLedger.verify(join(dir, "does-not-exist.jsonl"));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.brokenAt).toBe(-1);
			expect(result.reason).toContain("Cannot read");
		}
	});
});
