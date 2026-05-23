import { useEffect, useState } from "react";
import { SseReconnectTracker } from "../../../../src/core/sse-client.js";
import type { EventLog } from "../lib/types.js";

/**
 * Subscribe to the Bun.serve SSE stream tailing `.events/run-<id>.jsonl`.
 * Returns the live event array. EventSource auto-reconnects on drop.
 *
 * Backend route: GET /api/session/:id/events
 *
 * G7.C.3 + G7.C.4 — Reconnect-aware: the orchestrator-side
 * `SseReconnectTracker` (src/core/sse-client.ts) memoizes the highest
 * event id seen and dedupes by id on the catch-up window so a brief
 * disconnect doesn't double-render events. Native browser EventSource
 * already attaches `Last-Event-ID` whenever the server emits SSE `id:`
 * lines (server.ts at /api/session/:id/events does this since G7.C.4),
 * so the tracker here is mostly the dedupe + observability hook.
 *
 * `onReconnect` (optional) fires every time EventSource reports a transient
 * error AFTER at least one successful message — useful for the UI to
 * surface a "reconnecting…" badge in the future.
 */
export function useLedgerStream(
	sessionId: string | null,
	opts?: { onReconnect?: (lastEventId: string | null) => void },
) {
	const [events, setEvents] = useState<EventLog[]>([]);

	useEffect(() => {
		// Reset on every sessionId change so the new session never inherits
		// the previous run's events until its first SSE message lands.
		setEvents([]);
		if (!sessionId) return;

		const url = `/api/session/${encodeURIComponent(sessionId)}/events`;
		const src = new EventSource(url);
		// Per-session tracker: records every event id we successfully
		// processed so the UI can de-dupe and the (future) coordinator
		// proxy can request a backfill from that anchor on reconnect.
		const tracker = new SseReconnectTracker();
		// Seen ids — sized cap so the set doesn't grow without bound on
		// long-lived sessions. 4096 is enough for any plausible
		// reconnect-and-replay window (the server narrows replays via
		// Last-Event-ID anyway).
		const seenIds = new Set<string>();
		const SEEN_CAP = 4096;

		src.onmessage = (msg) => {
			try {
				const event = JSON.parse(msg.data) as EventLog;
				// SSE-level id is `msg.lastEventId` (the value emitted via
				// `id:` line). Prefer it over the payload id because that
				// is the cursor the browser will send back on reconnect.
				const cursor = msg.lastEventId || event.id;
				if (cursor) {
					if (seenIds.has(cursor)) return; // dedupe across replays
					seenIds.add(cursor);
					if (seenIds.size > SEEN_CAP) {
						// Trim — drop the oldest half. `Set` iteration is
						// insertion order so the first N entries are the
						// stale ones.
						const drop = SEEN_CAP / 2;
						let i = 0;
						for (const k of seenIds) {
							if (i++ >= drop) break;
							seenIds.delete(k);
						}
					}
					tracker.record(cursor);
				}
				setEvents((prev) => [...prev, event]);
			} catch {
				// Skip malformed lines
			}
		};

		src.onerror = () => {
			// EventSource auto-reconnects; surface the issue only if it stays broken.
			// Keep events; user sees stale data until reconnect.
			tracker.reconnect((lastId) => opts?.onReconnect?.(lastId));
		};

		return () => {
			src.close();
		};
	}, [sessionId, opts?.onReconnect]);

	return { events };
}
