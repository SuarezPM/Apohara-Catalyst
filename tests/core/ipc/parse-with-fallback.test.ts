/**
 * Tests for parseWithFallback zod boundary (G5.I.4).
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { parseWithFallback } from "../../../src/core/ipc/parseWithFallback";

describe("parseWithFallback", () => {
	const schema = z.object({
		id: z.string(),
		count: z.number(),
	});
	const fallback = { id: "default", count: 0 };

	test("returns parsed value on success", () => {
		const result = parseWithFallback(
			schema,
			{ id: "foo", count: 42 },
			fallback,
		);
		expect(result).toEqual({ id: "foo", count: 42 });
	});

	test("returns fallback on type mismatch", () => {
		const logs: string[] = [];
		const result = parseWithFallback(
			schema,
			{ id: "foo", count: "not-a-number" },
			fallback,
			{ logger: (m) => logs.push(m) },
		);
		expect(result).toBe(fallback);
		expect(logs.length).toBe(1);
		expect(logs[0]).toContain("count");
	});

	test("returns fallback on missing required field", () => {
		const logs: string[] = [];
		const result = parseWithFallback(schema, { id: "foo" }, fallback, {
			logger: (m) => logs.push(m),
		});
		expect(result).toBe(fallback);
		expect(logs[0]).toContain("count");
	});

	test("returns fallback on completely wrong shape (null)", () => {
		const result = parseWithFallback(schema, null, fallback, {
			logger: () => {},
		});
		expect(result).toBe(fallback);
	});

	test("returns fallback on completely wrong shape (string)", () => {
		const result = parseWithFallback(schema, "not-an-object", fallback, {
			logger: () => {},
		});
		expect(result).toBe(fallback);
	});

	test("uses schemaName in warning log", () => {
		const logs: string[] = [];
		parseWithFallback(schema, {}, fallback, {
			schemaName: "MyPayload",
			logger: (m) => logs.push(m),
		});
		expect(logs[0]).toContain('"MyPayload"');
	});

	test("does not throw — never propagates zod errors", () => {
		expect(() =>
			parseWithFallback(schema, undefined, fallback, { logger: () => {} }),
		).not.toThrow();
	});

	test("strips extra fields per default zod object behavior", () => {
		const result = parseWithFallback(
			schema,
			{ id: "x", count: 1, extra: "ignored" },
			fallback,
		);
		expect(result).toEqual({ id: "x", count: 1 });
	});

	test("default logger is console.warn (does not throw)", () => {
		// Smoke check that omitting `logger` falls back to console.warn without
		// crashing the test runner.
		expect(() =>
			parseWithFallback(schema, { broken: true }, fallback),
		).not.toThrow();
	});
});
