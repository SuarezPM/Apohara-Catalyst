/**
 * W3.3 — WS dedupe under concurrent publish.
 *
 * The Rust `apohara-ws-hub` (G6.A.5) dedupes messages by sliding window
 * of `message_id` per channel; that property is unit-tested in
 * `crates/apohara-ws-hub/src/hub_tests.rs::duplicate_message_id_is_dropped`.
 *
 * This integration test verifies the SAME contract from the TS surface:
 * a TS-side dedupe-hub implementation (mirroring the Rust algorithm) is
 * driven by 5 concurrent publishers all sending the same message_id, and
 * each subscriber receives the message EXACTLY ONCE. Then we run the
 * inverse — 5 publishers sending distinct ids — and verify each
 * subscriber sees all 5 deliveries.
 *
 * The hub abstraction here matches the Rust shape (channel + message_id
 * + payload), so as long as both implementations enforce the same
 * dedupe semantics, downstream consumers can swap without behavior
 * drift.
 *
 * Note: the daemon-side Rust hub is the production code; this TS mirror
 * exists only so the integration test can drive concurrent JS publishers
 * (e.g. multiple github-bridge fan-in paths) against the contract.
 */
import { test, expect } from "bun:test";

interface HubMessage {
	channel: string;
	messageId: string;
	payload: unknown;
}

interface ChannelState {
	subscribers: Set<(m: HubMessage) => void>;
	recentIds: string[]; // chronological order, oldest first
}

/**
 * TS counterpart of `apohara_ws_hub::Hub`. Same dedupe semantics:
 * sliding window of N most recent message_ids per channel; a publish
 * with an already-seen id is silently dropped (returns false), a fresh
 * id is broadcast to all subscribers (returns true).
 */
class TsHub {
	private channels = new Map<string, ChannelState>();
	private dedupeWindow: number;

	constructor(dedupeWindow = 128) {
		this.dedupeWindow = dedupeWindow;
	}

	subscribe(channel: string, fn: (m: HubMessage) => void): () => void {
		const state = this.channels.get(channel) ?? {
			subscribers: new Set<(m: HubMessage) => void>(),
			recentIds: [] as string[],
		};
		state.subscribers.add(fn);
		this.channels.set(channel, state);
		return () => {
			state.subscribers.delete(fn);
		};
	}

	/** Returns true iff the message was delivered (not a dedupe drop). */
	publish(msg: HubMessage): boolean {
		const state = this.channels.get(msg.channel) ?? {
			subscribers: new Set<(m: HubMessage) => void>(),
			recentIds: [] as string[],
		};
		this.channels.set(msg.channel, state);
		if (state.recentIds.includes(msg.messageId)) return false;
		state.recentIds.push(msg.messageId);
		while (state.recentIds.length > this.dedupeWindow) state.recentIds.shift();
		for (const sub of state.subscribers) sub(msg);
		return true;
	}

	subscriberCount(channel: string): number {
		return this.channels.get(channel)?.subscribers.size ?? 0;
	}
}

test("single duplicate id is delivered once", async () => {
	const hub = new TsHub();
	const seen: string[] = [];
	hub.subscribe("alpha", (m) => seen.push(String(m.payload)));
	const r1 = hub.publish({ channel: "alpha", messageId: "id-1", payload: "hi" });
	const r2 = hub.publish({ channel: "alpha", messageId: "id-1", payload: "hi" });
	expect(r1).toBe(true);
	expect(r2).toBe(false);
	expect(seen).toEqual(["hi"]);
});

