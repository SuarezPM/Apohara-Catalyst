import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOrchestrationDb, type OrchestrationDb } from "../../../src/core/orchestration/db";
import { insertTask } from "../../../src/core/orchestration/tasks";
import { insertDispatchContext, updateDispatchStatus } from "../../../src/core/orchestration/dispatch-contexts";
import { shouldBreakCircuit, CIRCUIT_BREAKER_THRESHOLD } from "../../../src/core/orchestration/circuit-breaker";

let workDir: string;
let db: OrchestrationDb;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-cb-"));
  db = await openOrchestrationDb(join(workDir, "o.db"));
  insertTask(db, { id: "t-1", spec: { description: "x", agentRole: "coder", symbols: { reads: [], writes: [], renames: [] } }, deps: [] });
});
afterEach(async () => { db.close(); await rm(workDir, { recursive: true, force: true }); });

test("CIRCUIT_BREAKER_THRESHOLD is 3", () => {
  expect(CIRCUIT_BREAKER_THRESHOLD).toBe(3);
});

test("does NOT break with 2 consecutive failures", () => {
  const id1 = insertDispatchContext(db, { taskId: "t-1", agentHandle: "a", preamble: "p" });
  updateDispatchStatus(db, id1, "failed");
  const id2 = insertDispatchContext(db, { taskId: "t-1", agentHandle: "a", preamble: "p" });
  updateDispatchStatus(db, id2, "failed");
  expect(shouldBreakCircuit(db, "t-1")).toBe(false);
});

test("BREAKS with 3 consecutive failures", () => {
  for (let i = 0; i < 3; i++) {
    const id = insertDispatchContext(db, { taskId: "t-1", agentHandle: "a", preamble: "p" });
    updateDispatchStatus(db, id, "failed");
  }
  expect(shouldBreakCircuit(db, "t-1")).toBe(true);
});

test("DOES NOT break if a success interrupts the failure streak", () => {
  const id1 = insertDispatchContext(db, { taskId: "t-1", agentHandle: "a", preamble: "p" });
  updateDispatchStatus(db, id1, "failed");
  const id2 = insertDispatchContext(db, { taskId: "t-1", agentHandle: "a", preamble: "p" });
  updateDispatchStatus(db, id2, "completed");
  const id3 = insertDispatchContext(db, { taskId: "t-1", agentHandle: "a", preamble: "p" });
  updateDispatchStatus(db, id3, "failed");
  expect(shouldBreakCircuit(db, "t-1")).toBe(false);
});