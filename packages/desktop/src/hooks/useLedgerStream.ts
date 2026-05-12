import { useEffect, useState } from "react";
import type { EventLog } from "../lib/types.js";

/**
 * Subscribe to the Bun.serve SSE stream tailing `.events/run-<id>.jsonl`.
 * Returns the live event array. EventSource auto-reconnects on drop.
 *
 * Backend route: GET /api/session/:id/events
 */
export function useLedgerStream(sessionId: string | null) {
	const [events, setEvents] = useState<EventLog[]>([]);

	useEffect(() => {
		if (!sessionId) {
			setEvents([]);
			return;
		}

		const url = `/api/session/${encodeURIComponent(sessionId)}/events`;
		const src = new EventSource(url);

		src.onmessage = (msg) => {
			try {
				const event = JSON.parse(msg.data) as EventLog;
				setEvents((prev) => [...prev, event]);
			} catch {
				// Skip malformed lines
			}
		};

		src.onerror = () => {
			// EventSource auto-reconnects; surface the issue only if it stays broken.
			// Keep events; user sees stale data until reconnect.
		};

		return () => {
			src.close();
		};
	}, [sessionId]);

	return { events };
}
