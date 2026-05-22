/**
 * Lightweight runtime input validation for MCP tool handlers.
 *
 * The handlers in `src/core/mcp/servers/*.ts` originally did
 * `input.runId as string` etc. without checking the actual type. A
 * caller sending `{runId: 42}` would forward `42` as a SQL `?` parameter
 * (which `bun:sqlite` happily binds as INTEGER, missing the intended
 * string match) or — worse — `{}` would pass `undefined` straight into
 * the query and the `WHERE thread_id = ?` would match every row whose
 * thread_id is NULL.
 *
 * These helpers throw a descriptive error that the MCP server turns
 * into HTTP 400 / 500 via its existing error path. They are deliberately
 * minimal — adding a full schema validator (zod / typebox) is the right
 * Stage 8+ move; for now we want every handler to reject malformed
 * input before any FS/DB side-effect.
 */

export class McpValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "McpValidationError";
	}
}

export function requireString(
	obj: Record<string, unknown>,
	key: string,
): string {
	const v = obj[key];
	if (typeof v !== "string" || v.length === 0) {
		throw new McpValidationError(`expected string '${key}'`);
	}
	return v;
}

export function optionalString(
	obj: Record<string, unknown>,
	key: string,
): string | undefined {
	const v = obj[key];
	if (v === undefined || v === null) return undefined;
	if (typeof v !== "string") {
		throw new McpValidationError(`expected string '${key}' or omit`);
	}
	return v;
}

export function optionalStringArray(
	obj: Record<string, unknown>,
	key: string,
): string[] | undefined {
	const v = obj[key];
	if (v === undefined || v === null) return undefined;
	if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) {
		throw new McpValidationError(`expected string[] '${key}' or omit`);
	}
	return v as string[];
}

export function optionalInteger(
	obj: Record<string, unknown>,
	key: string,
	defaultValue: number | undefined,
): number | undefined {
	const v = obj[key];
	if (v === undefined || v === null) return defaultValue;
	if (typeof v !== "number" || !Number.isInteger(v)) {
		throw new McpValidationError(`expected integer '${key}' or omit`);
	}
	return v;
}

export function requireRecord(
	obj: Record<string, unknown>,
	key: string,
): Record<string, unknown> {
	const v = obj[key];
	if (v === null || typeof v !== "object" || Array.isArray(v)) {
		throw new McpValidationError(`expected object '${key}'`);
	}
	return v as Record<string, unknown>;
}
