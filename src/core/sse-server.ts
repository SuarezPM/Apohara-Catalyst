/**
 * SSE server-side resume helpers (G5.F.8, agentrail #12).
 *
 * The desktop server's `/api/session/:id/events` route previously
 * replayed the entire ledger on every connect — including reconnects
 * after a brief outage. With G5.C.8 the client now sends
 * `Last-Event-ID`; this module is the matching server-side bookkeeping
 * so the replay window is narrowed to "events after the anchor".
 *
 * Two pure helpers, no I/O outside `replayAfter`:
 *
 *   - `resolveLastEventId(req)` — honors both the standard EventSource
 *     header AND a `lastEventId` query param (some browsers strip the
 *     header on initial reconnect; the query param is our safety net).
 *   - `replayAfter(path, anchor)` — scans the ledger JSONL file and
 *     returns the lines strictly after the line whose `id` matches the
 *     anchor. Null anchor → all lines. Unknown anchor → full tail (the
 *     client must de-dupe by id, since the server's log may have
 *     rotated past the client's stale cursor).
 */
import { readFile } from "node:fs/promises";

const LAST_EVENT_ID_HEADER = "last-event-id";

/**
 * Resolve the effective `Last-Event-ID` for a request.
 *
 * Precedence:
 *   1. `Last-Event-ID` header (per HTML5 EventSource spec).
 *   2. `?lastEventId=...` query parameter (browsers + proxies sometimes
 *      drop the header on reconnect; clients can fall back to the URL).
 *   3. null (fresh connection).
 *
 * Rejects newline injection (no `\n`, `\r`) so a hostile id can't be
 * smuggled into a log line that's later replayed verbatim.
 */
export function resolveLastEventId(req: Request): string | null {
	const headerRaw = req.headers.get(LAST_EVENT_ID_HEADER);
	const url = (() => {
		try {
			return new URL(req.url);
		} catch {
			return null;
		}
	})();
	const queryRaw = url?.searchParams.get("lastEventId") ?? null;
	const candidate = headerRaw ?? queryRaw;
	if (!candidate) return null;
	if (candidate.length === 0) return null; // explicit empty → null
	if (/[\n\r]/.test(candidate)) return null; // injection guard
	return candidate;
}

/**
 * Return the JSONL lines from `ledgerPath` that come strictly AFTER the
 * event whose `id` equals `anchor`. Anchor semantics:
 *
 *   - `anchor === null` → return all lines (fresh connection).
 *   - `anchor` exists in the file → slice from `anchor`'s line + 1.
 *   - `anchor` NOT found → return all lines. The caller (the SSE handler)
 *     warns the client by setting a `: lastEventId rotated` comment so
 *     it can choose to drop its local replica. We don't return [] because
 *     the client would otherwise stall forever waiting for the anchor's
 *     successor.
 *
 * Malformed lines are skipped (same pattern as `EventLedger.verify` and
 * `durablePrompt-jsonl::loadEntries`).
 */
export async function replayAfter(
	ledgerPath: string,
	anchor: string | null,
): Promise<string[]> {
	let raw: string;
	try {
		raw = await readFile(ledgerPath, "utf-8");
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw err;
	}
	// Drop unparseable lines BEFORE anchor-scanning so they neither poison
	// the scan nor get re-streamed to clients that wouldn't be able to
	// parse them either. This mirrors `EventLedger.verify` and the
	// durable-prompt loader.
	const rawLines = raw.split("\n").filter((l) => l.trim().length > 0);
	const valid: string[] = [];
	for (const line of rawLines) {
		try {
			JSON.parse(line);
			valid.push(line);
		} catch {
			// best-effort skip
		}
	}
	if (anchor === null) return valid;

	let anchorIdx = -1;
	for (let i = 0; i < valid.length; i++) {
		const parsed = JSON.parse(valid[i]) as { id?: string };
		if (parsed?.id === anchor) {
			anchorIdx = i;
			break;
		}
	}
	if (anchorIdx === -1) {
		// Unknown anchor → server log rotated past client's cursor. Return
		// the full tail; the client de-dupes by id.
		return valid;
	}
	return valid.slice(anchorIdx + 1);
}
