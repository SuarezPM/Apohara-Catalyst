import { beforeEach, expect, test } from "bun:test";
import { EmptyClaimCache } from "../../../src/core/orchestration/emptyClaimCache";

let cache: EmptyClaimCache;
beforeEach(() => {
	cache = new EmptyClaimCache();
});

test("starts at version 0", () => {
	expect(cache.version()).toBe(0);
});

test("recordEmptyClaim increments version monotonically", () => {
	cache.recordEmptyClaim("worker-1");
	expect(cache.version()).toBe(1);
	cache.recordEmptyClaim("worker-1");
	expect(cache.version()).toBe(2);
	cache.recordEmptyClaim("worker-2");
	expect(cache.version()).toBe(3);
});

test("shouldRepoll returns true when worker has never polled", () => {
	cache.recordEmptyClaim("worker-1");
	expect(cache.shouldRepoll("worker-2", undefined)).toBe(true);
});

test("shouldRepoll returns true when version advanced since lastSeen", () => {
	cache.recordEmptyClaim("worker-1");
	const seen = cache.version();
	cache.recordEmptyClaim("worker-2"); // another worker bumps version
	expect(cache.shouldRepoll("worker-1", seen)).toBe(true);
});

test("shouldRepoll returns false when version unchanged", () => {
	cache.recordEmptyClaim("worker-1");
	const seen = cache.version();
	expect(cache.shouldRepoll("worker-1", seen)).toBe(false);
});

test("forceBump increments version even without empty claim (TTL path)", () => {
	const before = cache.version();
	cache.forceBump("ttl-tick");
	expect(cache.version()).toBe(before + 1);
});

test("tracks worker count for diagnostics", () => {
	expect(cache.workerCount()).toBe(0);
	cache.recordEmptyClaim("worker-1");
	cache.recordEmptyClaim("worker-2");
	cache.recordEmptyClaim("worker-1"); // re-poll, same worker
	expect(cache.workerCount()).toBe(2);
});

test("resets cleanly", () => {
	cache.recordEmptyClaim("worker-1");
	cache.recordEmptyClaim("worker-2");
	cache.reset();
	expect(cache.version()).toBe(0);
	expect(cache.workerCount()).toBe(0);
});

test("supports auto-bump via startAutoBump and stopAutoBump", async () => {
	const c = new EmptyClaimCache();
	const before = c.version();
	const stop = c.startAutoBump(20); // 20ms tick
	try {
		await new Promise((r) => setTimeout(r, 65));
		expect(c.version()).toBeGreaterThanOrEqual(before + 2);
	} finally {
		stop();
	}
});
