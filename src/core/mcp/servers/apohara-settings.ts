/**
 * apohara.settings MCP server per spec §8.5.
 *
 * Tools: get_setting, set_setting, list_settings.
 *
 * ALLOWLIST: ui.theme, ui.density, roster.preferred, cost.dailyBudget.
 * DENYLIST: providers.apiKeys, providers.oauth, github.appPrivateKey.
 *
 * KILL SWITCH: APOHARA_MCP_SETTINGS_DISABLED=1 → server.start() returns null.
 *
 * Settings persist via atomicWriteJson to a per-server file.
 */
import { readFile } from "node:fs/promises";
import { McpServer, type ToolRegistration } from "../base/McpServer.js";
import { atomicWriteJson } from "../../persistence/atomicWrite.js";

export const SETTING_ALLOWLIST: ReadonlySet<string> = new Set([
  "ui.theme", "ui.density", "roster.preferred", "cost.dailyBudget",
]);

export const SETTING_DENYLIST: ReadonlySet<string> = new Set([
  "providers.apiKeys", "providers.oauth", "github.appPrivateKey",
]);

export interface SettingsServerOpts {
  storagePath: string;
  serverName?: string;
  port: number;
  bearerToken: string;
  auditLogPath: string;
}

interface SettingsState {
  values: Record<string, unknown>;
}

async function loadSettings(path: string): Promise<SettingsState> {
  try {
    const raw = await readFile(path, "utf-8");
    return JSON.parse(raw) as SettingsState;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return { values: {} };
    throw e;
  }
}

export function buildSettingsTools(storagePath: string): ToolRegistration[] {
  return [
    {
      name: "get_setting",
      handler: async (input) => {
        const key = input.key as string;
        if (SETTING_DENYLIST.has(key)) throw new Error(`denied: ${key}`);
        const state = await loadSettings(storagePath);
        return { key, value: state.values[key] ?? null };
      },
    },
    {
      name: "set_setting",
      handler: async (input) => {
        const key = input.key as string;
        const value = input.value;
        if (SETTING_DENYLIST.has(key)) throw new Error(`denied: ${key}`);
        if (!SETTING_ALLOWLIST.has(key)) throw new Error(`not in allowlist: ${key}`);
        const state = await loadSettings(storagePath);
        state.values[key] = value;
        await atomicWriteJson(storagePath, state, { ensureParentDir: true });
        return { key, value };
      },
    },
    {
      name: "list_settings",
      handler: async () => {
        const state = await loadSettings(storagePath);
        const visible = Object.fromEntries(
          Object.entries(state.values).filter(([k]) => !SETTING_DENYLIST.has(k))
        );
        return { values: visible };
      },
    },
  ];
}

export function startSettingsServer(opts: SettingsServerOpts): ReturnType<McpServer["start"]> | null {
  if (process.env.APOHARA_MCP_SETTINGS_DISABLED === "1") {
    return null;
  }
  const mcp = new McpServer({
    serverName: opts.serverName ?? "apohara.settings",
    port: opts.port,
    bearerToken: opts.bearerToken,
    auditLogPath: opts.auditLogPath,
  });
  for (const tool of buildSettingsTools(opts.storagePath)) mcp.register(tool);
  return mcp.start();
}