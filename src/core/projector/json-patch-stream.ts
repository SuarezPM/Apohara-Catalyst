/**
 * JSON-Patch streaming per RFC 6902 (vibe-kanban #3 / G5.F.3).
 *
 * The dispatcher's SSE stream previously re-sent the entire projected
 * state on every tick. For long-lived sessions this becomes expensive:
 * O(taskCount) JSON serialization per event even when only one card
 * changed.
 *
 * This module computes a minimal patch between two snapshots and
 * provides an `applyPatch` that mirrors the spec exactly enough for
 * our needs (we don't need `move`, `copy`, or `test` in v1 — only
 * `add`, `replace`, `remove`).
 *
 * Path encoding follows RFC 6901: `~` → `~0`, `/` → `~1`.
 *
 * v1 limitation: arrays are diffed as opaque values (no element-level
 * granularity). The TaskBoard projection uses a Record/Map shape at the
 * top level, so this is fine for the current consumers. If a future
 * consumer wants array-level diffing we can swap to `fast-json-patch`.
 */

export interface JsonPatchOpAdd {
	op: "add";
	path: string;
	value: unknown;
}
export interface JsonPatchOpReplace {
	op: "replace";
	path: string;
	value: unknown;
}
export interface JsonPatchOpRemove {
	op: "remove";
	path: string;
}
export type JsonPatchOp = JsonPatchOpAdd | JsonPatchOpReplace | JsonPatchOpRemove;

/** Per RFC 6901 §4 — escape `~` first, then `/`. */
function escapeToken(t: string): string {
	return t.replace(/~/g, "~0").replace(/\//g, "~1");
}
function unescapeToken(t: string): string {
	return t.replace(/~1/g, "/").replace(/~0/g, "~");
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	return (
		typeof v === "object" &&
		v !== null &&
		!Array.isArray(v) &&
		Object.getPrototypeOf(v) === Object.prototype
	);
}

function shallowEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return JSON.stringify(a) === JSON.stringify(b);
	}
	if (isPlainObject(a) && isPlainObject(b)) {
		return JSON.stringify(a) === JSON.stringify(b);
	}
	return false;
}

/**
 * Compute a JSON-Patch that turns `prev` into `next`. Operates
 * recursively on plain objects; arrays and scalars are diffed as whole
 * values (single `replace`).
 */
export function diffPatch(prev: unknown, next: unknown, basePath = ""): JsonPatchOp[] {
	if (shallowEqual(prev, next)) return [];

	// Type mismatch or non-object on one side → replace whole subtree.
	if (!isPlainObject(prev) || !isPlainObject(next)) {
		return [{ op: "replace", path: basePath || "", value: next }];
	}

	const ops: JsonPatchOp[] = [];
	const prevKeys = new Set(Object.keys(prev));
	const nextKeys = new Set(Object.keys(next));

	for (const key of nextKeys) {
		const path = `${basePath}/${escapeToken(key)}`;
		if (!prevKeys.has(key)) {
			ops.push({ op: "add", path, value: next[key] });
			continue;
		}
		const pv = prev[key];
		const nv = next[key];
		if (shallowEqual(pv, nv)) continue;
		if (isPlainObject(pv) && isPlainObject(nv)) {
			ops.push(...diffPatch(pv, nv, path));
		} else {
			ops.push({ op: "replace", path, value: nv });
		}
	}
	for (const key of prevKeys) {
		if (nextKeys.has(key)) continue;
		ops.push({ op: "remove", path: `${basePath}/${escapeToken(key)}` });
	}
	return ops;
}

function splitPath(path: string): string[] {
	if (path === "" || path === "/") return [];
	const parts = path.split("/").slice(1);
	return parts.map(unescapeToken);
}

/**
 * Apply a JSON-Patch to a deep clone of `doc` and return the new
 * document. The input is never mutated.
 */
export function applyPatch(doc: unknown, patch: JsonPatchOp[]): unknown {
	// Deep clone via JSON round-trip so callers can't observe partial
	// states if applyPatch throws halfway. This is the same trade-off
	// `fast-json-patch` makes in non-mutating mode.
	const next = JSON.parse(JSON.stringify(doc));
	for (const op of patch) {
		applyOne(next, op);
	}
	return next;
}

function applyOne(root: unknown, op: JsonPatchOp): void {
	const parts = splitPath(op.path);
	if (parts.length === 0) {
		// Patching the root is undefined behavior in our subset — skip.
		// (RFC 6902 §4.1 allows it for `replace`, but we don't use it.)
		return;
	}
	// Walk to the parent
	let cursor: unknown = root;
	for (let i = 0; i < parts.length - 1; i++) {
		if (!isPlainObject(cursor)) return;
		cursor = (cursor as Record<string, unknown>)[parts[i]];
	}
	if (!isPlainObject(cursor)) return;
	const last = parts[parts.length - 1];
	const parent = cursor as Record<string, unknown>;
	switch (op.op) {
		case "add":
		case "replace":
			parent[last] = op.value;
			break;
		case "remove":
			delete parent[last];
			break;
	}
}
