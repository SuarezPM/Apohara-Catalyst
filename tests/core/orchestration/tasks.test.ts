import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOrchestrationDb, type OrchestrationDb } from "../../../src/core/orchestration/db";
import { insertTask, updateTaskStatus, listReadyTasks, type TaskInput } from "../../../src/core/orchestration/tasks";

let workDir: string;
let db: OrchestrationDb;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-tasks-"));
  db = await openOrchestrationDb(join(workDir, "o.db"));
});
afterEach(async () => {
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

test("insertTask creates a row with status pending", () => {
  insertTask(db, {
    id: "t-1",
    spec: { description: "foo", agentRole: "coder", symbols: { reads: [], writes: [], renames: [] } },
    deps: [],
  });
  const row = db.raw().query("SELECT status FROM tasks WHERE id = ?").get("t-1") as { status: string };
  expect(row.status).toBe("pending");
});

test("updateTaskStatus rejects invalid transitions", () => {
  insertTask(db, { id: "t-1", spec: { description: "x", agentRole: "coder", symbols: { reads: [], writes: [], renames: [] } }, deps: [] });
  expect(() => updateTaskStatus(db, "t-1", "completed_invalid" as never)).toThrow();
});

test("listReadyTasks returns tasks with all deps completed", () => {
  insertTask(db, { id: "t-a", spec: { description: "a", agentRole: "coder", symbols: { reads: [], writes: [], renames: [] } }, deps: [] });
  insertTask(db, { id: "t-b", spec: { description: "b", agentRole: "coder", symbols: { reads: [], writes: [], renames: [] } }, deps: ["t-a"] });
  insertTask(db, { id: "t-c", spec: { description: "c", agentRole: "coder", symbols: { reads: [], writes: [], renames: [] } }, deps: ["t-a", "t-b"] });

  // Initially only t-a is ready
  let ready = listReadyTasks(db);
  expect(ready.map(t => t.id).sort()).toEqual(["t-a"]);

  updateTaskStatus(db, "t-a", "completed");
  ready = listReadyTasks(db);
  expect(ready.map(t => t.id).sort()).toEqual(["t-b"]);

  updateTaskStatus(db, "t-b", "completed");
  ready = listReadyTasks(db);
  expect(ready.map(t => t.id).sort()).toEqual(["t-c"]);
});

test("listReadyTasks excludes tasks blocked by an open decision_gate", () => {
  insertTask(db, { id: "t-a", spec: { description: "a", agentRole: "coder", symbols: { reads: [], writes: [], renames: [] } }, deps: [] });
  insertTask(db, { id: "t-b", spec: { description: "b", agentRole: "coder", symbols: { reads: [], writes: [], renames: [] } }, deps: [] });

  db.raw().prepare(`
    INSERT INTO decision_gates (task_id_blocked, task_id_blocking, reason, overlap_symbols, status, opened_at)
    VALUES (?, ?, ?, ?, 'open', ?)
  `).run("t-b", "t-a", "reads ∩ writes", "[]", Date.now());

  const ready = listReadyTasks(db);
  expect(ready.map(t => t.id)).toEqual(["t-a"]);
});
