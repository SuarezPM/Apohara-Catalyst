/**
 * apohara.indexer MCP server per spec §8.4.
 *
 * Tools: blast_radius, search_symbols, file_symbols, reverse_dependencies.
 * Backend: apohara-indexer Rust crate via UDS (Stage 9+ wires the actual
 * connection). For Stage 8 we provide stubs that match the tool API and
 * accept an optional IndexerClient override for testing.
 */
import { McpServer, type ToolRegistration } from "../base/McpServer.js";
import { optionalString, requireString } from "../base/inputValidation.js";

export interface SymbolMatch {
  file: string;
  symbol: string;
  kind: string;
  line?: number;
}

export interface IndexerClient {
  blastRadius(symbol: string): Promise<{ symbols: SymbolMatch[]; confidence: "high" | "low" | "none" }>;
  searchSymbols(query: string, kind?: string): Promise<{ matches: SymbolMatch[] }>;
  fileSymbols(file: string): Promise<{ symbols: SymbolMatch[] }>;
  reverseDependencies(symbol: string): Promise<{ dependents: SymbolMatch[] }>;
}

class StubIndexerClient implements IndexerClient {
  async blastRadius(_symbol: string) {
    return { symbols: [], confidence: "none" as const };
  }
  async searchSymbols(_query: string, _kind?: string) {
    return { matches: [] };
  }
  async fileSymbols(_file: string) {
    return { symbols: [] };
  }
  async reverseDependencies(_symbol: string) {
    return { dependents: [] };
  }
}

export interface IndexerServerOpts {
  client?: IndexerClient;
  serverName?: string;
  port: number;
  bearerToken: string;
  auditLogPath: string;
}

export function buildIndexerTools(client: IndexerClient): ToolRegistration[] {
  return [
    {
      name: "blast_radius",
      handler: async (input) => client.blastRadius(requireString(input, "symbol")),
    },
    {
      name: "search_symbols",
      handler: async (input) =>
        client.searchSymbols(
          requireString(input, "query"),
          optionalString(input, "kind"),
        ),
    },
    {
      name: "file_symbols",
      handler: async (input) => client.fileSymbols(requireString(input, "file")),
    },
    {
      name: "reverse_dependencies",
      handler: async (input) =>
        client.reverseDependencies(requireString(input, "symbol")),
    },
  ];
}

export function startIndexerServer(opts: IndexerServerOpts) {
  const client = opts.client ?? new StubIndexerClient();
  const mcp = new McpServer({
    serverName: opts.serverName ?? "apohara.indexer",
    port: opts.port,
    bearerToken: opts.bearerToken,
    auditLogPath: opts.auditLogPath,
  });
  for (const tool of buildIndexerTools(client)) mcp.register(tool);
  return mcp.start();
}

export { StubIndexerClient };