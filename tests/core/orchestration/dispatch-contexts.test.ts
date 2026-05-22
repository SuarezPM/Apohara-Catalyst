import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOrchestrationDb, type OrchestrationDb } from "../../../src/core/orchestration/db";
import { insertTask } from "../../../src/core/orchestration/tasks";
import {
  insertDispatchContext,
  updateDispatchStatus,
  countRecentFailedDispatches,
} from "../../../src/core/orchestration/dispatch-contexts";

let workDir: string;
let db: OrchestrationDb;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-dc-"));
  db = await openOrchestrationDb(join(workDir, "o.db"));
  insertTask(db, {
    id: "t-1",
    spec: { description: "x", agentRole: "coder", symbols: { reads: [], writes: [], renames: [] } },
    deps: [],
  });
});
afterEach(async () => {
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

test("insertDispatchContext inserts with status spawning and returns id", () => {
  const id = insertDispatchContext(db, {
    taskId: "t-1",
    agentHandle: "agent:claude:t-1",
    worktreeId: "wt-abc",
    preamble: "hello world",
  });
  expect(typeof id).toBe("number");
  expect(id).toBeGreaterThan(0);

  const row = db.raw().query(
    "SELECT task_id, agent_handle, worktree_id, preamble, status, started_at, completed_at FROM dispatch_contexts WHERE id = ?",
  ).get(id) as {
    task_id: string;
    agent_handle: string;
    worktree_id: string | null;
    preamble: string;
    status: string;
    started_at: number;
    completed_at: number | null;
  };
  expect(row.task_id).toBe("t-1");
  expect(row.agent_handle).toBe("agent:claude:t-1");
  expect(row.worktree_id).toBe("wt-abc");
  expect(row.preamble).toBe("hello world");
  expect(row.status).toBe("spawning");
  expect(row.started_at).toBeGreaterThan(0);
  expect(row.completed_at).toBeNull();
});

test("updateDispatchStatus to running leaves completed_at NULL; to terminal sets it", () => {
  const id = insertDispatchContext(db, { taskId: "t-1", agentHandle: "a", preamble: "" });

  updateDispatchStatus(db, id, "running");
  let row = db.raw().query("SELECT status, completed_at FROM dispatch_contexts WHERE id = ?").get(id) as {
    status: string;
    completed_at: number | null;
  };
  expect(row.status).toBe("running");
  expect(row.completed_at).toBeNull();

  updateDispatchStatus(db, id, "completed");
  row = db.raw().query("SELECT status, completed_at FROM dispatch_contexts WHERE id = ?").get(id) as {
    status: string;
    completed_at: number | null;
  };
  expect(row.status).toBe("completed");
  expect(row.completed_at).toBeGreaterThan(0);
});

test("countRecentFailedDispatches counts failures since last completed (circuit breaker prep)", () => {
  // Two early failures before any success — both should count
  const f1 = insertDispatchContext(db, { taskId: "t-1", agentHandle: "a", preamble: "" });
  updateDispatchStatus(db, f1, "failed");
  const f2 = insertDispatchContext(db, { taskId: "t-1", agentHandle: "a", preamble: "" });
  updateDispatchStatus(db, f2, "failed");
  expect(countRecentFailedDispatches(db, "t-1")).toBe(2);

  // A success resets the window
  const ok = insertDispatchContext(db, { taskId: "t-1", agentHandle: "a", preamble: "" });
  updateDispatchStatus(db, ok, "completed");
  expect(countRecentFailedDispatches(db, "t-1")).toBe(0);

  // New failure after the success counts as 1
  const f3 = insertDispatchContext(db, { taskId: "t-1", agentHandle: "a", preamble: "" });
  updateDispatchStatus(db, f3, "failed");
  expect(countRecentFailedDispatches(db, "t-1")).toBe(1);
});
