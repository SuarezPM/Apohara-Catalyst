/**
 * SSE reconnect backfill tracker — G5.C.8 (chorus H18).
 *
 * EventSource auto-reconnects, but it does not by default attach
 * `Last-Event-ID` unless the server has been sending `id:` lines AND the
 * browser-side implementation honors the spec (Bun + Chrome both do; some
 * older clients do not). For our SSE wrapper we attach the header
 * explicitly so the server can backfill events missed during the outage.
 *
 * The tracker also memoizes the highest event id seen so consumers (the
 * UI bus bridge in `App.tsx`) can drive their own dedupe + cursor logic
 * during the catch-up window.
 *
 * NOTE: This module is the orchestrator-side companion to the desktop
 * `useLedgerStream` hook. The browser EventSource sends Last-Event-ID
 * automatically; the tracker here lives on the server / coordinator
 * side where we proxy SSE between agents and the UI.
 */

export interface BackfillEvent {
	id: string;
	data: unknown;
}

export class SseReconnectTracker {
	private last: string | null = null;
	private reconnectCount = 0;

	record(eventId: string): void {
		if (eventId === "") return;
		this.last = eventId;
	}

	lastEventId(): string | null {
		return this.last;
	}

	reset(): void {
		this.last = null;
		this.reconnectCount = 0;
	}

	reconnectHeaders(): Record<string, string> {
		if (this.last === null) return {};
		return { "Last-Event-ID": this.last };
	}

	/**
	 * Increment the reconnect count and notify the caller with the last id
	 * (so they can request a backfill from that anchor).
	 */
	reconnect(onReconnect: (lastId: string | null) => void): void {
		this.reconnectCount += 1;
		onReconnect(this.last);
	}

	countReconnects(): number {
		return this.reconnectCount;
	}

	/**
	 * Backfill helper — given a list of events the server knows about and a
	 * `lastId` anchor, return the events strictly AFTER `lastId`.
	 *
	 *   - `lastId === null`: fresh connection, deliver everything.
	 *   - `lastId` is the latest known: return [].
	 *   - `lastId` not found in the list: return [] (server-side log of the
	 *     ledger has rotated past the client's anchor; client should retry
	 *     from scratch).
	 */
	async backfillFrom(
		events: BackfillEvent[],
		lastId: string | null,
	): Promise<BackfillEvent[]> {
		if (lastId === null) return [...events];
		const idx = events.findIndex((e) => e.id === lastId);
		if (idx === -1) return [];
		return events.slice(idx + 1);
	}
}
