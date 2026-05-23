/**
 * Symphony §3.8 — Continuation vs Failure retry semantics (G5.B.8).
 *
 * Apohara's dispatcher previously treated all retries the same way
 * (or didn't retry at all). Symphony distinguishes two retry FLAVOURS:
 *
 *   Continuation retry — the agent answered successfully but the
 *                        higher-level intent says "more work needed"
 *                        (continuation chain, see continuation.ts).
 *                        Context is PRESERVED (system prompt + history
 *                        in same thread). Delay is FIXED 1s.
 *   Failure retry      — the agent failed (transient error: rate
 *                        limit, network, stall). Context is RESET
 *                        (fresh thread, fresh system prompt). Delay is
 *                        EXPONENTIAL with a cap of 5 min.
 *
 *   nextDelay({ reason, attempt }) → delayMs
 *   classifyRetryReason(error)      → "continuation" | "transient" |
 *                                     "stall" | "provider_error" | "none"
 *   shouldPreserveContext(reason)   → bool
 *   shouldRetry(reason, attempt, maxAttempts) → bool
 */
import { expect, test } from "bun:test";
import {
	classifyRetryReason,
	nextDelay,
	shouldPreserveContext,
	shouldRetry,
	type RetryReason,
} from "../../../src/core/dispatch/retry-semantics";

test("nextDelay: continuation reason = fixed 1000 ms regardless of attempt", () => {
	expect(nextDelay({ reason: "continuation", attempt: 0 })).toBe(1000);
	expect(nextDelay({ reason: "continuation", attempt: 5 })).toBe(1000);
});

test("nextDelay: transient reason = exponential 1s × 2^attempt, capped at 5min", () => {
	expect(nextDelay({ reason: "transient", attempt: 0 })).toBe(1000);
	expect(nextDelay({ reason: "transient", attempt: 1 })).toBe(2000);
	expect(nextDelay({ reason: "transient", attempt: 2 })).toBe(4000);
	expect(nextDelay({ reason: "transient", attempt: 8 })).toBe(256_000);
	// At attempt=9, 2^9 = 512_000, still below cap
	expect(nextDelay({ reason: "transient", attempt: 9 })).toBe(300_000); // capped
	expect(nextDelay({ reason: "transient", attempt: 100 })).toBe(300_000);
});

test("nextDelay: stall reason = exponential same as transient", () => {
	expect(nextDelay({ reason: "stall", attempt: 0 })).toBe(1000);
	expect(nextDelay({ reason: "stall", attempt: 3 })).toBe(8000);
});

test("nextDelay: provider_error attempts 0 = 1s, attempt 1 = 2s (subset of exponential)", () => {
	expect(nextDelay({ reason: "provider_error", attempt: 0 })).toBe(1000);
	expect(nextDelay({ reason: "provider_error", attempt: 1 })).toBe(2000);
});

test("nextDelay: none reason returns 0 (no retry)", () => {
	expect(nextDelay({ reason: "none", attempt: 0 })).toBe(0);
});

test("classifyRetryReason: stall keywords → stall", () => {
	expect(classifyRetryReason(new Error("worker stalled after 60s"))).toBe("stall");
	expect(classifyRetryReason(new Error("STALL detected"))).toBe("stall");
});

test("classifyRetryReason: timeout keywords → transient", () => {
	expect(classifyRetryReason(new Error("request timed out"))).toBe("transient");
	expect(classifyRetryReason(new Error("ETIMEDOUT"))).toBe("transient");
});

test("classifyRetryReason: rate limit → transient", () => {
	expect(classifyRetryReason(new Error("429 rate limit exceeded"))).toBe("transient");
});

test("classifyRetryReason: network → transient", () => {
	expect(classifyRetryReason(new Error("ECONNRESET"))).toBe("transient");
	expect(classifyRetryReason(new Error("network unreachable"))).toBe("transient");
});

test("classifyRetryReason: provider 5xx → provider_error", () => {
	expect(classifyRetryReason(new Error("Provider returned 500"))).toBe("provider_error");
	expect(classifyRetryReason(new Error("502 bad gateway"))).toBe("provider_error");
});

test("classifyRetryReason: unknown error → 'none' (no retry by default)", () => {
	expect(classifyRetryReason(new Error("invalid JSON in spec"))).toBe("none");
});

test("shouldPreserveContext: only continuation reason preserves context", () => {
	const tests: [RetryReason, boolean][] = [
		["continuation", true],
		["transient", false],
		["stall", false],
		["provider_error", false],
		["none", false],
	];
	for (const [r, expected] of tests) {
		expect(shouldPreserveContext(r)).toBe(expected);
	}
});

test("shouldRetry: continuation retries up to maxAttempts", () => {
	expect(shouldRetry("continuation", 0, 3)).toBe(true);
	expect(shouldRetry("continuation", 2, 3)).toBe(true);
	expect(shouldRetry("continuation", 3, 3)).toBe(false);
});

test("shouldRetry: 'none' never retries", () => {
	expect(shouldRetry("none", 0, 3)).toBe(false);
});

test("shouldRetry: transient/stall/provider_error retry up to max", () => {
	for (const r of ["transient", "stall", "provider_error"] as const) {
		expect(shouldRetry(r, 0, 3)).toBe(true);
		expect(shouldRetry(r, 3, 3)).toBe(false);
	}
});