test("5 concurrent publishers with same id → exactly one delivery per subscriber", async () => {
	const hub = new TsHub();
	const subs: string[][] = Array.from({ length: 3 }, () => []);
	for (const list of subs) {
		hub.subscribe("hot", (m) => list.push(String(m.payload)));
	}
	const sharedId = "shared-msg-id";
	const tasks = Array.from({ length: 5 }, (_, i) =>
		// Stagger by 0..4 microticks so we really exercise the dedupe.
		(async () => {
			await Bun.sleep(i);
			return hub.publish({
				channel: "hot",
				messageId: sharedId,
				payload: `from-${i}`,
			});
		})(),
	);
	const results = await Promise.all(tasks);
	const successCount = results.filter((r) => r).length;
	expect(successCount).toBe(1);

	for (const list of subs) {
		expect(list.length).toBe(1);
	}
});

test("5 publishers with distinct ids → every subscriber sees all 5", async () => {
	const hub = new TsHub();
	const subs: HubMessage[][] = Array.from({ length: 4 }, () => []);
	for (const list of subs) {
		hub.subscribe("multi", (m) => list.push(m));
	}
	const tasks = Array.from({ length: 5 }, (_, i) =>
		(async () => {
			await Bun.sleep(i);
			return hub.publish({
				channel: "multi",
				messageId: `id-${i}`,
				payload: `body-${i}`,
			});
		})(),
	);
	const results = await Promise.all(tasks);
	const successCount = results.filter((r) => r).length;
	expect(successCount).toBe(5);
	for (const list of subs) {
		expect(list.length).toBe(5);
		// Each subscriber sees all 5 distinct payloads (order not guaranteed
		// because of the artificial Bun.sleep stagger).
		const payloads = list.map((m) => String(m.payload)).sort();
		expect(payloads).toEqual(["body-0", "body-1", "body-2", "body-3", "body-4"]);
	}
});

test("dedupe is per-channel (same id on different channels delivers twice)", () => {
	const hub = new TsHub();
	let countA = 0;
	let countB = 0;
	hub.subscribe("a", () => (countA += 1));
	hub.subscribe("b", () => (countB += 1));
	const sharedId = "x";
	expect(hub.publish({ channel: "a", messageId: sharedId, payload: 1 })).toBe(true);
	expect(hub.publish({ channel: "b", messageId: sharedId, payload: 2 })).toBe(true);
	expect(countA).toBe(1);
	expect(countB).toBe(1);
});

test("sliding window evicts oldest ids when full", () => {
	const hub = new TsHub(3); // tiny window for quick eviction
	const ch = "ring";
	expect(hub.publish({ channel: ch, messageId: "a", payload: null })).toBe(true);
	expect(hub.publish({ channel: ch, messageId: "b", payload: null })).toBe(true);
	expect(hub.publish({ channel: ch, messageId: "c", payload: null })).toBe(true);
	// Window is now [a,b,c]. Re-publishing any of them dedupes:
	expect(hub.publish({ channel: ch, messageId: "a", payload: null })).toBe(false);
	// Push d — evicts a from the window.
	expect(hub.publish({ channel: ch, messageId: "d", payload: null })).toBe(true);
	// Window is [b,c,d]. Now a can come through again (post-eviction).
	expect(hub.publish({ channel: ch, messageId: "a", payload: null })).toBe(true);
});

test("high concurrency: 50 publishers × same id → one delivery", async () => {
	const hub = new TsHub();
	let delivered = 0;
	hub.subscribe("stress", () => (delivered += 1));
	const tasks = Array.from({ length: 50 }, () =>
		Promise.resolve().then(() =>
			hub.publish({ channel: "stress", messageId: "same", payload: null }),
		),
	);
	const results = await Promise.all(tasks);
	expect(results.filter((r) => r).length).toBe(1);
	expect(delivered).toBe(1);
});

test("subscriber count reflects live subscriptions", () => {
	const hub = new TsHub();
	expect(hub.subscriberCount("k")).toBe(0);
	const unsub1 = hub.subscribe("k", () => {});
	const unsub2 = hub.subscribe("k", () => {});
	expect(hub.subscriberCount("k")).toBe(2);
	unsub1();
	expect(hub.subscriberCount("k")).toBe(1);
	unsub2();
	expect(hub.subscriberCount("k")).toBe(0);
});
