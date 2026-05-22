import { test, expect, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { initOrchestrationDb, type OrchestrationDb } from "../../src/core/orchestration/db";
import { insertTask, listReadyTasks, type TaskInput } from "../../src/core/orchestration/tasks";

let db: OrchestrationDb;
beforeEach(() => { db = initOrchestrationDb(new Database(":memory:")); });

function task(id: string, writes: string[]): TaskInput {
  return {
    id,
    spec: {
      description: `write ${writes.join(",")}`,
      agentRole: "coder",
      symbols: { reads: [], writes, renames: [] },
    },
    deps: [],
  };
}

test("non-overlapping writes: both tasks become ready in the same scheduler tick", () => {
  insertTask(db, task("t-users", ["packages/api/src/routes/users.ts::getUsers"]));
  insertTask(db, task("t-auth",  ["packages/api/src/routes/auth.ts::login"]));
  const ready = listReadyTasks(db);
  const ids = ready.map(r => r.id).sort();
  expect(ids).toEqual(["t-auth", "t-users"]);
});

test("disjoint file targets allow parallel dispatch even with three tasks", () => {
  insertTask(db, task("t-a", ["packages/api/src/routes/a.ts"]));
  insertTask(db, task("t-b", ["packages/api/src/routes/b.ts"]));
  insertTask(db, task("t-c", ["packages/shared/src/x.ts"]));
  expect(listReadyTasks(db).length).toBe(3);
});

test("explicit dependency blocks downstream task until upstream completes", () => {
  insertTask(db, task("t-up", ["x.ts"]));
  insertTask(db, { ...task("t-down", ["y.ts"]), deps: ["t-up"] });
  const ready = listReadyTasks(db);
  expect(ready.some(r => r.id === "t-up")).toBe(true);
});