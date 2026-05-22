import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOrchestrationDb, type OrchestrationDb } from "../../../src/core/orchestration/db";
import { sendMessage } from "../../../src/core/orchestration/messages";
import { checkWait } from "../../../src/core/orchestration/check-wait";

let workDir: string;
let db: OrchestrationDb;
beforeEach(async () => { workDir = await mkdtemp(join(tmpdir(), "apohara-cw-")); db = await openOrchestrationDb(join(workDir, "o.db")); });
afterEach(async () => { db.close(); await rm(workDir, { recursive: true, force: true }); });

test("returns immediately if message already exists", async () => {
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "worker_done", payload: { ok: true } });
  const start = Date.now();
  const msg = await checkWait(db, { toHandle: "@b", types: ["worker_done"], timeoutMs: 5000, heartbeatStream: null });
  expect(Date.now() - start).toBeLessThan(500);
  expect(msg).not.toBeNull();
  expect(msg?.type).toBe("worker_done");
});

test("returns null on timeout when no matching message arrives", async () => {
  const msg = await checkWait(db, { toHandle: "@b", types: ["worker_done"], timeoutMs: 200, heartbeatStream: null });
  expect(msg).toBeNull();
});

test("returns when a matching message arrives during the wait", async () => {
  setTimeout(() => {
    sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "worker_done", payload: {} });
  }, 100);
  const start = Date.now();
  const msg = await checkWait(db, { toHandle: "@b", types: ["worker_done"], timeoutMs: 5000, heartbeatStream: null });
  expect(Date.now() - start).toBeGreaterThanOrEqual(100);
  expect(msg).not.toBeNull();
});

test("emits JSON heartbeats to stderr stream while waiting", async () => {
  const chunks: string[] = [];
  const fakeStream = { write(s: string) { chunks.push(s); return true; } } as unknown as NodeJS.WriteStream;

  await checkWait(db, {
    toHandle: "@b",
    types: ["worker_done"],
    timeoutMs: 250,
    heartbeatStream: fakeStream,
    heartbeatIntervalMs: 50,
  });

  const heartbeats = chunks.filter(c => c.includes('"_heartbeat":true'));
  expect(heartbeats.length).toBeGreaterThanOrEqual(2);
});
