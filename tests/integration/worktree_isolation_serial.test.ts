import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initOrchestrationDb, type OrchestrationDb } from "../../src/core/orchestration/db";
import { insertTask, listReadyTasks, updateTaskStatus, type TaskInput } from "../../src/core/orchestration/tasks";
import { openGate, resolveGate } from "../../src/core/orchestration/decision-gates";

let db: OrchestrationDb;
beforeEach(() => { db = initOrchestrationDb(new Database(":memory:")); });

function task(id: string, writes: string[]): TaskInput {
  return { id, spec: { description: "", agentRole: "coder", symbols: { reads: [], writes, renames: [] } }, deps: [] };
}

test("overlap creates decision_gate; blocked task absent from listReadyTasks", () => {
  insertTask(db, task("t-first",  ["packages/api/src/user.ts::createUser"]));
  insertTask(db, task("t-second", ["packages/api/src/user.ts::createUser"]));
  const gateId = openGate(db, {
    taskIdBlocked: "t-second",
    taskIdBlocking: "t-first",
    reason: "writes overlap on createUser",
    overlapSymbols: [],
  });
  const ready = listReadyTasks(db);
  expect(ready.map(r => r.id)).toEqual(["t-first"]);  // t-second blocked
  void gateId;
});

test("resolving the gate unblocks the second task on the next tick", () => {
  insertTask(db, task("t-first", ["x.ts"]));
  insertTask(db, task("t-second", ["x.ts"]));
  const gateId = openGate(db, { taskIdBlocked: "t-second", taskIdBlocking: "t-first", reason: "overlap", overlapSymbols: [] });
  expect(listReadyTasks(db).map(r => r.id)).toEqual(["t-first"]);

  updateTaskStatus(db, "t-first", "completed");
  resolveGate(db, gateId);
  expect(listReadyTasks(db).map(r => r.id).sort()).toEqual(["t-second"]);  // t-first now completed, t-second unblocked
});

test("multiple open gates can block the same task", () => {
  insertTask(db, task("t-c", ["c.ts"]));
  insertTask(db, task("t-blocker-a", ["a.ts"]));
  insertTask(db, task("t-blocker-b", ["b.ts"]));
  const gateId1 = openGate(db, { taskIdBlocked: "t-c", taskIdBlocking: "t-blocker-a", reason: "a", overlapSymbols: [] });
  const gateId2 = openGate(db, { taskIdBlocked: "t-c", taskIdBlocking: "t-blocker-b", reason: "b", overlapSymbols: [] });
  expect(listReadyTasks(db).map(r => r.id)).not.toContain("t-c");
  resolveGate(db, gateId1);
  expect(listReadyTasks(db).map(r => r.id)).not.toContain("t-c");  // still blocked by g2
  resolveGate(db, gateId2);
  updateTaskStatus(db, "t-blocker-a", "completed");
  updateTaskStatus(db, "t-blocker-b", "completed");
  expect(listReadyTasks(db).map(r => r.id)).toContain("t-c");
  void gateId1;
  void gateId2;
});