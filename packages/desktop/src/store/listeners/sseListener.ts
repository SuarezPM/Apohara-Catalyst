/**
 * G7.5.A.3 — Client-side consumer of the SSE `state-init` + `state-patch`
 * stream emitted by `/api/session/:id/state`.
 *
 * Sprint 5 G5.F.3 delivered `applyPatch` (RFC 6902 subset). This listener
 * is the first real consumer.
 *
 * Design split:
 *
 *   - `consumeSseStateEvent(prev, evt)` is pure — given the current state
 *     and the incoming SSE message envelope, return the next state. No
 *     side effects, no React, no fetch. Unit-testable in isolation.
 *
 *   - `subscribeStateStream(sessionId, opts)` is the thin wrapper that
 *     opens the browser EventSource and feeds frames into the pure
 *     reducer. Lives next door so the UI hook can import a single
 *     symbol.
 *
 * The state-init / state-patch split matches the server's framing
 * (`packages/desktop/src/server.ts:/api/session/:id/state`). The contract
 * is pinned by `tests/integration/sse-json-patch.test.ts`.
 *
 * Re-delivery safety: if the server (or a flaky proxy) re-sends the same
 * `state-init` after a reconnect, the reducer accepts it as a fresh
 * hydration — last writer wins. A re-delivered `state-patch` against an
 * already-applied state is *idempotent for `replace` ops only*; the
 * pure RFC-6902 spec is not idempotent for `add` against an existing
 * key (it replaces) or `remove` against an absent key (it's a no-op in
 * our subset). Our `applyPatch` implementation treats `add` like
 * `replace` (see `json-patch-stream.ts::applyOne`), so re-delivery is
 * safe in practice. The integration test exercises this path.
 */
import {
	applyPatch,
	type JsonPatchOp,
} from "../../../../../src/core/projector/json-patch-stream.js";
import type { ProjectedState } from "../../server-projection.js";

/**
 * SSE message envelope coming off `/api/session/:id/state`. The server
 * serializes the named-event line as `event: state-init|state-patch`
 * and the JSON payload in the `data:` line; the reducer treats them as
 * a tagged union.
 */
export type SseStateEvent =
	| { event: "state-init"; state: ProjectedState }
	| { event: "state-patch"; patch: JsonPatchOp[] };

/**
 * Apply one SSE state-stream frame to the running state.
 *
 *   - `state-init`: hydrate. Replaces whatever the consumer had.
 *   - `state-patch`: apply RFC-6902 ops to `prev`. If `prev` is null we
 *     can't apply a patch (no base state) — return null and let the
 *     caller request a fresh init. The server emits init before any
 *     patch on every fresh connection, so this branch only fires in
 *     pathological reconnect-with-stale-cache cases.
 */
export function consumeSseStateEvent(
	prev: ProjectedState | null,
	evt: SseStateEvent,
): ProjectedState | null {
	if (evt.event === "state-init") {
		return evt.state;
	}
	if (prev === null) return null;
	return applyPatch(prev, evt.patch) as ProjectedState;
}

/**
 * Options for `subscribeStateStream`. The pure reducer lives in
 * `consumeSseStateEvent`; this side opens the EventSource and shells
 * SSE frames into it.
 */
export interface StateStreamSubscription {
	close(): void;
}

export interface StateStreamOptions {
	onState(state: ProjectedState): void;
	onError?(err: Error): void;
}

/**
 * Browser-side EventSource subscription. Returns a disposer.
 *
 * The dependency on `EventSource` is global; on Bun's test runtime it's
 * not available, which is why the integration test drives
 * `consumeSseStateEvent` directly rather than this wrapper. Production
 * code (React hooks, etc.) calls this.
 */
export function subscribeStateStream(
	sessionId: string,
	opts: StateStreamOptions,
): StateStreamSubscription {
	const url = `/api/session/${encodeURIComponent(sessionId)}/state`;
	const src = new EventSource(url);
	let current: ProjectedState | null = null;

	const handle = (evt: SseStateEvent) => {
		const next = consumeSseStateEvent(current, evt);
		if (next) {
			current = next;
			opts.onState(next);
		}
	};

	src.addEventListener("state-init", (msg) => {
		try {
			const state = JSON.parse(
				(msg as MessageEvent).data,
			) as ProjectedState;
			handle({ event: "state-init", state });
		} catch (err) {
			opts.onError?.(err as Error);
		}
	});

	src.addEventListener("state-patch", (msg) => {
		try {
			const patch = JSON.parse(
				(msg as MessageEvent).data,
			) as JsonPatchOp[];
			handle({ event: "state-patch", patch });
		} catch (err) {
			opts.onError?.(err as Error);
		}
	});

	src.onerror = () => {
		// EventSource auto-reconnects; surface only if the consumer cares.
		// On reconnect the server re-emits `state-init`, so the reducer
		// re-hydrates cleanly.
		opts.onError?.(new Error("SSE state stream connection error"));
	};

	return {
		close() {
			src.close();
		},
	};
}
