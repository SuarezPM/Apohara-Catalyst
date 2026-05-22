import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOrchestrationDb, type OrchestrationDb } from "../../../src/core/orchestration/db";
import { sendMessage, listUnread, markRead, type SendMessageInput } from "../../../src/core/orchestration/messages";

let workDir: string;
let db: OrchestrationDb;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-msg-"));
  db = await openOrchestrationDb(join(workDir, "o.db"));
});
afterEach(async () => {
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

test("sendMessage inserts and returns id", () => {
  const id = sendMessage(db, {
    fromHandle: "@scheduler",
    toHandle: "@coordinator",
    type: "dispatch",
    subject: "task-1",
    body: "go",
    payload: { taskId: "task-1" },
  });
  expect(typeof id).toBe("number");
  expect(id).toBeGreaterThan(0);
});

test("listUnread returns unread messages for the recipient", () => {
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", payload: {} });
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "heartbeat", payload: {} });
  sendMessage(db, { fromHandle: "@a", toHandle: "@c", type: "status", payload: {} });

  const unread = listUnread(db, "@b");
  expect(unread.length).toBe(2);
  expect(unread.every(m => m.toHandle === "@b")).toBe(true);
  expect(unread.every(m => m.read === 0)).toBe(true);
});

test("listUnread can filter by type", () => {
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", payload: {} });
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "worker_done", payload: {} });

  const unread = listUnread(db, "@b", { types: ["worker_done"] });
  expect(unread.length).toBe(1);
  expect(unread[0].type).toBe("worker_done");
});

test("markRead flips read flag and sets delivered_at", () => {
  const id = sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", payload: {} });
  markRead(db, id);

  const row = db.raw().query("SELECT read, delivered_at FROM messages WHERE id = ?").get(id) as { read: number; delivered_at: number };
  expect(row.read).toBe(1);
  expect(row.delivered_at).toBeGreaterThan(0);
});

test("messages preserve priority and sort urgent first", () => {
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", priority: "low", payload: {} });
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", priority: "urgent", payload: {} });
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", priority: "normal", payload: {} });

  const unread = listUnread(db, "@b");
  expect(unread.length).toBe(3);
  // listUnread should sort: urgent → normal → low
  expect(unread[0].priority).toBe("urgent");
});
