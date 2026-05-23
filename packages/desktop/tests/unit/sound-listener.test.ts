/**
 * G7.C.5 — soundListener wiring tests.
 *
 * The listener subscribes to three channels and routes each to the
 * `playSound` helper. We verify the subscribe/dispose contract here;
 * actual audio playback is a no-op in bun:test because `Audio` is
 * undefined (which is exactly the guard the helper relies on).
 */
import { test, expect } from "bun:test";
import { createStore } from "jotai/vanilla";
import {
	registerAllListeners,
	type EventSubscriber,
} from "../../src/store/listeners/index.js";

class MockBus implements EventSubscriber {
	private handlers = new Map<string, Set<(p: unknown) => void>>();
	on(event: string, handler: (p: unknown) => void) {
		let set = this.handlers.get(event);
		if (!set) {
			set = new Set();
			this.handlers.set(event, set);
		}
		set.add(handler);
	}
	off(event: string, handler: (p: unknown) => void) {
		this.handlers.get(event)?.delete(handler);
	}
	emit(event: string, payload: unknown) {
		this.handlers.get(event)?.forEach((h) => h(payload));
	}
	listenerCount(event: string) {
		return this.handlers.get(event)?.size ?? 0;
	}
}

test("soundListener subscribes to task-completed, verifier-conflict, hook-event", () => {
	const store = createStore();
	const bus = new MockBus();
	const handle = registerAllListeners({ store, bus });
	// 1 from taskListeners + 1 from soundListener
	expect(bus.listenerCount("apohara://task-completed")).toBeGreaterThanOrEqual(2);
	// 1 from verifierListeners + 1 from soundListener
	expect(bus.listenerCount("apohara://verifier-conflict")).toBeGreaterThanOrEqual(2);
	// 1 from hookListeners + 1 from statuslineListener + 1 from soundListener
	expect(bus.listenerCount("apohara://hook-event")).toBeGreaterThanOrEqual(3);
	handle.dispose();
});

test("soundListener emission never throws when Audio is undefined (bun env)", () => {
	const store = createStore();
	const bus = new MockBus();
	const handle = registerAllListeners({ store, bus });
	expect(() => {
		bus.emit("apohara://task-completed", { id: "t-1", status: "done" });
		bus.emit("apohara://task-completed", { id: "t-2", status: "failed" });
		bus.emit("apohara://verifier-conflict", {});
		bus.emit("apohara://hook-event", { event: "PermissionRequest" });
		bus.emit("apohara://hook-event", { type: "permission_prompt" });
		bus.emit("apohara://hook-event", { event: "BashInvocation" }); // muted
	}).not.toThrow();
	handle.dispose();
});

test("soundListener dispose removes listeners", () => {
	const store = createStore();
	const bus = new MockBus();
	const before = bus.listenerCount("apohara://task-completed");
	const handle = registerAllListeners({ store, bus });
	const during = bus.listenerCount("apohara://task-completed");
	handle.dispose();
	const after = bus.listenerCount("apohara://task-completed");
	expect(during).toBeGreaterThan(before);
	expect(after).toBe(before);
});
