import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOrchestrationDb, type OrchestrationDb } from "../../../src/core/orchestration/db";
import { startRun, setRunStatus } from "../../../src/core/orchestration/coordinator-runs";

let workDir: string;
let db: OrchestrationDb;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-cr-"));
  db = await openOrchestrationDb(join(workDir, "o.db"));
});
afterEach(async () => {
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

test("startRun inserts a row with status starting and ended_at NULL", () => {
  startRun(db, "cr-1", "run-1");
  const row = db.raw().query(
    "SELECT id, run_id, status, started_at, ended_at FROM coordinator_runs WHERE id = ?",
  ).get("cr-1") as {
    id: string;
    run_id: string;
    status: string;
    started_at: number;
    ended_at: number | null;
  };
  expect(row.id).toBe("cr-1");
  expect(row.run_id).toBe("run-1");
  expect(row.status).toBe("starting");
  expect(row.started_at).toBeGreaterThan(0);
  expect(row.ended_at).toBeNull();
});

test("setRunStatus to running keeps ended_at NULL", () => {
  startRun(db, "cr-2", "run-2");
  setRunStatus(db, "cr-2", "running");
  const row = db.raw().query("SELECT status, ended_at FROM coordinator_runs WHERE id = ?").get("cr-2") as {
    status: string;
    ended_at: number | null;
  };
  expect(row.status).toBe("running");
  expect(row.ended_at).toBeNull();
});

test("setRunStatus to completed or aborted stamps ended_at", () => {
  startRun(db, "cr-3", "run-3");
  setRunStatus(db, "cr-3", "completed");
  let row = db.raw().query("SELECT status, ended_at FROM coordinator_runs WHERE id = ?").get("cr-3") as {
    status: string;
    ended_at: number | null;
  };
  expect(row.status).toBe("completed");
  expect(row.ended_at).toBeGreaterThan(0);

  startRun(db, "cr-4", "run-4");
  setRunStatus(db, "cr-4", "aborted");
  row = db.raw().query("SELECT status, ended_at FROM coordinator_runs WHERE id = ?").get("cr-4") as {
    status: string;
    ended_at: number | null;
  };
  expect(row.status).toBe("aborted");
  expect(row.ended_at).toBeGreaterThan(0);
});
