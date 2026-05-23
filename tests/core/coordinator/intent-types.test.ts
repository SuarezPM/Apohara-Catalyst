import { test, expect } from "bun:test";
import {
	ALL_INTENTS,
	defaultProviderFor,
	isIntent,
	isSmartRouterEnabled,
	type Intent,
} from "../../../src/core/coordinator/intent-types";

test("ALL_INTENTS has exactly 8 entries", () => {
	expect(ALL_INTENTS.length).toBe(8);
});

test("every intent maps to an active-roster provider", () => {
	const active = new Set(["claude-code-cli", "codex-cli", "opencode-go"]);
	for (const i of ALL_INTENTS) {
		expect(active.has(defaultProviderFor(i))).toBe(true);
	}
});

test("isIntent narrows correctly", () => {
	expect(isIntent("implement")).toBe(true);
	expect(isIntent("nonsense")).toBe(false);
	expect(isIntent(42)).toBe(false);
	expect(isIntent(undefined)).toBe(false);
});

test("isSmartRouterEnabled gated by APOHARA_SMART_ROUTER=1 only", () => {
	expect(isSmartRouterEnabled({})).toBe(false);
	expect(isSmartRouterEnabled({ APOHARA_SMART_ROUTER: "0" })).toBe(false);
	expect(isSmartRouterEnabled({ APOHARA_SMART_ROUTER: "true" })).toBe(false);
	expect(isSmartRouterEnabled({ APOHARA_SMART_ROUTER: "1" })).toBe(true);
});

test("default mapping matches the Rust spec (G6.D.5)", () => {
	const expected: Record<Intent, string> = {
		implement: "claude-code-cli",
		refactor: "codex-cli",
		debug: "claude-code-cli",
		document: "opencode-go",
		test: "claude-code-cli",
		explain: "opencode-go",
		review: "codex-cli",
		other: "claude-code-cli",
	};
	for (const i of ALL_INTENTS) {
		expect(defaultProviderFor(i)).toBe(expected[i]);
	}
});
