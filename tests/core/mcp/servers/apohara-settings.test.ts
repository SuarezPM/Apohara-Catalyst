import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSettingsTools, startSettingsServer, SETTING_DENYLIST } from "../../../../src/core/mcp/servers/apohara-settings.js";

let workDir: string;
let server: ReturnType<typeof startSettingsServer> = null;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "apohara-settings-mcp-"));
});
afterEach(async () => {
  if (server) { await server.stop(); server = null; }
  await rm(workDir, { recursive: true, force: true });
});

test("buildSettingsTools returns 3 tools", () => {
  expect(buildSettingsTools(join(workDir, "s.json")).length).toBe(3);
});

test("set + get roundtrip for allowed key", async () => {
  const path = join(workDir, "settings.json");
  const tools = buildSettingsTools(path);
  const set = tools.find(t => t.name === "set_setting")!;
  const get = tools.find(t => t.name === "get_setting")!;
  await set.handler({ key: "ui.theme", value: "dark" });
  const r = await get.handler({ key: "ui.theme" }) as { value: string };
  expect(r.value).toBe("dark");
});

test("set rejects key not in allowlist", async () => {
  const path = join(workDir, "settings.json");
  const tools = buildSettingsTools(path);
  const set = tools.find(t => t.name === "set_setting")!;
  await expect(set.handler({ key: "random.key", value: 1 })).rejects.toThrow(/allowlist/);
});

test("get + set REJECT denylisted keys", async () => {
  const path = join(workDir, "settings.json");
  const tools = buildSettingsTools(path);
  const get = tools.find(t => t.name === "get_setting")!;
  const set = tools.find(t => t.name === "set_setting")!;
  for (const k of SETTING_DENYLIST) {
    await expect(get.handler({ key: k })).rejects.toThrow(/denied/);
    await expect(set.handler({ key: k, value: "x" })).rejects.toThrow(/denied/);
  }
});

test("list_settings strips deny-listed keys defensively", async () => {
  const path = join(workDir, "settings.json");
  const { writeFile, mkdir } = await import("node:fs/promises");
  await mkdir(workDir, { recursive: true });
  await writeFile(path, JSON.stringify({ values: { "ui.theme": "dark", "providers.apiKeys": "leak" } }));

  const tools = buildSettingsTools(path);
  const list = tools.find(t => t.name === "list_settings")!;
  const r = await list.handler({}) as { values: Record<string, unknown> };
  expect(r.values["ui.theme"]).toBe("dark");
  expect(r.values["providers.apiKeys"]).toBeUndefined();
});

test("kill switch APOHARA_MCP_SETTINGS_DISABLED=1 returns null on start", async () => {
  const prev = process.env.APOHARA_MCP_SETTINGS_DISABLED;
  process.env.APOHARA_MCP_SETTINGS_DISABLED = "1";
  try {
    const result = startSettingsServer({
      storagePath: join(workDir, "s.json"),
      port: 0, bearerToken: "tok",
      auditLogPath: join(workDir, "audit.jsonl"),
    });
    expect(result).toBeNull();
  } finally {
    if (prev === undefined) delete process.env.APOHARA_MCP_SETTINGS_DISABLED;
    else process.env.APOHARA_MCP_SETTINGS_DISABLED = prev;
  }
});