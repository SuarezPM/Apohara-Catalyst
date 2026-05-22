import { test, expect, beforeEach } from "bun:test";
import { listenerRegistry, type ListenerHandle } from "../../../src/store/listeners";

beforeEach(() => listenerRegistry.reset());

test("register + dispatch fires registered handler exactly once per event", () => {
  let calls = 0;
  const handle = listenerRegistry.register("apohara://test-event", () => { calls += 1; });
  listenerRegistry.dispatch("apohara://test-event", { foo: 1 });
  listenerRegistry.dispatch("apohara://test-event", { foo: 2 });
  expect(calls).toBe(2);
  handle.dispose();
});

test("dispose removes handler", () => {
  let calls = 0;
  const handle = listenerRegistry.register("apohara://test-event", () => { calls += 1; });
  handle.dispose();
  listenerRegistry.dispatch("apohara://test-event", {});
  expect(calls).toBe(0);
});

test("multiple registers for same event all fire", () => {
  let calls = 0;
  listenerRegistry.register("apohara://test-event", () => { calls += 1; });
  listenerRegistry.register("apohara://test-event", () => { calls += 10; });
  listenerRegistry.dispatch("apohara://test-event", {});
  expect(calls).toBe(11);
});

test("dispatch to non-registered event is a no-op (no throw)", () => {
  expect(() => listenerRegistry.dispatch("apohara://no-one-listening", {})).not.toThrow();
});

test("register throws if handler is not a function", () => {
  expect(() => listenerRegistry.register("apohara://test", null as unknown as () => void)).toThrow();
});

test("async handler rejection is caught and logged, dispatch does not throw", async () => {
  const errors: unknown[] = [];
  const orig = console.error;
  console.error = (...args) => { errors.push(args); };
  try {
    listenerRegistry.register("apohara://async-fail", async () => {
      throw new Error("boom");
    });
    expect(() => listenerRegistry.dispatch("apohara://async-fail", {})).not.toThrow();
    // Wait a microtask tick so the promise rejection settles
    await new Promise((r) => setTimeout(r, 0));
    expect(errors.length).toBeGreaterThan(0);
    const flat = errors.flat().join(" ");
    expect(flat).toContain("apohara://async-fail");
  } finally {
    console.error = orig;
  }
});

test("dispose is idempotent — calling twice does not throw", () => {
  const handle = listenerRegistry.register("apohara://idem", () => {});
  expect(() => {
    handle.dispose();
    handle.dispose();
  }).not.toThrow();
});

test("same function registered twice for same event is deduped (Set semantics)", () => {
  let calls = 0;
  const handler = () => { calls += 1; };
  listenerRegistry.register("apohara://dedupe", handler);
  listenerRegistry.register("apohara://dedupe", handler);
  listenerRegistry.dispatch("apohara://dedupe", {});
  expect(calls).toBe(1);
});

test("handler that registers another handler during dispatch is safe (snapshot semantics)", () => {
  let inner = 0;
  let outer = 0;
  listenerRegistry.register("apohara://mid-register", () => {
    outer += 1;
    // Register a new handler mid-dispatch. Snapshot means it won't fire this round.
    listenerRegistry.register("apohara://mid-register", () => { inner += 1; });
  });
  listenerRegistry.dispatch("apohara://mid-register", {});
  expect(outer).toBe(1);
  expect(inner).toBe(0); // new handler did not fire in same dispatch
  // Second dispatch fires both
  listenerRegistry.dispatch("apohara://mid-register", {});
  expect(outer).toBe(2);
  expect(inner).toBe(1);
});

test("reset() called mid-dispatch does not corrupt iteration", () => {
  let calls = 0;
  listenerRegistry.register("apohara://mid-reset", () => {
    calls += 1;
    listenerRegistry.reset();
  });
  listenerRegistry.register("apohara://mid-reset", () => {
    calls += 1;
  });
  // Both handlers should fire — they're in the snapshot taken before reset.
  expect(() => listenerRegistry.dispatch("apohara://mid-reset", {})).not.toThrow();
  expect(calls).toBe(2);
});
