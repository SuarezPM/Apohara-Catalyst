import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOrchestrationDb, type OrchestrationDb } from "../../../../src/core/orchestration/db.js";
import { buildRunsTools, startRunsServer } from "../../../../src/core/mcp/servers/apohara-runs.js";

let workDir: string;
let db: OrchestrationDb;
let server: ReturnType<typeof startRunsServer> | null = null;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-runs-mcp-"));
  db = await openOrchestrationDb(join(workDir, "o.db"));
  db.raw().prepare(
    "INSERT INTO coordinator_runs (id, run_id, status, started_at) VALUES (?, ?, ?, ?)"
  ).run("r1", "run-1", "completed", Date.now() - 20000);
  db.raw().prepare(
    "INSERT INTO coordinator_runs (id, run_id, status, started_at) VALUES (?, ?, ?, ?)"
  ).run("r2", "run-2", "completed", Date.now() - 10000);
  db.raw().prepare(
    "INSERT INTO coordinator_runs (id, run_id, status, started_at) VALUES (?, ?, ?, ?)"
  ).run("r3", "run-3", "running", Date.now());
});

afterEach(async () => {
  if (server) { await server.stop(); server = null; }
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

test("buildRunsTools returns 4 tools", () => {
  expect(buildRunsTools(db).length).toBe(4);
});

test("list_runs returns most recent 5", async () => {
  const tools = buildRunsTools(db);
  const list = tools.find(t => t.name === "list_runs")!;
  const r = await list.handler({ filter: { limit: 5 } }) as { runs: unknown[] };
  expect(r.runs.length).toBe(3);
});

test("list_runs filter by status", async () => {
  const tools = buildRunsTools(db);
  const list = tools.find(t => t.name === "list_runs")!;
  const r = await list.handler({ filter: { status: "running" } }) as { runs: unknown[] };
  expect(r.runs.length).toBe(1);
});

test("get_current_run finds the running one", async () => {
  const tools = buildRunsTools(db);
  const current = tools.find(t => t.name === "get_current_run")!;
  const r = await current.handler({}) as { current: { run_id: string } | null };
  expect(r.current?.run_id).toBe("run-3");
});

test("MCP server boot + bearer call to list_runs", async () => {
  server = startRunsServer({
    db, port: 0, bearerToken: "tok",
    auditLogPath: join(workDir, "audit.jsonl"),
  });
  const resp = await fetch(`http://127.0.0.1:${server.bound.port}/`, {
    method: "POST",
    headers: { "Authorization": "Bearer tok", "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "list_runs", input: { filter: { limit: 10 } } }),
  });
  expect(resp.status).toBe(200);
  const data = await resp.json() as { result: { runs: unknown[] } };
  expect(data.result.runs.length).toBe(3);
});