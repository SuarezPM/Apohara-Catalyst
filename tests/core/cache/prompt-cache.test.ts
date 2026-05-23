/**
 * Tests for multi-tier prompt cache tracker (G5.I.8).
 */
import { describe, expect, test } from "bun:test";
import { createPromptCache } from "../../../src/core/cache/prompt-cache";

describe("createPromptCache", () => {
	test("starts empty", () => {
		const c = createPromptCache();
		const s = c.stats();
		expect(s.totalHits).toBe(0);
		expect(s.totalMisses).toBe(0);
		expect(s.byTier.full.hits).toBe(0);
		expect(s.byProvider).toEqual({});
	});

	test("records a hit and a miss for the same tier", () => {
		const c = createPromptCache();
		c.record({ provider: "claude", promptHash: "abc", tier: "full", hit: true });
		c.record({ provider: "claude", promptHash: "abc", tier: "full", hit: false });

		const s = c.stats();
		expect(s.byTier.full.hits).toBe(1);
		expect(s.byTier.full.misses).toBe(1);
		expect(s.byTier.full.hitRate).toBeCloseTo(0.5, 5);
	});

	test("tracks per-provider stats independently", () => {
		const c = createPromptCache();
		c.record({ provider: "claude", promptHash: "x", tier: "full", hit: true });
		c.record({ provider: "codex", promptHash: "y", tier: "full", hit: false });
		c.record({ provider: "claude", promptHash: "z", tier: "full", hit: true });

		const s = c.stats();
		expect(s.byProvider.claude.full.hits).toBe(2);
		expect(s.byProvider.claude.full.misses).toBe(0);
		expect(s.byProvider.codex.full.hits).toBe(0);
		expect(s.byProvider.codex.full.misses).toBe(1);
	});

	test("tracks all three tiers separately", () => {
		const c = createPromptCache();
		c.record({ provider: "p", promptHash: "h", tier: "full", hit: true });
		c.record({ provider: "p", promptHash: "h", tier: "system-only", hit: true });
		c.record({ provider: "p", promptHash: "h", tier: "tools-only", hit: false });

		const s = c.stats();
		expect(s.byTier.full.hits).toBe(1);
		expect(s.byTier["system-only"].hits).toBe(1);
		expect(s.byTier["tools-only"].misses).toBe(1);
		expect(s.totalHits).toBe(2);
		expect(s.totalMisses).toBe(1);
	});

	test("rejects unknown tier", () => {
		const c = createPromptCache();
		expect(() =>
			c.record({
				provider: "p",
				promptHash: "h",
				// @ts-expect-error testing runtime guard
				tier: "made-up",
				hit: true,
			}),
		).toThrow(/unknown tier/);
	});

	test("reset() clears everything", () => {
		const c = createPromptCache();
		c.record({ provider: "p", promptHash: "h", tier: "full", hit: true });
		c.reset();
		expect(c.stats().totalHits).toBe(0);
	});

	test("hash() is stable for the same input", () => {
		const c = createPromptCache();
		const a = c.hash("hello");
		const b = c.hash("hello");
		expect(a).toBe(b);
		expect(c.hash("world")).not.toBe(a);
		expect(a.length).toBe(32);
	});

	test("response cache stores and retrieves", () => {
		const c = createPromptCache();
		c.setCachedResponse("p", "abc", "hello");
		expect(c.getCachedResponse("p", "abc")).toBe("hello");
	});

	test("response cache returns undefined on miss", () => {
		const c = createPromptCache();
		expect(c.getCachedResponse("p", "missing")).toBeUndefined();
	});

	test("response cache scopes by provider", () => {
		const c = createPromptCache();
		c.setCachedResponse("a", "key", "A");
		c.setCachedResponse("b", "key", "B");
		expect(c.getCachedResponse("a", "key")).toBe("A");
		expect(c.getCachedResponse("b", "key")).toBe("B");
	});

	test("response cache evicts LRU past the cap", () => {
		const c = createPromptCache({ maxResponses: 3 });
		c.setCachedResponse("p", "1", "v1");
		c.setCachedResponse("p", "2", "v2");
		c.setCachedResponse("p", "3", "v3");
		c.setCachedResponse("p", "4", "v4"); // evicts "1"
		expect(c.getCachedResponse("p", "1")).toBeUndefined();
		expect(c.getCachedResponse("p", "4")).toBe("v4");
	});

	test("response cache LRU bump preserves recently accessed entries", () => {
		const c = createPromptCache({ maxResponses: 2 });
		c.setCachedResponse("p", "1", "v1");
		c.setCachedResponse("p", "2", "v2");
		// touch "1" → it's now most-recent
		c.getCachedResponse("p", "1");
		c.setCachedResponse("p", "3", "v3"); // should evict "2", not "1"
		expect(c.getCachedResponse("p", "1")).toBe("v1");
		expect(c.getCachedResponse("p", "2")).toBeUndefined();
		expect(c.getCachedResponse("p", "3")).toBe("v3");
	});

	test("hit rate computes correctly for a typical workload", () => {
		const c = createPromptCache();
		for (let i = 0; i < 9; i++) {
			c.record({
				provider: "claude",
				promptHash: "h",
				tier: "full",
				hit: true,
			});
		}
		c.record({ provider: "claude", promptHash: "h", tier: "full", hit: false });
		expect(c.stats().byTier.full.hitRate).toBeCloseTo(0.9, 5);
	});
});
