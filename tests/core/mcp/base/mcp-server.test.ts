import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "../../../../src/core/mcp/base/McpServer.js";

let workDir: string;
let server: ReturnType<McpServer["start"]> | null = null;

beforeEach(async () => { workDir = await mkdtemp(join(tmpdir(), "apohara-mcp-")); });
afterEach(async () => {
  if (server) { await server.stop(); server = null; }
  await rm(workDir, { recursive: true, force: true });
});

test("401 without bearer", async () => {
  const auditPath = join(workDir, "audit.jsonl");
  const mcp = new McpServer({
    serverName: "test", port: 0, bearerToken: "secret", auditLogPath: auditPath,
  });
  server = mcp.start();
  const resp = await fetch(`http://127.0.0.1:${server.bound.port}/`, { method: "POST" });
  expect(resp.status).toBe(401);
});

test("200 with valid bearer + tool call + audit entry written", async () => {
  const auditPath = join(workDir, "audit.jsonl");
  const mcp = new McpServer({
    serverName: "test", port: 0, bearerToken: "secret", auditLogPath: auditPath,
  });
  mcp.register({ name: "echo", handler: async (input) => ({ echoed: input }) });
  server = mcp.start();
  const resp = await fetch(`http://127.0.0.1:${server.bound.port}/`, {
    method: "POST",
    headers: { "Authorization": "Bearer secret", "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "echo", input: { hello: "world" } }),
  });
  expect(resp.status).toBe(200);
  const data = await resp.json() as { result: { echoed: { hello: string } } };
  expect(data.result.echoed.hello).toBe("world");
  const audit = await readFile(auditPath, "utf-8");
  expect(audit).toContain('"status":"ok"');
  expect(audit).toContain('"tool":"echo"');
});

test("429 after rate limit", async () => {
  const auditPath = join(workDir, "audit.jsonl");
  const mcp = new McpServer({
    serverName: "test", port: 0, bearerToken: "secret", auditLogPath: auditPath,
    rateLimits: { perMinute: 2, perHour: 100 },
  });
  mcp.register({ name: "noop", handler: async () => ({}) });
  server = mcp.start();
  const headers = { "Authorization": "Bearer secret", "Content-Type": "application/json" };
  const url = `http://127.0.0.1:${server.bound.port}/`;
  const body = JSON.stringify({ tool: "noop" });

  await fetch(url, { method: "POST", headers, body });
  await fetch(url, { method: "POST", headers, body });
  const third = await fetch(url, { method: "POST", headers, body });
  expect(third.status).toBe(429);
});
