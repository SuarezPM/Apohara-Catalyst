/**
 * G5.F.2 — Idempotency-Key + JSONL replay 72h.
 *
 * Every dispatched task carries an idempotency key (UUID). The ledger
 * remembers seen keys for 72 hours; a reconnect / restart that re-submits
 * the same task within the window MUST NOT duplicate work — the store
 * returns the prior result instead of re-dispatching.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdempotencyLedger } from "../../../src/core/ledger/idempotency";

let dir: string;
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), "apohara-idem-"));
});
afterEach(async () => {
	await rm(dir, { recursive: true, force: true });
});

describe("G5.F.2 — IdempotencyLedger", () => {
	test("first record() of a key is not a duplicate", async () => {
		const led = new IdempotencyLedger(join(dir, "idem.jsonl"));
		const result = await led.record("k-1", { ok: true });
		expect(result.duplicate).toBe(false);
		expect(result.prior).toBeUndefined();
	});

	test("second record() of same key is duplicate with prior result", async () => {
		const led = new IdempotencyLedger(join(dir, "idem.jsonl"));
		await led.record("k-2", { ok: true, content: "first" });
		const second = await led.record("k-2", { ok: true, content: "second" });
		expect(second.duplicate).toBe(true);
		expect((second.prior as { content?: string })?.content).toBe("first");
	});

	test("survives restart — second instance reads prior keys from disk", async () => {
		const path = join(dir, "idem.jsonl");
		const a = new IdempotencyLedger(path);
		await a.record("k-3", { v: 1 });
		const b = new IdempotencyLedger(path);
		await b.load();
		const replay = await b.record("k-3", { v: 2 });
		expect(replay.duplicate).toBe(true);
		expect((replay.prior as { v?: number })?.v).toBe(1);
	});

	test("expired entries (>72h) are not duplicates", async () => {
		const path = join(dir, "idem.jsonl");
		const fakeNow = 1_000_000_000_000;
		const led = new IdempotencyLedger(path, {
			retentionMs: 72 * 60 * 60 * 1000,
			now: () => fakeNow,
		});
		await led.record("k-old", { v: 1 });
		// Re-open with clock advanced past retention
		const later = new IdempotencyLedger(path, {
			retentionMs: 72 * 60 * 60 * 1000,
			now: () => fakeNow + 73 * 60 * 60 * 1000,
		});
		await later.load();
		const fresh = await later.record("k-old", { v: 2 });
		expect(fresh.duplicate).toBe(false);
	});

	test("compact() drops expired entries from disk", async () => {
		const path = join(dir, "idem.jsonl");
		const fakeNow = 2_000_000_000_000;
		const led = new IdempotencyLedger(path, {
			retentionMs: 1000,
			now: () => fakeNow,
		});
		await led.record("k-a", { v: 1 });
		await led.record("k-b", { v: 2 });
		// Advance clock so both expire
		const advanced = new IdempotencyLedger(path, {
			retentionMs: 1000,
			now: () => fakeNow + 5000,
		});
		await advanced.load();
		await advanced.compact();
		const raw = await readFile(path, "utf-8");
		expect(raw.trim()).toBe(""); // both expired → empty
	});

	test("record() persists to disk so a fresh load sees the entry", async () => {
		const path = join(dir, "idem.jsonl");
		const led = new IdempotencyLedger(path);
		await led.record("k-persist", { v: 99 });
		const raw = await readFile(path, "utf-8");
		expect(raw).toContain("k-persist");
		expect(raw).toContain('"v":99');
	});

	test("malformed lines are skipped without poisoning the load", async () => {
		const path = join(dir, "idem.jsonl");
		const led = new IdempotencyLedger(path);
		await led.record("k-good", { v: 1 });
		// Append a garbage line
		const { appendFile } = await import("node:fs/promises");
		await appendFile(path, "this-is-not-json\n");
		const fresh = new IdempotencyLedger(path);
		await fresh.load();
		const replay = await fresh.record("k-good", { v: 2 });
		expect(replay.duplicate).toBe(true);
	});
});
