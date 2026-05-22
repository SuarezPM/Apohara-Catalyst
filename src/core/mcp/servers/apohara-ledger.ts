/**
 * apohara.ledger MCP server per spec §8.2.
 *
 * Tools:
 * - read_events(runId, types?, offset?, limit?)
 * - replay_run(runId)  → returns ordered events for a run
 * - get_last_event(runId, type)
 * - search_events(runId, query) → naive substring match over payload
 *
 * For v1.0 the "ledger" is backed by the orchestration messages table
 * (Stage 2.9). Stage 9+ replaces with the durable ledger if needed.
 */
import { McpServer, type ToolRegistration } from "../base/McpServer.js";
import {
	optionalInteger,
	optionalString,
	optionalStringArray,
	requireString,
} from "../base/inputValidation.js";
import type { OrchestrationDb } from "../../orchestration/db.js";
import type { MessageType } from "../../orchestration/messages.js";

export interface LedgerServerOpts {
  db: OrchestrationDb;
  serverName?: string;
  port: number;
  bearerToken: string;
  auditLogPath: string;
}

export function buildLedgerTools(db: OrchestrationDb): ToolRegistration[] {
  return [
    {
      name: "read_events",
      handler: async (input) => {
        const runId = optionalString(input, "runId");
        const types = optionalStringArray(input, "types") as
          | MessageType[]
          | undefined;
        const offset = optionalInteger(input, "offset", 0) ?? 0;
        const limit = optionalInteger(input, "limit", 100) ?? 100;

        let sql = `SELECT id, from_handle, to_handle, type, payload, ts FROM messages`;
        const where: string[] = [];
        const params: unknown[] = [];
        if (runId) { where.push("thread_id = ?"); params.push(runId); }
        if (types && types.length > 0) {
          where.push(`type IN (${types.map(() => "?").join(",")})`);
          params.push(...types);
        }
        if (where.length > 0) sql += " WHERE " + where.join(" AND ");
        sql += " ORDER BY id ASC LIMIT ? OFFSET ?";
        params.push(limit, offset);

        const rows = db.raw().query(sql).all(...(params as never[]));
        return { events: rows };
      },
    },
    {
      name: "replay_run",
      handler: async (input) => {
        const runId = requireString(input, "runId");
        const rows = db.raw().query(
          `SELECT id, from_handle, to_handle, type, payload, ts FROM messages WHERE thread_id = ? ORDER BY id ASC`
        ).all(runId);
        return { run_id: runId, events: rows, total: rows.length };
      },
    },
    {
      name: "get_last_event",
      handler: async (input) => {
        const runId = requireString(input, "runId");
        const type = requireString(input, "type");
        const row = db.raw().query(
          `SELECT id, from_handle, to_handle, type, payload, ts FROM messages WHERE thread_id = ? AND type = ? ORDER BY id DESC LIMIT 1`
        ).get(runId, type);
        return { event: row ?? null };
      },
    },
    {
      name: "search_events",
      handler: async (input) => {
        const runId = requireString(input, "runId");
        const rawQuery = requireString(input, "query");
        // Escape LIKE wildcards so user-controlled query text can only
        // match what they literally typed, not whatever-they-want via
        // `%` / `_`. ESCAPE clause makes the backslash the literal escape.
        const escaped = rawQuery.replace(/[\\%_]/g, (m) => `\\${m}`);
        const rows = db.raw().query(
          `SELECT id, from_handle, to_handle, type, payload, ts FROM messages WHERE thread_id = ? AND payload LIKE ? ESCAPE '\\' ORDER BY id ASC LIMIT 100`
        ).all(runId, `%${escaped}%`);
        return { matches: rows };
      },
    },
  ];
}

export function startLedgerServer(opts: LedgerServerOpts) {
  const mcp = new McpServer({
    serverName: opts.serverName ?? "apohara.ledger",
    port: opts.port,
    bearerToken: opts.bearerToken,
    auditLogPath: opts.auditLogPath,
  });
  for (const tool of buildLedgerTools(opts.db)) {
    mcp.register(tool);
  }
  return mcp.start();
}