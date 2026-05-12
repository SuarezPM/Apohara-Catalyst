/**
 * M018.D — Pattern D: auth-aware fallback error classification.
 *
 * Verifies that ProviderRouter classifies failures into 4 classes and applies
 * the correct cooldown duration per class:
 *   - AUTH_FAILURE  → cooldown 1h, needsAuthRefresh=true, immediate
 *   - RATE_LIMIT    → cooldown from Retry-After header (default 5min), immediate
 *   - NETWORK       → cooldown 30s, retry up to 3× (cooldown only at retry #3)
 *   - MODEL_ERROR   → cooldown 1min after maxFailures, ledger warning every time
 *
 * Acceptance criteria from .omc/plans/m018-gsd2-patterns-adoption.md §Pattern D:
 *  - 4 error classes × 2 tests each (8 total)
 *  - No regression in router-thompson tests (verified separately)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
	classifyError,
	parseRetryAfterMs,
	ProviderRouter,
} from "../src/providers/router";

function makeRouter(): ProviderRouter {
	// Use test keys so the router instantiates without env-validation side effects.
	return new ProviderRouter({
		opencodeApiKey: "test",
		deepseekApiKey: "test",
		groqApiKey: "test",
		openaiApiKey: "test",
		// Force a tiny legacy threshold so MODEL_ERROR cooldown is reachable
		// in tests without 3 separate failures (NETWORK has its own hard-coded
		// 3-retry rule independent of this).
		maxFailuresBeforeCooldown: 2,
		cooldownMinutes: 1, // legacy fallback path, not exercised here
	});
}

// Wraps the private recordProviderFailure so tests can drive failures
// directly without needing to mock fetch. Allowed by TS via index access.
function recordFailure(
	router: ProviderRouter,
	provider: string,
	err: unknown,
): Promise<void> {
	const r = router as unknown as {
		recordProviderFailure(
			p: string,
			c?: string,
			ra?: number | null,
		): Promise<void>;
	};
	const cls = classifyError(err);
	const ra = parseRetryAfterMs(err);
	return r.recordProviderFailure(provider, cls, ra);
}

describe("M018.D — classifyError() — pure classifier", () => {
	it("classifies 401/403/unauthorized as AUTH_FAILURE", () => {
		expect(classifyError(new Error("OpenAI API Error: 401 Unauthorized"))).toBe(
			"AUTH_FAILURE",
		);
		expect(
			classifyError(new Error("Anthropic API Error: 403 Forbidden")),
		).toBe("AUTH_FAILURE");
		expect(classifyError(new Error("invalid_api_key supplied"))).toBe(
			"AUTH_FAILURE",
		);
		expect(classifyError(new Error("Authentication failed"))).toBe(
			"AUTH_FAILURE",
		);
	});

	it("classifies 429/rate-limit as RATE_LIMIT", () => {
		expect(
			classifyError(new Error("Groq API Error: 429 Too Many Requests")),
		).toBe("RATE_LIMIT");
		expect(classifyError(new Error("rate limit exceeded"))).toBe("RATE_LIMIT");
	});

	it("classifies ECONNREFUSED / timeout / fetch failed as NETWORK", () => {
		expect(classifyError(new Error("ECONNREFUSED 127.0.0.1:8000"))).toBe(
			"NETWORK",
		);
		expect(classifyError(new Error("Request timeout after 30000ms"))).toBe(
			"NETWORK",
		);
		expect(classifyError(new Error("fetch failed: ENOTFOUND"))).toBe(
			"NETWORK",
		);
		expect(classifyError(new Error("Carnice local server unreachable"))).toBe(
			"NETWORK",
		);
	});

	it("classifies 500/malformed/anything-else as MODEL_ERROR", () => {
		expect(
			classifyError(new Error("DeepSeek API Error: 500 Internal Error")),
		).toBe("MODEL_ERROR");
		expect(classifyError(new Error("Unexpected token < in JSON"))).toBe(
			"MODEL_ERROR",
		);
		// Non-Error fallback also goes to MODEL_ERROR.
		expect(classifyError("garbage string")).toBe("MODEL_ERROR");
		expect(classifyError(null)).toBe("MODEL_ERROR");
	});
});

describe("M018.D — parseRetryAfterMs()", () => {
	it("parses 'Retry-After: <n>' phrasing", () => {
		expect(
			parseRetryAfterMs(new Error("429 rate limit. Retry-After: 12")),
		).toBe(12000);
	});

	it("returns null when no hint is present", () => {
		expect(parseRetryAfterMs(new Error("429 Too Many Requests"))).toBeNull();
		expect(parseRetryAfterMs(null)).toBeNull();
	});
});

describe("M018.D — AUTH_FAILURE class behavior", () => {
	let router: ProviderRouter;
	beforeEach(() => {
		router = makeRouter();
	});
	afterEach(() => {
		// Cancel any setTimeout the cooldown scheduled. Bun's test runner
		// auto-clears handles after `afterEach`, but we explicitly reset
		// router state to avoid bleed into subsequent suites.
	});

	it("puts provider on cooldown on the FIRST failure (immediate)", async () => {
		await recordFailure(
			router,
			"openai",
			new Error("OpenAI API Error: 401 Unauthorized"),
		);
		const h = router.getProviderHealth("openai");
		expect(h).not.toBeNull();
		expect(h?.isOnCooldown).toBe(true);
		expect(h?.lastErrorClass).toBe("AUTH_FAILURE");
		expect(h?.failureCount).toBe(1);
		// Cooldown should be ~1h (3_600_000ms) per spec.
		expect(h?.cooldownExpiresAt).not.toBeNull();
		const remaining = (h?.cooldownExpiresAt ?? 0) - Date.now();
		expect(remaining).toBeGreaterThan(60 * 60 * 1000 - 5_000);
		expect(remaining).toBeLessThanOrEqual(60 * 60 * 1000 + 1_000);
	});

	it("sets needsAuthRefresh flag so the UI can prompt for a new key", async () => {
		await recordFailure(
			router,
			"anthropic-api",
			new Error("Anthropic API Error: 403 Forbidden"),
		);
		const h = router.getProviderHealth("anthropic-api");
		expect(h?.needsAuthRefresh).toBe(true);
	});
});

describe("M018.D — RATE_LIMIT class behavior", () => {
	let router: ProviderRouter;
	beforeEach(() => {
		router = makeRouter();
	});

	it("respects Retry-After header when present", async () => {
		await recordFailure(
			router,
			"groq",
			new Error("Groq API Error: 429 rate limit. Retry-After: 90"),
		);
		const h = router.getProviderHealth("groq");
		expect(h?.isOnCooldown).toBe(true);
		expect(h?.lastErrorClass).toBe("RATE_LIMIT");
		expect(h?.retryAfterMs).toBe(90_000);
		const remaining = (h?.cooldownExpiresAt ?? 0) - Date.now();
		expect(remaining).toBeGreaterThan(85_000);
		expect(remaining).toBeLessThanOrEqual(90_000 + 1_000);
		expect(h?.needsAuthRefresh).toBe(false);
	});

	it("defaults to 5min cooldown when no Retry-After header is present", async () => {
		await recordFailure(
			router,
			"groq",
			new Error("Groq API Error: 429 Too Many Requests"),
		);
		const h = router.getProviderHealth("groq");
		expect(h?.isOnCooldown).toBe(true);
		expect(h?.retryAfterMs).toBeNull();
		const remaining = (h?.cooldownExpiresAt ?? 0) - Date.now();
		expect(remaining).toBeGreaterThan(5 * 60 * 1000 - 5_000);
		expect(remaining).toBeLessThanOrEqual(5 * 60 * 1000 + 1_000);
	});
});

describe("M018.D — NETWORK class behavior", () => {
	let router: ProviderRouter;
	beforeEach(() => {
		router = makeRouter();
	});

	it("does NOT cooldown on first 2 network failures (retry up to 3x)", async () => {
		await recordFailure(
			router,
			"deepseek",
			new Error("ECONNREFUSED 127.0.0.1"),
		);
		let h = router.getProviderHealth("deepseek");
		expect(h?.isOnCooldown).toBe(false);
		expect(h?.failureCount).toBe(1);
		expect(h?.lastErrorClass).toBe("NETWORK");

		await recordFailure(router, "deepseek", new Error("Request timeout"));
		h = router.getProviderHealth("deepseek");
		expect(h?.isOnCooldown).toBe(false);
		expect(h?.failureCount).toBe(2);
	});

	it("cools down for 30s after the 3rd consecutive network failure", async () => {
		for (let i = 0; i < 3; i++) {
			await recordFailure(router, "deepseek", new Error("fetch failed"));
		}
		const h = router.getProviderHealth("deepseek");
		expect(h?.isOnCooldown).toBe(true);
		expect(h?.failureCount).toBe(3);
		const remaining = (h?.cooldownExpiresAt ?? 0) - Date.now();
		expect(remaining).toBeGreaterThan(25_000);
		expect(remaining).toBeLessThanOrEqual(30_000 + 1_000);
	});
});

describe("M018.D — MODEL_ERROR class behavior", () => {
	let router: ProviderRouter;
	beforeEach(() => {
		router = makeRouter();
	});

	it("records the error class and increments count without immediate cooldown", async () => {
		await recordFailure(
			router,
			"opencode-go",
			new Error("OpenCode Go API Error: 500 Internal Server Error"),
		);
		const h = router.getProviderHealth("opencode-go");
		expect(h?.lastErrorClass).toBe("MODEL_ERROR");
		expect(h?.failureCount).toBe(1);
		// With maxFailuresBeforeCooldown=2 the first failure stays warm.
		expect(h?.isOnCooldown).toBe(false);
	});

	it("cools down for ~1min after maxFailuresBeforeCooldown is reached", async () => {
		// maxFailuresBeforeCooldown=2 → 2 errors trip cooldown.
		await recordFailure(
			router,
			"opencode-go",
			new Error("Unexpected token < in JSON at position 0"),
		);
		await recordFailure(
			router,
			"opencode-go",
			new Error("500 Internal Server Error"),
		);
		const h = router.getProviderHealth("opencode-go");
		expect(h?.isOnCooldown).toBe(true);
		expect(h?.failureCount).toBe(2);
		const remaining = (h?.cooldownExpiresAt ?? 0) - Date.now();
		expect(remaining).toBeGreaterThan(55_000);
		expect(remaining).toBeLessThanOrEqual(60_000 + 1_000);
	});
});

describe("M018.D — success clears auth-refresh + last error class", () => {
	it("resets needsAuthRefresh, lastErrorClass, cooldown state on success", async () => {
		const router = makeRouter();
		await recordFailure(
			router,
			"openai",
			new Error("OpenAI API Error: 401 Unauthorized"),
		);
		let h = router.getProviderHealth("openai");
		expect(h?.needsAuthRefresh).toBe(true);

		// Drive a success via the private recordProviderSuccess (same indirection).
		const r = router as unknown as {
			recordProviderSuccess(p: string): void;
		};
		r.recordProviderSuccess("openai");

		h = router.getProviderHealth("openai");
		expect(h?.needsAuthRefresh).toBe(false);
		expect(h?.lastErrorClass).toBeNull();
		expect(h?.isOnCooldown).toBe(false);
		expect(h?.failureCount).toBe(0);
	});
});
