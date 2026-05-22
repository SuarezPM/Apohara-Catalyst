import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AuditLogger } from "../../../../src/core/mcp/base/auditLogger.js";

let workDir: string;
beforeEach(async () => { workDir = await mkdtemp(join(tmpdir(), "apohara-audit-")); });
afterEach(async () => { await rm(workDir, { recursive: true, force: true }); });

test("log writes JSONL", async () => {
  const path = join(workDir, "audit.jsonl");
  const logger = new AuditLogger(path);
  await logger.log({ ts: 1000, server: "ledger", tool: "read_events", status: "ok" });
  await logger.log({ ts: 2000, server: "ledger", tool: "replay_run", status: "ok" });
  const raw = await readFile(path, "utf-8");
  const lines = raw.trim().split("\n");
  expect(lines.length).toBe(2);
  expect(JSON.parse(lines[0]).ts).toBe(1000);
  expect(JSON.parse(lines[1]).tool).toBe("replay_run");
});

test("log creates parent dir if missing", async () => {
  const path = join(workDir, "nested/audit.jsonl");
  const logger = new AuditLogger(path);
  await logger.log({ ts: 1, server: "x", tool: "y", status: "ok" });
  const raw = await readFile(path, "utf-8");
  expect(raw).toContain('"tool":"y"');
});
