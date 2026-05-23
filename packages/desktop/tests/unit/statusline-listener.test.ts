/**
 * G5.C.2 — statusline listener: hook events → status store.
 */
import { test, expect } from "bun:test";
import { createStore } from "jotai/vanilla";
import { statusAtom, INITIAL_STATUS } from "../../src/store/statusStore.js";
import { registerStatuslineListener } from "../../src/store/listeners/statuslineListener.js";

function makeBus() {
	const subs = new Map<string, ((p: unknown) => void)[]>();
	return {
		on(event: string, handler: (p: unknown) => void) {
			const arr = subs.get(event) ?? [];
			arr.push(handler);
			subs.set(event, arr);
		},
		off(event: string, handler: (p: unknown) => void) {
			const arr = subs.get(event);
			if (!arr) return;
			const idx = arr.indexOf(handler);
			if (idx >= 0) arr.splice(idx, 1);
		},
		emit(event: string, payload: unknown) {
			for (const h of subs.get(event) ?? []) h(payload);
		},
	};
}

test("pre_tool_use increments activeToolCount + records lastHook", () => {
	const store = createStore();
	const bus = makeBus();
	const handle = registerStatuslineListener({ store, bus });
	bus.emit("apohara://hook-event", { type: "pre_tool_use", tool_name: "Bash" });
	const v = store.get(statusAtom);
	expect(v.activeToolCount).toBe(1);
	expect(v.lastHook).toBe("pre_tool_use Bash");
	handle.dispose();
});

test("post_tool_use decrements activeToolCount and records latency", () => {
	const store = createStore();
	const bus = makeBus();
	const handle = registerStatuslineListener({ store, bus });
	bus.emit("apohara://hook-event", { type: "pre_tool_use", tool_name: "Bash" });
	bus.emit("apohara://hook-event", {
		type: "post_tool_use",
		tool_name: "Bash",
		duration_ms: 234,
	});
	const v = store.get(statusAtom);
	expect(v.activeToolCount).toBe(0);
	expect(v.lastToolLatencyMs).toBe(234);
	expect(v.lastHook).toBe("post_tool_use Bash");
	handle.dispose();
});

test("post_tool_use never goes below 0", () => {
	const store = createStore();
	const bus = makeBus();
	const handle = registerStatuslineListener({ store, bus });
	bus.emit("apohara://hook-event", { type: "post_tool_use", tool_name: "X" });
	expect(store.get(statusAtom).activeToolCount).toBe(0);
	handle.dispose();
});

test("context warning updates level + sets banner for critical", () => {
	const store = createStore();
	const bus = makeBus();
	const handle = registerStatuslineListener({ store, bus });
	bus.emit("apohara://context-warning", {
		level: "critical",
		tokensUsed: 9700,
		tokensLimit: 10_000,
	});
	const v = store.get(statusAtom);
	expect(v.contextLevel).toBe("critical");
	expect(v.tokensUsed).toBe(9700);
	expect(v.tokensLimit).toBe(10_000);
	expect(v.bannerMessage).toContain("Context near limit");
	handle.dispose();
});

test("context warning warning level shows different banner", () => {
	const store = createStore();
	const bus = makeBus();
	const handle = registerStatuslineListener({ store, bus });
	bus.emit("apohara://context-warning", {
		level: "warning",
		tokensUsed: 8500,
		tokensLimit: 10_000,
	});
	const v = store.get(statusAtom);
	expect(v.contextLevel).toBe("warning");
	expect(v.bannerMessage).toContain("Context filling");
	handle.dispose();
});

test("context warning caution clears the banner", () => {
	const store = createStore();
	const bus = makeBus();
	const handle = registerStatuslineListener({ store, bus });
	bus.emit("apohara://context-warning", { level: "critical" });
	expect(store.get(statusAtom).bannerMessage).toBeTruthy();
	bus.emit("apohara://context-warning", { level: "caution" });
	expect(store.get(statusAtom).bannerMessage).toBeNull();
	handle.dispose();
});

test("run_started resets counters and sets the session label", () => {
	const store = createStore();
	const bus = makeBus();
	const handle = registerStatuslineListener({ store, bus });
	bus.emit("apohara://hook-event", { type: "pre_tool_use", tool_name: "Bash" });
	expect(store.get(statusAtom).activeToolCount).toBe(1);
	bus.emit("apohara://run-started", { sessionId: "sess-xyz" });
	const v = store.get(statusAtom);
	expect(v.activeToolCount).toBe(0);
	expect(v.session).toBe("sess-xyz");
	expect(v.tokensUsed).toBe(0);
	expect(v.contextLevel).toBe("ok");
	handle.dispose();
});

test("dispose() removes subscriptions (no further patches)", () => {
	const store = createStore();
	const bus = makeBus();
	const handle = registerStatuslineListener({ store, bus });
	handle.dispose();
	bus.emit("apohara://hook-event", { type: "pre_tool_use", tool_name: "X" });
	expect(store.get(statusAtom)).toEqual(INITIAL_STATUS);
});

test("malformed hook event (missing type) is ignored gracefully", () => {
	const store = createStore();
	const bus = makeBus();
	const handle = registerStatuslineListener({ store, bus });
	bus.emit("apohara://hook-event", { not_a_type: "noise" });
	expect(store.get(statusAtom)).toEqual(INITIAL_STATUS);
	handle.dispose();
});

test("stop event clears banner", () => {
	const store = createStore();
	const bus = makeBus();
	const handle = registerStatuslineListener({ store, bus });
	bus.emit("apohara://context-warning", { level: "critical" });
	expect(store.get(statusAtom).bannerMessage).toBeTruthy();
	bus.emit("apohara://hook-event", { type: "stop" });
	expect(store.get(statusAtom).bannerMessage).toBeNull();
	handle.dispose();
});
