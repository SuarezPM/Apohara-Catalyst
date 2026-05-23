import { expect, test } from "bun:test";
import { isValidUuid, parseUuid } from "../../src/core/uuid/validate";

test("accepts canonical v4 lowercase", () => {
	const u = "550e8400-e29b-41d4-a716-446655440000";
	expect(isValidUuid(u)).toBe(true);
	expect(parseUuid(u)).toBe(u);
});

test("accepts canonical v4 uppercase (normalizes to lowercase)", () => {
	const u = "550E8400-E29B-41D4-A716-446655440000";
	expect(isValidUuid(u)).toBe(true);
	// parseUuid normalizes to lowercase for canonical comparison
	expect(parseUuid(u)).toBe(u.toLowerCase());
});

test("rejects v1 (timestamp-based) — strict v4 only", () => {
	// v1 has '1' in the version nibble; v4 requires '4'.
	expect(isValidUuid("550e8400-e29b-11d4-a716-446655440000")).toBe(false);
});

test("rejects malformed UUIDs", () => {
	expect(isValidUuid("")).toBe(false);
	expect(isValidUuid("not-a-uuid")).toBe(false);
	expect(isValidUuid("550e8400-e29b-41d4-a716")).toBe(false); // truncated
	expect(isValidUuid("550e8400e29b41d4a716446655440000")).toBe(false); // no hyphens
	expect(isValidUuid("550e8400-e29b-41d4-a716-44665544000Z")).toBe(false); // bad char
});

test("rejects wrong variant nibble", () => {
	// variant must be 8, 9, a, or b (RFC 4122). 'c' is invalid for v4.
	expect(isValidUuid("550e8400-e29b-41d4-c716-446655440000")).toBe(false);
});

test("parseUuid returns null on invalid input", () => {
	expect(parseUuid("not-a-uuid")).toBeNull();
	expect(parseUuid("")).toBeNull();
});

test("parseUuid preserves canonical form on valid input", () => {
	const u = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
	expect(parseUuid(u)).toBe(u);
});

test("rejects nil UUID (all zeros) — version nibble is 0, not 4", () => {
	expect(isValidUuid("00000000-0000-0000-0000-000000000000")).toBe(false);
});
