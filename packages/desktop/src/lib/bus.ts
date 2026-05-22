/**
 * Browser-side §0.1 IPC event bus.
 *
 * Stage 7 implementation: a simple `EventTarget`-backed bus that the
 * listener registry in `store/listeners/` subscribes to via
 * `registerAllListeners()`. Producers (Tauri events on Stage 8, the
 * SSE ledger bridge, or future MCP server pushes) call `bus.emit()`
 * and every registered listener handles the payload.
 *
 * Why we need this at runtime (and not just in tests): without a real
 * bus, `App.tsx` never registers any listener, every `apohara://*`
 * event is dropped, and the TaskBoard / PlansPanel / VerificationTimeline
 * panels stay blank even when the orchestrator produces real events.
 */
import type { EventSubscriber } from "../store/listeners/index.js";

export interface EventBus extends EventSubscriber {
	emit(event: string, payload: unknown): void;
}

export function createBus(): EventBus {
	const target = new EventTarget();
	// Wrappers needed because the listener signature does not match
	// `EventListener`; we adapt by storing the wrapper in a Map so
	// `off()` can remove the same reference that `on()` added.
	const wrappers = new Map<
		(payload: unknown) => void,
		Map<string, EventListener>
	>();

	return {
		on(event, handler) {
			let perEvent = wrappers.get(handler);
			if (!perEvent) {
				perEvent = new Map();
				wrappers.set(handler, perEvent);
			}
			if (perEvent.has(event)) return; // idempotent
			const wrapper = (e: Event) => {
				handler((e as CustomEvent).detail);
			};
			perEvent.set(event, wrapper);
			target.addEventListener(event, wrapper);
		},
		off(event, handler) {
			const perEvent = wrappers.get(handler);
			const wrapper = perEvent?.get(event);
			if (!wrapper) return;
			target.removeEventListener(event, wrapper);
			perEvent?.delete(event);
			if (perEvent && perEvent.size === 0) wrappers.delete(handler);
		},
		emit(event, payload) {
			target.dispatchEvent(new CustomEvent(event, { detail: payload }));
		},
	};
}
