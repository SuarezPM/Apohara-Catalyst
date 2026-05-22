/**
 * Canonical MCP config (TS mirror of crates/apohara-mcp-bridge/src/canonical.rs).
 * Stage 9+ will replace this with ts-rs codegen from the Rust crate.
 */

export type McpServerType = "local" | "remote";

export interface McpServerCanonical {
  name: string;
  meta?: Record<string, string>;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  type: McpServerType;
}

export interface McpCanonical {
  servers: McpServerCanonical[];
}