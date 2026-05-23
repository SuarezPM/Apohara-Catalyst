/**
 * Tests for self-describing guardrail flags (symphony #14, G5.G.8).
 *
 * Existing code emits "guardrail tripped" events as bare strings
 * ("PROMPT_INJECTION_DETECTED", "RATE_LIMIT_EXCEEDED"). Consumers
 * (UI, audit log, telemetry) all duplicate the metadata — what severity
 * is this? What action should the user take? — and drift over time.
 * This module is the SINGLE source of truth: every flag carries its
 * own `description()`, `severity()`, and `suggestedAction()`.
 */

import { test, expect, describe } from "bun:test";
import {
	GuardrailFlag,
	allGuardrailFlags,
	flagFromString,
	type GuardrailSeverity,
} from "../../../src/core/safety/guardrail-flags";

describe("GuardrailFlag self-description", () => {
	test("every flag has a non-empty description", () => {
		for (const f of allGuardrailFlags()) {
			expect(f.description().length).toBeGreaterThan(0);
		}
	});

	test("every flag has a severity in the enum", () => {
		const valid: GuardrailSeverity[] = ["info", "warning", "error", "critical"];
		for (const f of allGuardrailFlags()) {
			expect(valid).toContain(f.severity());
		}
	});

	test("every flag has a non-empty suggestedAction", () => {
		for (const f of allGuardrailFlags()) {
			expect(f.suggestedAction().length).toBeGreaterThan(0);
		}
	});

	test("each flag exposes a stable string code", () => {
		for (const f of allGuardrailFlags()) {
			expect(typeof f.code()).toBe("string");
			expect(f.code().length).toBeGreaterThan(0);
			// All-caps snake-case convention so log greps are stable.
			expect(f.code()).toMatch(/^[A-Z][A-Z0-9_]*$/);
		}
	});
});

describe("GuardrailFlag specific flags", () => {
	test("PROMPT_INJECTION_DETECTED is critical and tells the user to abort", () => {
		const f = GuardrailFlag.PROMPT_INJECTION_DETECTED;
		expect(f.severity()).toBe("critical");
		expect(f.code()).toBe("PROMPT_INJECTION_DETECTED");
		expect(f.suggestedAction().toLowerCase()).toContain("abort");
	});

	test("RATE_LIMIT_EXCEEDED is a warning with a backoff hint", () => {
		const f = GuardrailFlag.RATE_LIMIT_EXCEEDED;
		expect(f.severity()).toBe("warning");
		expect(f.suggestedAction().toLowerCase()).toMatch(/back ?off|retry/);
	});

	test("BUDGET_EXCEEDED is error and surfaces token / cost language", () => {
		const f = GuardrailFlag.BUDGET_EXCEEDED;
		expect(f.severity()).toBe("error");
		expect(f.description().toLowerCase()).toMatch(/budget|token/);
	});

	test("HALLUCINATION_FLAG is warning and recommends verification", () => {
		const f = GuardrailFlag.HALLUCINATION_FLAG;
		expect(f.severity()).toBe("warning");
		expect(f.suggestedAction().toLowerCase()).toContain("verif");
	});

	test("PATH_ESCAPE_ATTEMPT is critical and surfaces in audit log", () => {
		const f = GuardrailFlag.PATH_ESCAPE_ATTEMPT;
		expect(f.severity()).toBe("critical");
		expect(f.description().toLowerCase()).toContain("path");
	});
});

describe("flagFromString", () => {
	test("returns the flag for a known code", () => {
		const f = flagFromString("PROMPT_INJECTION_DETECTED");
		expect(f).toBe(GuardrailFlag.PROMPT_INJECTION_DETECTED);
	});

	test("returns undefined for an unknown code", () => {
		expect(flagFromString("NOT_A_FLAG")).toBeUndefined();
	});

	test("is case-sensitive (code convention is all-caps)", () => {
		expect(flagFromString("prompt_injection_detected")).toBeUndefined();
	});
});

describe("guardrail flag enumeration", () => {
	test("allGuardrailFlags returns a non-empty list", () => {
		const list = allGuardrailFlags();
		expect(list.length).toBeGreaterThanOrEqual(5);
	});

	test("each flag appears exactly once in the enumeration", () => {
		const codes = allGuardrailFlags().map((f) => f.code());
		const unique = new Set(codes);
		expect(unique.size).toBe(codes.length);
	});
});
