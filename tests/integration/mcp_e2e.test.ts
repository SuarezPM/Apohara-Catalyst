/**
 * Internal MCP server end-to-end test (§10.12).
 *
 * Picks `apohara.runs` (simplest to exercise — read-only over coordinator_runs)
 * and boots it standalone on an OS-picked port via `startRunsServer`.
 *
 * The base `McpServer` does NOT speak JSON-RPC `tools/list`/`tools/call`. The
 * actual wire format is `{ tool, input }` with `Authorization: Bearer <token>`,
 * so this test exercises the real surface:
 *   - tool discovery via positive-path call (known tool → 200) and a deny path
 *     for an unknown tool (→ 404), which together prove the registry works
 *   - structured response shape for `list_runs`
 *   - audit JSONL append-only log records every call
 *   - bad bearer token → 401 (auth gate)
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { openOrchestrationDb, type OrchestrationDb } from "../../src/core/orchestration/db.js";
import { startRun } from "../../src/core/orchestration/coordinator-runs.js";
import { startRunsServer } from "../../src/core/mcp/servers/apohara-runs.js";
import type { RunningServer } from "../../src/core/mcp/base/McpServer.js";

let workDir: string;
let db: OrchestrationDb;
let server: RunningServer;
let token: string;
let auditPath: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-mcp-e2e-"));
  db = await openOrchestrationDb(join(workDir, "o.db"));
  // Seed a row so list_runs has something concrete to return.
  startRun(db, "cr-e2e-1", "run-e2e-1");

  token = randomBytes(16).toString("hex");
  auditPath = join(workDir, "audit.jsonl");
  // port: 0 lets the OS pick a free port.
  server = startRunsServer({
    db,
    port: 0,
    bearerToken: token,
    auditLogPath: auditPath,
  });
});

afterEach(async () => {
  await server.stop();
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

function endpoint(): string {
  return `http://127.0.0.1:${server.bound.port}/`;
}

function authHeaders(t: string = token): Record<string, string> {
  return { "Authorization": `Bearer ${t}`, "Content-Type": "application/json" };
}

test("server advertises its tools (known tool → 200, unknown → 404)", async () => {
  // No native tools/list — verify the registry by hitting a known tool and
  // confirming an unknown one is rejected with 404 (not 401, not 500).
  const known = await fetch(endpoint(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ tool: "list_runs", input: {} }),
  });
  expect(known.status).toBe(200);

  const unknown = await fetch(endpoint(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ tool: "does_not_exist", input: {} }),
  });
  expect(unknown.status).toBe(404);
});

test("list_runs returns a structured { runs: [...] } payload", async () => {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ tool: "list_runs", input: {} }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { result?: { runs?: unknown[] } };
  expect(body.result).toBeDefined();
  expect(Array.isArray(body.result?.runs)).toBe(true);
  // We seeded one row in beforeEach.
  expect(body.result?.runs?.length).toBeGreaterThanOrEqual(1);
  const first = body.result!.runs![0] as { run_id: string };
  expect(first.run_id).toBe("run-e2e-1");
});

test("audit log JSONL records every call", async () => {
  // Three calls: 1 ok, 1 unknown tool (denied), 1 unauthorized.
  await fetch(endpoint(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ tool: "list_runs", input: {} }),
  });
  await fetch(endpoint(), {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ tool: "does_not_exist", input: {} }),
  });
  await fetch(endpoint(), {
    method: "POST",
    headers: authHeaders("wrong-token"),
    body: JSON.stringify({ tool: "list_runs", input: {} }),
  });

  const raw = await readFile(auditPath, "utf-8");
  const lines = raw.trim().split("\n").filter((l) => l.length > 0);
  // At least three entries; could be more from prior calls in other tests (none here).
  expect(lines.length).toBeGreaterThanOrEqual(3);

  const entries = lines.map((l) => JSON.parse(l) as {
    ts: number;
    server: string;
    tool: string;
    status: string;
    detail?: string;
  });
  for (const e of entries) {
    expect(e.server).toBe("apohara.runs");
    expect(typeof e.ts).toBe("number");
    expect(e.ts).toBeGreaterThan(0);
  }
  const statuses = entries.map((e) => e.status);
  expect(statuses).toContain("ok");
  expect(statuses).toContain("denied");
});

test("server rejects requests with wrong auth token (401)", async () => {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: authHeaders("nope-not-the-real-token"),
    body: JSON.stringify({ tool: "list_runs", input: {} }),
  });
  expect(res.status).toBe(401);
});

test("server rejects requests with no Authorization header (401)", async () => {
  const res = await fetch(endpoint(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "list_runs", input: {} }),
  });
  expect(res.status).toBe(401);
});
