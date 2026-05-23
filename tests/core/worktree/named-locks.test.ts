/**
 * Tests for per-worktree named locks (G5.I.7).
 */
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	acquireLock,
	withLock,
} from "../../../src/core/worktree/named-locks";

describe("acquireLock", () => {
	let dir: string;

	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-lock-test-"));
	});

	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test("acquires and releases a lock", async () => {
		const lock = await acquireLock({ lockDir: dir, worktreeId: "alpha" });
		await lock.release();
	});

	test("rejects malformed worktreeId", async () => {
		await expect(
			acquireLock({ lockDir: dir, worktreeId: "../escape" }),
		).rejects.toThrow(/invalid worktreeId/);
	});

	test("serializes two callers on the same id (FIFO)", async () => {
		const order: string[] = [];

		const a = (async () => {
			const lock = await acquireLock({
				lockDir: dir,
				worktreeId: "shared",
			});
			order.push("a-acquired");
			await new Promise((r) => setTimeout(r, 50));
			order.push("a-releasing");
			await lock.release();
		})();

		// Tiny delay so 'a' wins the race for the lock.
		await new Promise((r) => setTimeout(r, 5));

		const b = (async () => {
			const lock = await acquireLock({
				lockDir: dir,
				worktreeId: "shared",
				timeoutMs: 2000,
			});
			order.push("b-acquired");
			await lock.release();
		})();

		await Promise.all([a, b]);
		expect(order).toEqual(["a-acquired", "a-releasing", "b-acquired"]);
	});

	test("allows concurrent locks on DIFFERENT ids", async () => {
		const start = Date.now();
		const a = acquireLock({ lockDir: dir, worktreeId: "id-a" });
		const b = acquireLock({ lockDir: dir, worktreeId: "id-b" });
		const [la, lb] = await Promise.all([a, b]);
		const elapsed = Date.now() - start;
		// Both should acquire near-instantaneously.
		expect(elapsed).toBeLessThan(500);
		await la.release();
		await lb.release();
	});

	test("times out when the lock is held longer than timeoutMs", async () => {
		const first = await acquireLock({ lockDir: dir, worktreeId: "slow" });
		const startedAt = Date.now();
		await expect(
			acquireLock({
				lockDir: dir,
				worktreeId: "slow",
				timeoutMs: 100,
				pollMs: 10,
			}),
		).rejects.toThrow(/timed out/);
		const elapsed = Date.now() - startedAt;
		expect(elapsed).toBeGreaterThanOrEqual(80);
		await first.release();
	});

	test("reclaims a stale on-disk lock", async () => {
		// Plant a stale lock file directly.
		const lockPath = join(dir, "stale.lock");
		await writeFile(
			lockPath,
			JSON.stringify({ pid: 999999, acquiredAt: "2020-01-01" }),
		);
		// Backdate its mtime well past the staleness threshold (1 hour ago).
		const ancient = new Date(Date.now() - 60 * 60 * 1000);
		await utimes(lockPath, ancient, ancient);

		const lock = await acquireLock({
			lockDir: dir,
			worktreeId: "stale",
			staleMs: 1000,
			timeoutMs: 1000,
		});
		await lock.release();
	});

	test("release() is idempotent", async () => {
		const lock = await acquireLock({ lockDir: dir, worktreeId: "idem" });
		await lock.release();
		await lock.release(); // must not throw
	});
});

describe("withLock", () => {
	let dir: string;
	beforeEach(async () => {
		dir = await mkdtemp(join(tmpdir(), "apohara-lock-test-"));
	});
	afterEach(async () => {
		await rm(dir, { recursive: true, force: true });
	});

	test("runs the callback while holding the lock and releases after", async () => {
		const value = await withLock(
			{ lockDir: dir, worktreeId: "w" },
			async () => {
				return 42;
			},
		);
		expect(value).toBe(42);
		// The lock should be released — acquiring again must succeed.
		const second = await acquireLock({ lockDir: dir, worktreeId: "w" });
		await second.release();
	});

	test("releases the lock even if the callback throws", async () => {
		await expect(
			withLock({ lockDir: dir, worktreeId: "w" }, async () => {
				throw new Error("boom");
			}),
		).rejects.toThrow("boom");
		const second = await acquireLock({
			lockDir: dir,
			worktreeId: "w",
			timeoutMs: 200,
		});
		await second.release();
	});
});
