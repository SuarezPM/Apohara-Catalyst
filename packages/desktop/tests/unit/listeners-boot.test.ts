import { test, expect } from "bun:test";
import { createStore } from "jotai/vanilla";
import { registerAllListeners, type EventSubscriber } from "../../src/store/listeners/index.js";
import { tasksAtom } from "../../src/store/dagStore.js";
import { plansAtom } from "../../src/store/plansStore.js";
import { verificationAtom } from "../../src/store/verificationStore.js";

class MockBus implements EventSubscriber {
  private handlers = new Map<string, Set<(p: unknown) => void>>();
  on(event: string, handler: (p: unknown) => void) {
    let set = this.handlers.get(event);
    if (!set) { set = new Set(); this.handlers.set(event, set); }
    set.add(handler);
  }
  off(event: string, handler: (p: unknown) => void) {
    this.handlers.get(event)?.delete(handler);
  }
  emit(event: string, payload: unknown) {
    this.handlers.get(event)?.forEach((h) => h(payload));
  }
  listenerCount(event: string) { return this.handlers.get(event)?.size ?? 0; }
}

test("registerAllListeners wires all listener groups", () => {
  const store = createStore();
  const bus = new MockBus();
  registerAllListeners({ store, bus });
  // G5.C.2 added the statusline listener which also subscribes to
  // run-started, hook-event and context-warning.
  expect(bus.listenerCount("apohara://run-started")).toBeGreaterThanOrEqual(1);
  expect(bus.listenerCount("apohara://task-completed")).toBe(1);
  expect(bus.listenerCount("apohara://verifier-conflict")).toBe(1);
  expect(bus.listenerCount("apohara://hook-event")).toBeGreaterThanOrEqual(1);
  expect(bus.listenerCount("apohara://plan-changed")).toBe(1);
  expect(bus.listenerCount("apohara://plan-added")).toBe(1);
  expect(bus.listenerCount("apohara://plan-removed")).toBe(1);
  expect(bus.listenerCount("apohara://context-warning")).toBe(1);
});

test("dispose() removes all registered listeners", () => {
  const store = createStore();
  const bus = new MockBus();
  const handle = registerAllListeners({ store, bus });
  handle.dispose();
  expect(bus.listenerCount("apohara://run-started")).toBe(0);
  expect(bus.listenerCount("apohara://task-completed")).toBe(0);
  expect(bus.listenerCount("apohara://hook-event")).toBe(0);
  expect(bus.listenerCount("apohara://context-warning")).toBe(0);
});

test("apohara://task-completed event upserts into tasksAtom", () => {
  const store = createStore();
  const bus = new MockBus();
  registerAllListeners({ store, bus });
  bus.emit("apohara://task-completed", { id: "t-1", title: "T", status: "done" });
  expect(store.get(tasksAtom)["t-1"]?.status).toBe("done");
});

test("apohara://plan-changed event upserts into plansAtom", () => {
  const store = createStore();
  const bus = new MockBus();
  registerAllListeners({ store, bus });
  bus.emit("apohara://plan-changed", { planId: "p-1", filepath: "/x", title: "X", status: "active", agentSessions: [] });
  expect(store.get(plansAtom)["p-1"]?.title).toBe("X");
});

test("apohara://verifier-conflict event flips a step status", () => {
  const store = createStore();
  const bus = new MockBus();
  registerAllListeners({ store, bus });
  bus.emit("apohara://verifier-conflict", { step: "judge_scored", status: "failed" });
  expect(store.get(verificationAtom).steps.judge_scored).toBe("failed");
});