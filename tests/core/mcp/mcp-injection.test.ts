import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { injectMcpConfig, buildCanonicalFromEndpoint } from "../../../src/core/mcp/mcpInjection.js";
import type { McpCanonical } from "../../../src/core/mcp/canonical.js";

let workspace: string;

beforeEach(async () => { workspace = await mkdtemp(join(tmpdir(), "apohara-mcp-inject-")); });
afterEach(async () => { await rm(workspace, { recursive: true, force: true }); });

const sample: McpCanonical = {
  servers: [
    { name: "apohara.ledger", command: "apohara", args: ["mcp", "serve", "ledger"], env: { TOK: "x" }, type: "local" },
  ],
};

test("inject claude writes .claude/mcp.json with mcpServers shape", async () => {
  const r = await injectMcpConfig("claude-code-cli", sample, workspace);
  expect(r.configPath).toContain(".claude/mcp.json");
  const raw = await readFile(r.configPath, "utf-8");
  const parsed = JSON.parse(raw);
  expect(parsed.mcpServers["apohara.ledger"].command).toBe("apohara");
  expect(parsed.mcpServers["apohara.ledger"].env.TOK).toBe("x");
});

test("inject codex writes .codex/config.toml with sections", async () => {
  const r = await injectMcpConfig("codex-cli", sample, workspace);
  expect(r.configPath).toContain(".codex/config.toml");
  const raw = await readFile(r.configPath, "utf-8");
  // Names containing `.` are emitted as quoted TOML keys so the
  // section is one flat table rather than a nested `mcp_servers.apohara.ledger`
  // tree. This is the bug fix for the codex.rs TOML emission concern.
  expect(raw).toContain('[mcp_servers."apohara.ledger"]');
  expect(raw).toContain("command = \"apohara\"");
});

test("inject opencode writes .opencode/settings.json with type:local", async () => {
  const r = await injectMcpConfig("opencode-go", sample, workspace);
  const raw = await readFile(r.configPath, "utf-8");
  const parsed = JSON.parse(raw);
  expect(parsed.mcp["apohara.ledger"].type).toBe("local");
});

test("buildCanonicalFromEndpoint builds 4 servers from endpoint descriptor", () => {
  const c = buildCanonicalFromEndpoint("apohara", "tok123", {
    ledger: 1001, runs: 1002, indexer: 1003, settings: 1004,
  });
  expect(c.servers.length).toBe(4);
  expect(c.servers[0].name).toBe("apohara.ledger");
  expect(c.servers[0].env?.APOHARA_MCP_TOKEN).toBe("tok123");
  expect(c.servers[3].name).toBe("apohara.settings");
});

test("buildCanonicalFromEndpoint omits undefined ports", () => {
  const c = buildCanonicalFromEndpoint("apohara", "t", { ledger: 100, runs: undefined as unknown as number });
  expect(c.servers.length).toBe(1);
});

test("inject unknown provider throws", async () => {
  await expect(injectMcpConfig("unknown" as never, sample, workspace)).rejects.toThrow(/unknown provider/);
});