import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOrchestrationDb, type OrchestrationDb } from "../../../../src/core/orchestration/db.js";
import { sendMessage } from "../../../../src/core/orchestration/messages.js";
import { buildLedgerTools, startLedgerServer } from "../../../../src/core/mcp/servers/apohara-ledger.js";

let workDir: string;
let db: OrchestrationDb;
let server: ReturnType<typeof startLedgerServer> | null = null;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-ledger-mcp-"));
  db = await openOrchestrationDb(join(workDir, "o.db"));
});
afterEach(async () => {
  if (server) { await server.stop(); server = null; }
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

test("buildLedgerTools returns 4 tools", () => {
  expect(buildLedgerTools(db).length).toBe(4);
});

test("read_events filters by thread_id (runId)", async () => {
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", payload: {}, threadId: "run-1" });
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", payload: {}, threadId: "run-2" });
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", payload: {}, threadId: "run-1" });

  const tools = buildLedgerTools(db);
  const readEvents = tools.find(t => t.name === "read_events")!;
  const result = await readEvents.handler({ runId: "run-1" }) as { events: unknown[] };
  expect(result.events.length).toBe(2);
});

test("replay_run returns events for a single run", async () => {
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", payload: { n: 1 }, threadId: "r-x" });
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "heartbeat", payload: { n: 2 }, threadId: "r-x" });

  const tools = buildLedgerTools(db);
  const replay = tools.find(t => t.name === "replay_run")!;
  const result = await replay.handler({ runId: "r-x" }) as { run_id: string; events: unknown[]; total: number };
  expect(result.run_id).toBe("r-x");
  expect(result.total).toBe(2);
});

test("get_last_event returns most recent matching type", async () => {
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", payload: { v: 1 }, threadId: "r-y" });
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", payload: { v: 2 }, threadId: "r-y" });
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "heartbeat", payload: {}, threadId: "r-y" });

  const tools = buildLedgerTools(db);
  const getLast = tools.find(t => t.name === "get_last_event")!;
  const result = await getLast.handler({ runId: "r-y", type: "status" }) as { event: { payload: string } | null };
  expect(result.event).not.toBeNull();
  expect(JSON.parse(result.event!.payload).v).toBe(2);
});

test("search_events does substring match over payload", async () => {
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", payload: { msg: "hello world" }, threadId: "r-z" });
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", payload: { msg: "goodbye" }, threadId: "r-z" });

  const tools = buildLedgerTools(db);
  const search = tools.find(t => t.name === "search_events")!;
  const result = await search.handler({ runId: "r-z", query: "hello" }) as { matches: unknown[] };
  expect(result.matches.length).toBe(1);
});

test("MCP server boot + bearer call to read_events", async () => {
  sendMessage(db, { fromHandle: "@a", toHandle: "@b", type: "status", payload: {}, threadId: "boot-1" });
  server = startLedgerServer({
    db, port: 0, bearerToken: "tok",
    auditLogPath: join(workDir, "audit.jsonl"),
  });
  const resp = await fetch(`http://127.0.0.1:${server.bound.port}/`, {
    method: "POST",
    headers: { "Authorization": "Bearer tok", "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "read_events", input: { runId: "boot-1" } }),
  });
  expect(resp.status).toBe(200);
  const data = await resp.json() as { result: { events: unknown[] } };
  expect(data.result.events.length).toBe(1);
});