/**
 * Multi-subscriber Notifier — G5.C.7 (chorus H19).
 *
 * The existing `packages/desktop/src/lib/bus.ts` is an `EventTarget`-backed
 * bus targeting the browser bridge — sufficient for §0.1 IPC listener
 * registration. The orchestrator side needs a more flexible primitive:
 *
 *   - Multiple independent subscribers per channel (vs. EventTarget's
 *     "register listener" idiom which already supports this but doesn't
 *     expose counts / clear semantics).
 *   - Errors in one subscriber don't poison the rest of the fanout.
 *   - Sync delivery (we return a synchronous result with `delivered` count
 *     and the per-subscriber errors collected).
 *   - Works in node/bun without DOM-shim friction.
 *
 * Async subscribers (returning Promises) are tolerated — we don't await
 * them, the microtask queue drains them on its own. If callers need
 * guaranteed delivery order they can use `subscribe` with a small queue
 * locally.
 */

export type Subscriber<T> = (payload: T) => void | Promise<void>;

export interface SubscriptionHandle {
	unsubscribe(): void;
}

export interface PublishResult {
	delivered: number;
	errors: Error[];
}

export class Notifier<T = unknown> {
	private channels = new Map<string, Set<Subscriber<T>>>();

	subscribe(channel: string, sub: Subscriber<T>): SubscriptionHandle {
		let set = this.channels.get(channel);
		if (!set) {
			set = new Set();
			this.channels.set(channel, set);
		}
		set.add(sub);
		let active = true;
		return {
			unsubscribe: () => {
				if (!active) return;
				active = false;
				const s = this.channels.get(channel);
				if (!s) return;
				s.delete(sub);
				if (s.size === 0) this.channels.delete(channel);
			},
		};
	}

	publish(channel: string, payload: T): PublishResult {
		const set = this.channels.get(channel);
		if (!set || set.size === 0) {
			return { delivered: 0, errors: [] };
		}
		// Snapshot subscribers so handlers that unsubscribe inline don't
		// mutate the iteration.
		const snapshot = [...set];
		const errors: Error[] = [];
		let delivered = 0;
		for (const sub of snapshot) {
			try {
				const result = sub(payload);
				if (
					result &&
					typeof (result as Promise<void>).then === "function"
				) {
					// Async subscriber: route rejection to errors. We don't
					// block on completion.
					(result as Promise<void>).catch((err: unknown) => {
						const e = err instanceof Error ? err : new Error(String(err));
						console.warn(
							`[notifier] async subscriber threw on channel "${channel}": ${e.message}`,
						);
					});
				}
				delivered += 1;
			} catch (err) {
				errors.push(err instanceof Error ? err : new Error(String(err)));
			}
		}
		return { delivered, errors };
	}

	subscriberCount(channel: string): number {
		return this.channels.get(channel)?.size ?? 0;
	}

	clear(channel: string): void {
		this.channels.delete(channel);
	}

	clearAll(): void {
		this.channels.clear();
	}

	listChannels(): string[] {
		return [...this.channels.keys()];
	}
}
