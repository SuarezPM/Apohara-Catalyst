import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOrchestrationDb, type OrchestrationDb } from "../../../src/core/orchestration/db";
import { insertTask } from "../../../src/core/orchestration/tasks";
import {
  openGate,
  resolveGate,
  resolveAllBlockingTask,
  listOpenGates,
} from "../../../src/core/orchestration/decision-gates";

let workDir: string;
let db: OrchestrationDb;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-dg-"));
  db = await openOrchestrationDb(join(workDir, "o.db"));
  insertTask(db, {
    id: "t-a",
    spec: { description: "a", agentRole: "coder", symbols: { reads: [], writes: [], renames: [] } },
    deps: [],
  });
  insertTask(db, {
    id: "t-b",
    spec: { description: "b", agentRole: "coder", symbols: { reads: [], writes: [], renames: [] } },
    deps: [],
  });
  insertTask(db, {
    id: "t-c",
    spec: { description: "c", agentRole: "coder", symbols: { reads: [], writes: [], renames: [] } },
    deps: [],
  });
});
afterEach(async () => {
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

test("openGate inserts a row with status open and listOpenGates returns it", () => {
  const id = openGate(db, {
    taskIdBlocked: "t-b",
    taskIdBlocking: "t-a",
    reason: "writes ∩ reads",
    overlapSymbols: [{ symbol: "Foo::bar", kind: "function" }],
  });
  expect(typeof id).toBe("number");
  expect(id).toBeGreaterThan(0);

  const open = listOpenGates(db);
  expect(open.length).toBe(1);
  expect(open[0].id).toBe(id);
  expect(open[0].taskIdBlocked).toBe("t-b");
  expect(open[0].taskIdBlocking).toBe("t-a");
  expect(open[0].reason).toBe("writes ∩ reads");

  // overlap_symbols is JSON-serialized in storage
  const raw = db.raw().query("SELECT overlap_symbols FROM decision_gates WHERE id = ?").get(id) as {
    overlap_symbols: string;
  };
  expect(JSON.parse(raw.overlap_symbols)).toEqual([{ symbol: "Foo::bar", kind: "function" }]);
});

test("resolveGate flips status to resolved and stamps resolved_at", () => {
  const id = openGate(db, { taskIdBlocked: "t-b", taskIdBlocking: "t-a", reason: "x", overlapSymbols: [] });
  resolveGate(db, id);

  const row = db.raw().query("SELECT status, resolved_at FROM decision_gates WHERE id = ?").get(id) as {
    status: string;
    resolved_at: number;
  };
  expect(row.status).toBe("resolved");
  expect(row.resolved_at).toBeGreaterThan(0);
  expect(listOpenGates(db)).toEqual([]);
});

test("resolveAllBlockingTask resolves every open gate blocked by a task and returns the unblocked ids", () => {
  openGate(db, { taskIdBlocked: "t-b", taskIdBlocking: "t-a", reason: "x", overlapSymbols: [] });
  openGate(db, { taskIdBlocked: "t-c", taskIdBlocking: "t-a", reason: "y", overlapSymbols: [] });
  // unrelated gate that must stay open
  openGate(db, { taskIdBlocked: "t-c", taskIdBlocking: "t-b", reason: "z", overlapSymbols: [] });

  const unblocked = resolveAllBlockingTask(db, "t-a");
  expect(unblocked.sort()).toEqual(["t-b", "t-c"]);

  const stillOpen = listOpenGates(db);
  expect(stillOpen.length).toBe(1);
  expect(stillOpen[0].taskIdBlocking).toBe("t-b");
});

test("resolveAllBlockingTask returns empty array when no gates exist", () => {
  expect(resolveAllBlockingTask(db, "t-a")).toEqual([]);
});
