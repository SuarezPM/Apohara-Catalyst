import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOrchestrationDb } from "../../src/core/orchestration/db";
import { runOrchestrationCommand } from "../../src/cli/orchestration";

let workDir: string;
let dbPath: string;
beforeEach(async () => { workDir = await mkdtemp(join(tmpdir(), "apohara-cli-")); dbPath = join(workDir, "o.db"); (await openOrchestrationDb(dbPath)).close(); });
afterEach(async () => { await rm(workDir, { recursive: true, force: true }); });

test("apohara orchestration send + check round-trip", async () => {
  await runOrchestrationCommand({
    dbPath,
    args: ["send", "--to", "@b", "--type", "status", "--from", "@a", "--body", "hi"],
  });
  const result = await runOrchestrationCommand({
    dbPath,
    args: ["check", "--to", "@b", "--types", "status"],
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("hi");
});

test("apohara orchestration task-create + task-list", async () => {
  await runOrchestrationCommand({
    dbPath,
    args: ["task-create", "--id", "t-1", "--description", "test task", "--role", "coder"],
  });
  const result = await runOrchestrationCommand({
    dbPath,
    args: ["task-list", "--format", "json"],
  });
  expect(result.exitCode).toBe(0);
  const parsed = JSON.parse(result.stdout);
  expect(parsed.length).toBe(1);
  expect(parsed[0].id).toBe("t-1");
});

test("unknown subcommand exits 1 with error JSON in --json mode", async () => {
  const result = await runOrchestrationCommand({
    dbPath,
    args: ["nope", "--json"],
  });
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain('"code"');
});
