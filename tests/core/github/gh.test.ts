import { afterEach, expect, test } from "bun:test";
import { _resetRateState, getRateState } from "../../../src/core/github/gh";

afterEach(() => _resetRateState());

test("getRateState exposes current window stats", async () => {
	const s = await getRateState();
	expect(s.callsInWindow).toBe(0);
	expect(s.limitPerMin).toBeGreaterThan(0);
	expect(s.cooldownUntilMs).toBe(0);
});

// Functional gh tests live in `gh.smoke.test.ts` (skipped by default —
// they require `gh auth login` on the host machine and consume real
// API quota). The wrapper's pure logic (rate-limit state, env
// sanitization) is what we cover here.
