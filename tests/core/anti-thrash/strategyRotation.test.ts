import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FailureTracker } from "../../../src/core/anti-thrash/strategyRotation";

let workDir: string;
beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-thrash-"));
});
afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

test("2 consecutive failures trigger RotationAlert", async () => {
  const tracker = new FailureTracker("t-1", 2, workDir);
  const r1 = await tracker.recordFailure("bash");
  expect(r1.triggered).toBe(false);
  const r2 = await tracker.recordFailure("bash");
  expect(r2.triggered).toBe(true);
  expect(r2.failure_count).toBe(2);
  expect(r2.additionalContext).toContain("STRATEGY ROTATION ALERT");
});

test("recordSuccess resets the counter", async () => {
  const tracker = new FailureTracker("t-1", 2, workDir);
  await tracker.recordFailure("bash");
  await tracker.recordSuccess("bash");
  const r = await tracker.recordFailure("bash");
  expect(r.triggered).toBe(false);
  expect(r.failure_count).toBe(1);
});

test("failures for different tools are tracked separately", async () => {
  const tracker = new FailureTracker("t-1", 2, workDir);
  await tracker.recordFailure("bash");
  const r = await tracker.recordFailure("edit");
  expect(r.triggered).toBe(false); // edit count is only 1
  expect(r.tool).toBe("edit");
});

test("state persists across FailureTracker instances", async () => {
  const t1 = new FailureTracker("t-1", 2, workDir);
  await t1.recordFailure("bash");

  const t2 = new FailureTracker("t-1", 2, workDir);
  const r = await t2.recordFailure("bash");
  expect(r.triggered).toBe(true);
});

test("additionalContext mentions alternatives", async () => {
  const tracker = new FailureTracker("t-1", 2, workDir);
  await tracker.recordFailure("edit");
  const r = await tracker.recordFailure("edit");
  expect(r.additionalContext).toMatch(/different tool|approach/i);
});
