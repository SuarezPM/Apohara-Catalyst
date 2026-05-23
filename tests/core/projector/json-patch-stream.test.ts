/**
 * G5.F.3 — JSON-Patch streaming (vibe-kanban #3, RFC 6902).
 *
 * Instead of re-sending the whole state on every SSE tick, the server
 * computes a JSON-Patch (RFC 6902) between the prior snapshot and the
 * current one and streams only the diff. The client applies the patch
 * to its local replica and stays in sync without re-parsing the world.
 */
import { describe, expect, test } from "bun:test";
import {
	diffPatch,
	applyPatch,
	type JsonPatchOp,
} from "../../../src/core/projector/json-patch-stream";

describe("G5.F.3 — diffPatch", () => {
	test("empty diff between equal objects", () => {
		expect(diffPatch({ a: 1 }, { a: 1 })).toEqual([]);
	});

	test("replace at root key on scalar change", () => {
		const patch = diffPatch({ a: 1 }, { a: 2 });
		expect(patch).toEqual([{ op: "replace", path: "/a", value: 2 }]);
	});

	test("add for newly introduced keys", () => {
		const patch = diffPatch({ a: 1 }, { a: 1, b: 2 });
		expect(patch).toEqual([{ op: "add", path: "/b", value: 2 }]);
	});

	test("remove for dropped keys", () => {
		const patch = diffPatch({ a: 1, b: 2 }, { a: 1 });
		expect(patch).toEqual([{ op: "remove", path: "/b" }]);
	});

	test("nested replace traverses with /-separated path", () => {
		const patch = diffPatch({ a: { b: 1 } }, { a: { b: 2 } });
		expect(patch).toEqual([{ op: "replace", path: "/a/b", value: 2 }]);
	});

	test("escapes / and ~ in keys per RFC 6901", () => {
		const patch = diffPatch({ "a/b": 1 }, { "a/b": 2 });
		// "/" → "~1", "~" → "~0"
		expect(patch).toEqual([{ op: "replace", path: "/a~1b", value: 2 }]);
	});

	test("arrays are diffed as whole values (no array-level granularity in v1)", () => {
		const patch = diffPatch({ list: [1, 2] }, { list: [1, 2, 3] });
		expect(patch).toEqual([
			{ op: "replace", path: "/list", value: [1, 2, 3] },
		]);
	});
});

describe("G5.F.3 — applyPatch", () => {
	test("applies replace, add, remove correctly", () => {
		const base = { a: 1, b: { c: 2 } };
		const patch: JsonPatchOp[] = [
			{ op: "replace", path: "/a", value: 9 },
			{ op: "add", path: "/d", value: "new" },
			{ op: "remove", path: "/b/c" },
		];
		const next = applyPatch(base, patch);
		expect(next).toEqual({ a: 9, b: {}, d: "new" });
	});

	test("round-trips diff → apply preserves equality", () => {
		const a = { tasks: { "t-1": "pending", "t-2": "done" }, count: 2 };
		const b = { tasks: { "t-1": "done", "t-3": "pending" }, count: 2 };
		const patch = diffPatch(a, b);
		const reconstructed = applyPatch(a, patch);
		expect(reconstructed).toEqual(b);
	});

	test("applyPatch does not mutate the input object", () => {
		const base = { a: 1 };
		const patch: JsonPatchOp[] = [{ op: "replace", path: "/a", value: 2 }];
		applyPatch(base, patch);
		expect(base.a).toBe(1);
	});

	test("RFC 6901 path decoding (~1 → / ; ~0 → ~)", () => {
		const base: Record<string, unknown> = {};
		const patch: JsonPatchOp[] = [
			{ op: "add", path: "/a~1b", value: 1 },
			{ op: "add", path: "/c~0d", value: 2 },
		];
		const next = applyPatch(base, patch) as Record<string, unknown>;
		expect(next["a/b"]).toBe(1);
		expect(next["c~d"]).toBe(2);
	});
});
