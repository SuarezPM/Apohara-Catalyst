/**
 * Tests for the strategy-tracker adapter (symphony #15, G5.G.9).
 *
 * The persistent `FailureTracker` writes JSON to a tmpdir on every
 * recordFailure / recordSuccess. That is the right behaviour in
 * production (state survives crashes) but absolutely the wrong
 * behaviour in tests (slow, polluting). The adapter splits the public
 * contract into an interface so the consumer (Coordinator, Verifier,
 * decision gates) reads the same `StrategyTracker` either way.
 *
 * The adapter also adds a `peek` that does not bump the counter — used
 * by the dashboard humanizer (G5.G.7) and the coordinator's heuristics
 * which want to read "how many consecutive bash failures so far?"
 * without recording another event.
 */

import { test, expect, describe, beforeEach } from "bun:test";
import {
	InMemoryStrategyTracker,
	type StrategyTracker,
	type ToolKind,
} from "../../../src/core/anti-thrash/tracker-adapter";

describe("InMemoryStrategyTracker", () => {
	let t: StrategyTracker;
	beforeEach(() => {
		t = new InMemoryStrategyTracker(/* threshold */ 2);
	});

	test("first failure below threshold returns triggered=false", async () => {
		const r = await t.recordFailure("bash");
		expect(r.triggered).toBe(false);
		expect(r.failure_count).toBe(1);
		expect(r.tool).toBe("bash");
	});

	test("second consecutive failure trips the threshold", async () => {
		await t.recordFailure("bash");
		const r = await t.recordFailure("bash");
		expect(r.triggered).toBe(true);
		expect(r.failure_count).toBe(2);
		expect(r.additionalContext.length).toBeGreaterThan(0);
	});

	test("recordSuccess resets the counter for that tool only", async () => {
		await t.recordFailure("bash");
		await t.recordSuccess("bash");
		const counts = await t.currentCounts();
		expect(counts.bash_failures).toBe(0);
		// Other tools untouched.
		expect(counts.edit_failures).toBe(0);
	});

	test("failures on different tools are tracked independently", async () => {
		await t.recordFailure("bash");
		await t.recordFailure("bash");
		const r = await t.recordFailure("edit");
		expect(r.triggered).toBe(false);
		const counts = await t.currentCounts();
		expect(counts.bash_failures).toBe(2);
		expect(counts.edit_failures).toBe(1);
	});

	test("peek does NOT bump the counter", async () => {
		await t.recordFailure("bash");
		const before = (await t.currentCounts()).bash_failures;
		const peeked = await t.peek("bash");
		const after = (await t.currentCounts()).bash_failures;
		expect(peeked).toBe(before);
		expect(after).toBe(before);
	});

	test("peek returns 0 for an untouched tool", async () => {
		expect(await t.peek("write")).toBe(0);
	});

	test("dispose clears all counters", async () => {
		await t.recordFailure("bash");
		await t.dispose();
		const counts = await t.currentCounts();
		expect(counts.bash_failures).toBe(0);
	});

	test("custom threshold respected", async () => {
		const tt = new InMemoryStrategyTracker(3);
		const a = await tt.recordFailure("bash");
		const b = await tt.recordFailure("bash");
		const c = await tt.recordFailure("bash");
		expect(a.triggered).toBe(false);
		expect(b.triggered).toBe(false);
		expect(c.triggered).toBe(true);
	});

	test("rotation directive references the offending tool by name", async () => {
		await t.recordFailure("edit");
		const r = await t.recordFailure("edit");
		expect(r.additionalContext.toLowerCase()).toContain("edit");
	});

	test("all ToolKind variants are accepted without error", async () => {
		const kinds: ToolKind[] = ["bash", "edit", "write", "web", "other"];
		for (const k of kinds) {
			const r = await t.recordFailure(k);
			expect(r.tool).toBe(k);
		}
	});
});
