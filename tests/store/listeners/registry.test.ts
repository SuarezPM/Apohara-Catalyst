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
