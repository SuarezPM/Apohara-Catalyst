/**
 * MCP bootstrap per spec §8.6.
 *
 * Starts all 4 internal MCP servers, writes endpoint file atomically.
 * Hooks installer (Task 2.6) and BaseAgentProvider.spawn (Task 8.8) read
 * this endpoint file to inject per-spawn MCP config.
 */
import { randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { atomicWriteJson } from "../persistence/atomicWrite.js";
import { startLedgerServer } from "./servers/apohara-ledger.js";
import { startRunsServer } from "./servers/apohara-runs.js";
import { startIndexerServer } from "./servers/apohara-indexer.js";
import { startSettingsServer } from "./servers/apohara-settings.js";
import type { OrchestrationDb } from "../orchestration/db.js";

export interface EndpointDescriptor {
  token: string;
  servers: {
    ledger?: { port: number };
    runs?: { port: number };
    indexer?: { port: number };
    settings?: { port: number };
  };
  startedAt: number;
}

export interface BootstrapOpts {
  db: OrchestrationDb;
  settingsStoragePath?: string;
  auditLogPath?: string;
  endpointFilePath?: string;
}

export interface BootstrapHandle {
  endpoint: EndpointDescriptor;
  endpointFilePath: string;
  stop(): Promise<void>;
}

export function defaultEndpointFilePath(): string {
  return join(homedir(), ".apohara", "sockets", "mcp-endpoints.json");
}

export async function bootstrapMcpServers(opts: BootstrapOpts): Promise<BootstrapHandle> {
  const token = randomBytes(16).toString("hex");
  const auditLogPath = opts.auditLogPath ?? join(homedir(), ".apohara", "audit", "mcp.jsonl");
  const settingsPath = opts.settingsStoragePath ?? join(homedir(), ".apohara", "settings.json");
  const endpointFilePath = opts.endpointFilePath ?? defaultEndpointFilePath();

  // Start each server on port 0 (OS picks free port)
  const ledger = startLedgerServer({ db: opts.db, port: 0, bearerToken: token, auditLogPath });
  const runs = startRunsServer({ db: opts.db, port: 0, bearerToken: token, auditLogPath });
  const indexer = startIndexerServer({ port: 0, bearerToken: token, auditLogPath });
  const settings = startSettingsServer({ storagePath: settingsPath, port: 0, bearerToken: token, auditLogPath });

  const descriptor: EndpointDescriptor = {
    token,
    servers: {
      ledger: { port: ledger.bound.port },
      runs: { port: runs.bound.port },
      indexer: { port: indexer.bound.port },
      ...(settings ? { settings: { port: settings.bound.port } } : {}),
    },
    startedAt: Date.now(),
  };

  await atomicWriteJson(endpointFilePath, descriptor, { ensureParentDir: true });

  return {
    endpoint: descriptor,
    endpointFilePath,
    async stop() {
      await Promise.all([
        ledger.stop(),
        runs.stop(),
        indexer.stop(),
        ...(settings ? [settings.stop()] : []),
      ]);
      // Best-effort: delete endpoint file
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(endpointFilePath);
      } catch { /* ignore */ }
    },
  };
}
