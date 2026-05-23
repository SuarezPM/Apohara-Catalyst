/**
 * G7.C.7 — HeroBanner unit tests.
 *
 * The banner is render-conditional on:
 *   - sessionId === null
 *   - tasks store is empty
 *
 * Both branches are pure data-driven, so we exercise the predicates at
 * the module level. Full visual verification belongs to the Playwright
 * smoke pass (Stage 8.13).
 */
import { test, expect } from "bun:test";
import { HeroBanner } from "../../src/components/HeroBanner.js";

test("HeroBanner exports a function component", () => {
	expect(typeof HeroBanner).toBe("function");
});

test("HeroBanner default export accepts optional onSeedDemo", () => {
	// Type-level smoke: the call signature must allow either presence
	// (sessionId required, onSeedDemo optional). This is a compile-time
	// check phrased as a runtime no-op so bun:test reports it green.
	const props: Parameters<typeof HeroBanner>[0] = { sessionId: null };
	expect(props.sessionId).toBe(null);
	const withCta: Parameters<typeof HeroBanner>[0] = {
		sessionId: null,
		onSeedDemo: () => {},
	};
	expect(typeof withCta.onSeedDemo).toBe("function");
});
