import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendCrashReport,
  loadCrashReports,
  type CrashReport,
} from "../../../src/core/crash-reports/jsonl";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "apohara-crash-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

test("appendCrashReport writes JSONL line", async () => {
  const path = join(dir, "crash.jsonl");
  await appendCrashReport(path, {
    ts: 1000,
    installId: "test-uuid",
    message: "Test error",
    stack: "stack trace here",
    context: { sprint: "7.5" },
  });
  const content = await readFile(path, "utf-8");
  const parsed = JSON.parse(content.trim());
  expect(parsed.message).toBe("Test error");
  expect(parsed.installId).toBe("test-uuid");
});

test("loadCrashReports returns ordered list", async () => {
  const path = join(dir, "crash.jsonl");
  await appendCrashReport(path, {
    ts: 1000,
    installId: "a",
    message: "m1",
    stack: "",
    context: {},
  });
  await appendCrashReport(path, {
    ts: 2000,
    installId: "a",
    message: "m2",
    stack: "",
    context: {},
  });
  const reports = await loadCrashReports(path);
  expect(reports.length).toBe(2);
  expect(reports[0].message).toBe("m1");
  expect(reports[1].message).toBe("m2");
});

test("loadCrashReports skips corrupted lines but keeps valid ones", async () => {
  const path = join(dir, "crash.jsonl");
  await appendCrashReport(path, {
    ts: 1,
    installId: "a",
    message: "ok",
    stack: "",
    context: {},
  });
  // Inject a corrupted line between valid ones
  const fs = await import("node:fs/promises");
  await fs.appendFile(path, "not valid json\n");
  await appendCrashReport(path, {
    ts: 2,
    installId: "a",
    message: "also ok",
    stack: "",
    context: {},
  });
  const reports = await loadCrashReports(path);
  expect(reports.length).toBe(2);
  expect(reports[0].message).toBe("ok");
  expect(reports[1].message).toBe("also ok");
});

test("loadCrashReports returns [] when file does not exist", async () => {
  const reports = await loadCrashReports(join(dir, "nonexistent.jsonl"));
  expect(reports).toEqual([]);
});

// Type-only assertion to keep CrashReport in the test's import graph.
const _crashReportTypeCheck: CrashReport = {
  ts: 0,
  installId: "",
  message: "",
  stack: "",
  context: {},
};
void _crashReportTypeCheck;
