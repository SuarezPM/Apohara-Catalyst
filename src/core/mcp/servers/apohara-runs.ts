/**
 * apohara.runs MCP server per spec §8.3.
 *
 * Tools: list_runs, inspect_run, get_current_run, get_run_diff.
 * Backed by coordinator_runs table (Stage 2.11) + tasks table (Stage 2.10).
 */
import { McpServer, type ToolRegistration } from "../base/McpServer.js";
import type { OrchestrationDb } from "../../orchestration/db.js";

export interface RunsServerOpts {
  db: OrchestrationDb;
  serverName?: string;
  port: number;
  bearerToken: string;
  auditLogPath: string;
}

export function buildRunsTools(db: OrchestrationDb): ToolRegistration[] {
  return [
    {
      name: "list_runs",
      handler: async (input) => {
        const filter = (input.filter ?? {}) as { status?: string; since?: number; limit?: number };
        const limit = filter.limit ?? 50;
        let sql = "SELECT id, run_id, status, started_at, ended_at FROM coordinator_runs";
        const where: string[] = [];
        const params: unknown[] = [];
        if (filter.status) { where.push("status = ?"); params.push(filter.status); }
        if (filter.since) { where.push("started_at >= ?"); params.push(filter.since); }
        if (where.length > 0) sql += " WHERE " + where.join(" AND ");
        sql += " ORDER BY started_at DESC LIMIT ?";
        params.push(limit);
        const rows = db.raw().query(sql).all(...params as (string | number | null)[]);
        return { runs: rows };
      },
    },
    {
      name: "inspect_run",
      handler: async (input) => {
        const runId = input.runId as string;
        const run = db.raw().query("SELECT * FROM coordinator_runs WHERE run_id = ?").get(runId);
        const taskCount = db.raw().query(
          "SELECT COUNT(*) as count FROM tasks WHERE parent_id = ? OR id = ?"
        ).get(runId, runId) as { count: number } | undefined;
        return { run, task_count: taskCount?.count ?? 0 };
      },
    },
    {
      name: "get_current_run",
      handler: async () => {
        const row = db.raw().query(
          "SELECT id, run_id, status, started_at FROM coordinator_runs WHERE status = 'running' ORDER BY started_at DESC LIMIT 1"
        ).get();
        return { current: row ?? null };
      },
    },
    {
      name: "get_run_diff",
      handler: async (input) => {
        const runId = input.runId as string;
        const tasksDone = db.raw().query(
          "SELECT id, status, completed_at FROM tasks WHERE parent_id = ? AND status IN ('completed', 'failed') ORDER BY completed_at DESC"
        ).all(runId);
        return { run_id: runId, completed_tasks: tasksDone };
      },
    },
  ];
}

export function startRunsServer(opts: RunsServerOpts) {
  const mcp = new McpServer({
    serverName: opts.serverName ?? "apohara.runs",
    port: opts.port,
    bearerToken: opts.bearerToken,
    auditLogPath: opts.auditLogPath,
  });
  for (const tool of buildRunsTools(opts.db)) mcp.register(tool);
  return mcp.start();
}