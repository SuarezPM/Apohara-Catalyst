/**
 * G5.C.2 — Statusline state store tests.
 */
import { test, expect } from "bun:test";
import { createStore } from "jotai/vanilla";
import {
	statusAtom,
	patchStatusAtom,
	resetStatusAtom,
	INITIAL_STATUS,
} from "../../src/store/statusStore.js";

test("default status is INITIAL_STATUS", () => {
	const s = createStore();
	expect(s.get(statusAtom)).toEqual(INITIAL_STATUS);
});

test("patchStatusAtom merges fields without clobbering siblings", () => {
	const s = createStore();
	s.set(patchStatusAtom, { tokensUsed: 100, tokensLimit: 1000 });
	const v1 = s.get(statusAtom);
	expect(v1.tokensUsed).toBe(100);
	expect(v1.tokensLimit).toBe(1000);
	expect(v1.contextLevel).toBe("ok"); // untouched

	s.set(patchStatusAtom, { contextLevel: "warning" });
	const v2 = s.get(statusAtom);
	expect(v2.tokensUsed).toBe(100); // preserved
	expect(v2.contextLevel).toBe("warning");
});

test("resetStatusAtom restores INITIAL_STATUS", () => {
	const s = createStore();
	s.set(patchStatusAtom, { tokensUsed: 500, contextLevel: "critical" });
	s.set(resetStatusAtom);
	expect(s.get(statusAtom)).toEqual(INITIAL_STATUS);
});

test("patching with empty patch is a noop", () => {
	const s = createStore();
	s.set(patchStatusAtom, {});
	expect(s.get(statusAtom)).toEqual(INITIAL_STATUS);
});

test("patching multiple fields at once", () => {
	const s = createStore();
	s.set(patchStatusAtom, {
		session: "session-abc",
		tokensUsed: 7500,
		tokensLimit: 10_000,
		contextLevel: "caution",
		activeToolCount: 2,
		lastHook: "pre_tool_use Bash",
		lastToolLatencyMs: 120,
		bannerMessage: null,
	});
	const v = s.get(statusAtom);
	expect(v.session).toBe("session-abc");
	expect(v.contextLevel).toBe("caution");
	expect(v.activeToolCount).toBe(2);
});
