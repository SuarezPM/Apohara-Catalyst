import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIndexerTools, startIndexerServer, StubIndexerClient, type IndexerClient } from "../../../../src/core/mcp/servers/apohara-indexer.js";

let workDir: string;
let server: ReturnType<typeof startIndexerServer> | null = null;

beforeEach(async () => { workDir = await mkdtemp(join(tmpdir(), "apohara-indexer-mcp-")); });
afterEach(async () => {
  if (server) { await server.stop(); server = null; }
  await rm(workDir, { recursive: true, force: true });
});

test("buildIndexerTools returns 4 tools", () => {
  const tools = buildIndexerTools(new StubIndexerClient());
  expect(tools.length).toBe(4);
});

test("stub blast_radius returns empty + confidence:none", async () => {
  const tools = buildIndexerTools(new StubIndexerClient());
  const blast = tools.find(t => t.name === "blast_radius")!;
  const r = await blast.handler({ symbol: "foo" }) as { symbols: unknown[]; confidence: string };
  expect(r.symbols).toEqual([]);
  expect(r.confidence).toBe("none");
});

test("custom IndexerClient injection works", async () => {
  class FakeClient implements IndexerClient {
    async blastRadius(symbol: string) {
      return { symbols: [{ file: "a.ts", symbol, kind: "function" }], confidence: "high" as const };
    }
    async searchSymbols() { return { matches: [] }; }
    async fileSymbols() { return { symbols: [] }; }
    async reverseDependencies() { return { dependents: [] }; }
  }
  const tools = buildIndexerTools(new FakeClient());
  const blast = tools.find(t => t.name === "blast_radius")!;
  const r = await blast.handler({ symbol: "verifyJwt" }) as { symbols: { symbol: string }[]; confidence: string };
  expect(r.confidence).toBe("high");
  expect(r.symbols[0].symbol).toBe("verifyJwt");
});

test("MCP server boot + bearer call to search_symbols", async () => {
  server = startIndexerServer({
    port: 0, bearerToken: "tok",
    auditLogPath: join(workDir, "audit.jsonl"),
  });
  const resp = await fetch(`http://127.0.0.1:${server.bound.port}/`, {
    method: "POST",
    headers: { "Authorization": "Bearer tok", "Content-Type": "application/json" },
    body: JSON.stringify({ tool: "search_symbols", input: { query: "User" } }),
  });
  expect(resp.status).toBe(200);
  const data = await resp.json() as { result: { matches: unknown[] } };
  expect(data.result.matches).toEqual([]);
});