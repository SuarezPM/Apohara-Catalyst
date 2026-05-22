import { test, expect } from "bun:test";
import { EventWriteQueue } from "../../../../src/core/providers/streams/eventWriteQueue";

test("flushes a batch after IDLE_FLUSH_MS", async () => {
  const flushed: unknown[][] = [];
  const q = new EventWriteQueue({
    idleFlushMs: 50,
    thresholdRows: 200,
    flush: async (batch) => { flushed.push(batch); },
  });
  q.enqueue({ id: 1 });
  q.enqueue({ id: 2 });
  await new Promise(r => setTimeout(r, 80));
  expect(flushed.length).toBe(1);
  expect(flushed[0].length).toBe(2);
});

test("flushes immediately when batch reaches thresholdRows", async () => {
  const flushed: unknown[][] = [];
  const q = new EventWriteQueue({
    idleFlushMs: 1000,
    thresholdRows: 3,
    flush: async (batch) => { flushed.push(batch); },
  });
  q.enqueue({ id: 1 });
  q.enqueue({ id: 2 });
  q.enqueue({ id: 3 });
  await new Promise(r => setTimeout(r, 30));
  expect(flushed.length).toBe(1);
  expect(flushed[0].length).toBe(3);
});

test("enqueueAwaited bypasses coalescing and flushes a single-item batch", async () => {
  const flushed: unknown[][] = [];
  const q = new EventWriteQueue({
    idleFlushMs: 1000,
    thresholdRows: 200,
    flush: async (batch) => { flushed.push(batch); },
  });
  await q.enqueueAwaited({ id: 1 });
  expect(flushed.length).toBe(1);
  expect(flushed[0].length).toBe(1);
});

test("queue depth pressure log warning at depth > 500 (smoke)", async () => {
  const q = new EventWriteQueue({
    idleFlushMs: 1000,
    thresholdRows: 200,
    flush: async () => {},
  });
  for (let i = 0; i < 600; i++) q.enqueue({ i });
  await new Promise(r => setTimeout(r, 50));
});