/**
 * Hook `additionalContext` response composition + verification — G5.C.6
 * (chorus H8).
 *
 * The hooks-server can return a JSON body shaped like:
 *
 *   { "additionalContext": "...", "sources": ["compact","warning"] }
 *
 * The agent CLI reads this and prepends `additionalContext` to the next
 * user_prompt_submit. We compose this body from several upstream producers:
 *
 *   - compact     — the compact reinjector (G5.C.1)
 *   - warning     — context-warnings monitor band line (G5.C.3)
 *   - learnings   — prior session's learnings dump (G5.C.5)
 *
 * Ordering is deterministic so the agent sees the same bytes for the same
 * inputs. We separate sources with a double newline so each section keeps
 * its internal formatting (markdown headers, list bullets).
 *
 * The verifier enforces the wire contract: the additionalContext must be
 * a string under 64 KiB (matches the hooks-server 256 KiB body cap with
 * room for siblings). `sources` is optional but if present must be a list
 * of strings.
 */

const ADDITIONAL_CONTEXT_MAX_BYTES = 64 * 1024;

export interface ComposeSources {
	compact?: string;
	warning?: string;
	learnings?: string;
}

export interface ComposedResponse {
	additionalContext: string;
	sources: string[];
}

const SOURCE_ORDER: ReadonlyArray<keyof ComposeSources> = [
	"compact",
	"warning",
	"learnings",
];

export function composeAdditionalContextResponse(
	sources: ComposeSources,
): ComposedResponse {
	const parts: string[] = [];
	const used: string[] = [];
	for (const key of SOURCE_ORDER) {
		const body = sources[key];
		if (typeof body !== "string") continue;
		if (body.trim() === "") continue;
		parts.push(body);
		used.push(key);
	}
	return {
		additionalContext: parts.join("\n\n"),
		sources: used,
	};
}

export interface VerifyResult {
	ok: boolean;
	error?: string;
}

export function verifyAdditionalContextResponse(
	payload: Record<string, unknown>,
): VerifyResult {
	if ("additionalContext" in payload) {
		const v = payload.additionalContext;
		if (typeof v !== "string") {
			return { ok: false, error: "additionalContext must be a string" };
		}
		const size = Buffer.byteLength(v, "utf-8");
		if (size > ADDITIONAL_CONTEXT_MAX_BYTES) {
			return {
				ok: false,
				error: `additionalContext exceeds 64 KiB cap (${size} bytes)`,
			};
		}
	}
	if ("sources" in payload) {
		const v = payload.sources;
		if (!Array.isArray(v) || v.some((s) => typeof s !== "string")) {
			return { ok: false, error: "sources must be an array of strings" };
		}
	}
	return { ok: true };
}

export const ADDITIONAL_CONTEXT_LIMIT_BYTES = ADDITIONAL_CONTEXT_MAX_BYTES;
