import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOrchestrationDb, type OrchestrationDb } from "../../../src/core/orchestration/db.js";
import { bootstrapMcpServers } from "../../../src/core/mcp/bootstrap.js";

let workDir: string;
let db: OrchestrationDb;
let handle: Awaited<ReturnType<typeof bootstrapMcpServers>> | null = null;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-bootstrap-"));
  db = await openOrchestrationDb(join(workDir, "o.db"));
});
afterEach(async () => {
  if (handle) { await handle.stop(); handle = null; }
  db.close();
  await rm(workDir, { recursive: true, force: true });
});

test("bootstrap starts all 4 servers + writes endpoint file", async () => {
  handle = await bootstrapMcpServers({
    db,
    settingsStoragePath: join(workDir, "settings.json"),
    auditLogPath: join(workDir, "audit.jsonl"),
    endpointFilePath: join(workDir, "endpoints.json"),
  });
  expect(handle.endpoint.token).toMatch(/^[0-9a-f]{32}$/);
  expect(handle.endpoint.servers.ledger?.port).toBeGreaterThan(0);
  expect(handle.endpoint.servers.runs?.port).toBeGreaterThan(0);
  expect(handle.endpoint.servers.indexer?.port).toBeGreaterThan(0);
  expect(handle.endpoint.servers.settings?.port).toBeGreaterThan(0);
  // Endpoint file written
  const raw = await readFile(join(workDir, "endpoints.json"), "utf-8");
  const parsed = JSON.parse(raw);
  expect(parsed.token).toBe(handle.endpoint.token);
  expect(parsed.servers.ledger.port).toBeGreaterThan(0);
});

test("bootstrap token can be used to call each server", async () => {
  handle = await bootstrapMcpServers({
    db,
    settingsStoragePath: join(workDir, "settings.json"),
    auditLogPath: join(workDir, "audit.jsonl"),
    endpointFilePath: join(workDir, "endpoints.json"),
  });
  const headers = { "Authorization": `Bearer ${handle.endpoint.token}`, "Content-Type": "application/json" };

  // Ping each server (just verify auth, not specific tool)
  for (const [_name, srv] of Object.entries(handle.endpoint.servers)) {
    if (!srv) continue;
    const resp = await fetch(`http://127.0.0.1:${srv.port}/`, {
      method: "POST",
      headers,
      body: JSON.stringify({ tool: "nonexistent", input: {} }),
    });
    // Should reach the server (404 for unknown tool, NOT 401)
    expect(resp.status).not.toBe(401);
    expect(resp.status).not.toBe(429);
    expect([200, 404]).toContain(resp.status);
  }
});

test("stop() shuts down all servers + removes endpoint file", async () => {
  const epPath = join(workDir, "endpoints.json");
  handle = await bootstrapMcpServers({
    db,
    settingsStoragePath: join(workDir, "settings.json"),
    auditLogPath: join(workDir, "audit.jsonl"),
    endpointFilePath: epPath,
  });
  expect((await stat(epPath)).isFile()).toBe(true);

  await handle.stop();
  handle = null;

  // Endpoint file should be gone
  await expect(stat(epPath)).rejects.toThrow();
});

test("kill switch APOHARA_MCP_SETTINGS_DISABLED=1 omits settings server", async () => {
  const prev = process.env.APOHARA_MCP_SETTINGS_DISABLED;
  process.env.APOHARA_MCP_SETTINGS_DISABLED = "1";
  try {
    handle = await bootstrapMcpServers({
      db,
      settingsStoragePath: join(workDir, "settings.json"),
      auditLogPath: join(workDir, "audit.jsonl"),
      endpointFilePath: join(workDir, "endpoints.json"),
    });
    expect(handle.endpoint.servers.settings).toBeUndefined();
    expect(handle.endpoint.servers.ledger).toBeDefined();
  } finally {
    if (prev === undefined) delete process.env.APOHARA_MCP_SETTINGS_DISABLED;
    else process.env.APOHARA_MCP_SETTINGS_DISABLED = prev;
  }
});
