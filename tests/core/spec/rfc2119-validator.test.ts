/**
 * Tests for RFC 2119 enforcement-level validator (symphony #1, G5.G.1).
 *
 * RFC 2119 reserves the all-caps words MUST / MUST NOT / SHALL / SHALL NOT /
 * REQUIRED / SHOULD / SHOULD NOT / RECOMMENDED / MAY / OPTIONAL as
 * requirement-strength keywords. A spec file that uses these words in any
 * lowercase or mixed-case form is ambiguous: the reader cannot tell
 * whether the writer meant the RFC 2119 sense or ordinary prose.
 *
 * The validator inspects a spec body and reports violations per profile:
 *   - "strict": every requirement keyword must appear in ALL CAPS.
 *   - "lenient": only the strict trio (MUST / SHALL / REQUIRED) must be
 *     ALL CAPS; SHOULD / MAY are flagged but downgraded to "warning".
 *   - "off": no enforcement (sanity-check that the validator is a no-op).
 *
 * Markdown fences / inline code / link text are stripped before scanning
 * — the rule is about prose, not embedded code blocks.
 */

import { test, expect, describe } from "bun:test";
import {
	validateRfc2119,
	type Rfc2119Profile,
	type Rfc2119Violation,
} from "../../../src/core/spec/rfc2119-validator";

function findKeyword(violations: Rfc2119Violation[], keyword: string): Rfc2119Violation | undefined {
	return violations.find((v) => v.keyword.toLowerCase() === keyword.toLowerCase());
}

describe("rfc2119-validator strict profile", () => {
	test("accepts ALL-CAPS keywords without violation", () => {
		const body = "Implementations MUST validate the input. Clients SHOULD retry.";
		const result = validateRfc2119(body, "strict");
		expect(result.violations).toEqual([]);
		expect(result.profile).toBe("strict");
	});

	test("flags lowercase 'must' as a violation", () => {
		const body = "The server must respond within 30 seconds.";
		const result = validateRfc2119(body, "strict");
		expect(result.violations.length).toBeGreaterThanOrEqual(1);
		const v = findKeyword(result.violations, "must");
		expect(v).toBeDefined();
		expect(v!.severity).toBe("error");
		expect(v!.line).toBe(1);
	});

	test("flags mixed-case 'Should' as a violation", () => {
		const body = "Should clients retry?\n";
		const result = validateRfc2119(body, "strict");
		const v = findKeyword(result.violations, "should");
		expect(v).toBeDefined();
		expect(v!.severity).toBe("error");
	});

	test("reports separate violations per occurrence", () => {
		const body = [
			"line one: must validate",
			"line two: should retry",
			"line three: may cache",
		].join("\n");
		const result = validateRfc2119(body, "strict");
		expect(result.violations.length).toBe(3);
		expect(result.violations.map((v) => v.line).sort()).toEqual([1, 2, 3]);
	});

	test("ignores keywords inside ```fenced code``` blocks", () => {
		const body = [
			"Prose MUST be uppercase.",
			"```",
			"this might be code where must is OK",
			"```",
			"More prose MUST follow.",
		].join("\n");
		const result = validateRfc2119(body, "strict");
		expect(result.violations).toEqual([]);
	});

	test("ignores keywords inside inline `code` spans", () => {
		const body = "The flag is set via `must_validate` config.";
		const result = validateRfc2119(body, "strict");
		expect(result.violations).toEqual([]);
	});

	test("does not flag the word inside a longer identifier", () => {
		// 'mustard' embeds 'must' but is unrelated to RFC 2119.
		const body = "Mustard tastes mild; trustworthy systems matter.";
		const result = validateRfc2119(body, "strict");
		expect(result.violations).toEqual([]);
	});

	test("flags every reserved keyword class", () => {
		const body = [
			"line A: must validate", // MUST
			"line B: shall respond", // SHALL
			"line C: required field", // REQUIRED
			"line D: should retry", // SHOULD
			"line E: recommended timeout", // RECOMMENDED
			"line F: may cache", // MAY
			"line G: optional ack", // OPTIONAL
		].join("\n");
		const result = validateRfc2119(body, "strict");
		expect(result.violations.length).toBe(7);
	});

	test("detects negations: 'MUST NOT' lowercase variant", () => {
		const body = "Clients must not retry forever.";
		const result = validateRfc2119(body, "strict");
		const v = findKeyword(result.violations, "must not");
		expect(v).toBeDefined();
	});
});

describe("rfc2119-validator lenient profile", () => {
	test("MUST / SHALL / REQUIRED remain errors", () => {
		const body = "Servers must respond.";
		const result = validateRfc2119(body, "lenient");
		const v = findKeyword(result.violations, "must");
		expect(v).toBeDefined();
		expect(v!.severity).toBe("error");
	});

	test("SHOULD / MAY / RECOMMENDED / OPTIONAL downgrade to warning", () => {
		const body = "Clients should retry but may cache.";
		const result = validateRfc2119(body, "lenient");
		const should = findKeyword(result.violations, "should");
		const may = findKeyword(result.violations, "may");
		expect(should?.severity).toBe("warning");
		expect(may?.severity).toBe("warning");
	});
});

describe("rfc2119-validator off profile", () => {
	test("returns zero violations regardless of input", () => {
		const body = "Servers must respond. Clients should retry. Caches may persist.";
		const result = validateRfc2119(body, "off");
		expect(result.violations).toEqual([]);
		expect(result.profile).toBe("off");
	});
});

describe("rfc2119-validator profile defaults", () => {
	test("omitting the profile argument defaults to 'strict'", () => {
		const body = "Servers must respond.";
		const result = validateRfc2119(body);
		expect(result.profile).toBe("strict");
		expect(result.violations.length).toBeGreaterThanOrEqual(1);
	});

	test("violation carries a human-readable suggestion", () => {
		const body = "Clients must validate.\n";
		const result = validateRfc2119(body, "strict");
		const v = result.violations[0];
		expect(v.suggestion).toContain("MUST");
		expect(v.matchedText).toBe("must");
	});
});

describe("rfc2119-validator profile resolution", () => {
	test("known profile name is preserved on the result", () => {
		const profiles: Rfc2119Profile[] = ["strict", "lenient", "off"];
		for (const p of profiles) {
			const r = validateRfc2119("MUST respect.", p);
			expect(r.profile).toBe(p);
		}
	});
});
