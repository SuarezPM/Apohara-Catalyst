/**
 * parseWithFallback — zod boundary helper for IPC across TS↔Rust.
 *
 * G5.I.4 — multica inspiration. When TS receives a payload that originated
 * on the Rust side (or from disk, e.g. `apohara-settings.json`), the schema
 * can drift if either side adds/removes/renames fields between releases.
 *
 * Strict `schema.parse(value)` would throw on every drift, hard-stopping
 * Apohara on what's often a non-fatal extra field. parseWithFallback wraps
 * that path so partial drift degrades gracefully:
 *
 *   1. Try schema.safeParse(value).
 *   2. On success, return the parsed value (typed).
 *   3. On failure, log a warning (with the schema name + first issue path),
 *      and return the provided `fallback` so the caller keeps running with
 *      sensible defaults.
 *
 * This is intentionally NOT for security boundaries — those still use
 * strict `parse()` and reject. It's for "Apohara should not die because
 * Rust added a new optional `lastSeenAt` to a payload TS hasn't shipped yet".
 */
import type { ZodType } from "zod";

export interface ParseWithFallbackOptions {
	/** Name used in warning logs to identify which boundary drifted. */
	schemaName?: string;
	/** Override logger for testing. Defaults to console.warn. */
	logger?: (msg: string) => void;
}

/**
 * Parse `value` against `schema` or return `fallback` on failure.
 *
 * Type parameter is inferred from `schema` so the return type stays accurate
 * even when fallback is supplied.
 */
export function parseWithFallback<T>(
	schema: ZodType<T>,
	value: unknown,
	fallback: T,
	opts: ParseWithFallbackOptions = {},
): T {
	const result = schema.safeParse(value);
	if (result.success) {
		return result.data;
	}

	const logger = opts.logger ?? ((m) => console.warn(m));
	const name = opts.schemaName ?? "<anonymous>";
	const first = result.error.issues[0];
	const issuePath =
		first && first.path.length > 0 ? first.path.join(".") : "<root>";
	const issueMsg = first?.message ?? "unknown";
	logger(
		`[parseWithFallback] schema "${name}" drift at "${issuePath}": ${issueMsg} — using fallback`,
	);
	return fallback;
}
