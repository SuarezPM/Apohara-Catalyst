/**
 * G5.C.6 — additionalContext response composition (chorus H8).
 *
 * The hooks-server can return `additionalContext` in its JSON response so
 * the upstream agent CLI prepends it to the next prompt. This module
 * composes a single response from multiple sources (compact reinjector,
 * learnings, context warning band) and verifies the paths the agent reads.
 */
import { describe, expect, it } from "bun:test";
import {
	composeAdditionalContextResponse,
	verifyAdditionalContextResponse,
} from "./additional-context-response.js";

describe("composeAdditionalContextResponse", () => {
	it("returns empty body when no sources have content", () => {
		const out = composeAdditionalContextResponse({});
		expect(out.additionalContext).toBe("");
		expect(out.sources).toEqual([]);
	});

	it("concatenates sources with double-newline separator", () => {
		const out = composeAdditionalContextResponse({
			compact: "compact body",
			learnings: "learnings body",
		});
		expect(out.additionalContext).toBe("compact body\n\nlearnings body");
		expect(out.sources).toContain("compact");
		expect(out.sources).toContain("learnings");
	});

	it("skips empty / whitespace-only sources", () => {
		const out = composeAdditionalContextResponse({
			compact: "",
			learnings: "   \n  ",
			warning: "real content",
		});
		expect(out.additionalContext).toBe("real content");
		expect(out.sources).toEqual(["warning"]);
	});

	it("respects deterministic source ordering: compact > warning > learnings", () => {
		const out = composeAdditionalContextResponse({
			learnings: "L",
			warning: "W",
			compact: "C",
		});
		expect(out.additionalContext).toBe("C\n\nW\n\nL");
		expect(out.sources).toEqual(["compact", "warning", "learnings"]);
	});

	it("preserves trailing newlines inside an individual source", () => {
		const out = composeAdditionalContextResponse({
			compact: "line1\nline2",
		});
		expect(out.additionalContext).toBe("line1\nline2");
	});
});

describe("verifyAdditionalContextResponse", () => {
	it("accepts well-formed envelope", () => {
		const res = verifyAdditionalContextResponse({
			additionalContext: "hello",
		});
		expect(res.ok).toBe(true);
	});

	it("accepts empty envelope (no additionalContext field)", () => {
		const res = verifyAdditionalContextResponse({});
		expect(res.ok).toBe(true);
	});

	it("rejects when additionalContext is not a string", () => {
		const res = verifyAdditionalContextResponse({
			additionalContext: 42,
		} as never);
		expect(res.ok).toBe(false);
		expect(res.error).toContain("must be a string");
	});

	it("rejects when additionalContext exceeds the 64 KiB cap", () => {
		const big = "a".repeat(64 * 1024 + 1);
		const res = verifyAdditionalContextResponse({
			additionalContext: big,
		});
		expect(res.ok).toBe(false);
		expect(res.error).toContain("64 KiB");
	});

	it("accepts exactly 64 KiB", () => {
		const big = "a".repeat(64 * 1024);
		const res = verifyAdditionalContextResponse({
			additionalContext: big,
		});
		expect(res.ok).toBe(true);
	});

	it("rejects when sources is not an array of strings", () => {
		const res = verifyAdditionalContextResponse({
			additionalContext: "x",
			sources: [1, 2] as never,
		});
		expect(res.ok).toBe(false);
	});

	it("accepts a valid sources array", () => {
		const res = verifyAdditionalContextResponse({
			additionalContext: "x",
			sources: ["compact"],
		});
		expect(res.ok).toBe(true);
	});
});
