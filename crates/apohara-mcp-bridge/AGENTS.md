# apohara-mcp-bridge — Agent Guide

Canonical MCP server config + per-provider adapters. Different CLI agents
expect different MCP config dialects (Claude's `~/.claude/mcp.json`, Codex's
`codex.toml`, OpenCode's `opencode.jsonc`); the bridge holds *one* canonical
shape and emits each dialect on demand.

## Responsibility

- Read the canonical Apohara MCP config (TOML).
- Emit a dialect for each supported provider.
- Validate the canonical config (no PII, no API keys, well-formed endpoints).

## Pattern

```rust
use apohara_mcp_bridge::{Canonical, ClaudeDialect, OpenCodeDialect};

let canonical = Canonical::from_path("~/.apohara/mcp.toml")?;
let claude = ClaudeDialect::render(&canonical);
std::fs::write("~/.claude/mcp.json", claude.to_string())?;
let opencode = OpenCodeDialect::render(&canonical);
std::fs::write("<workspace>/opencode.jsonc", opencode.to_string())?;
```

## What this crate is NOT

- Not the MCP server itself — see `src/core/mcp/servers/`.
- Not an MCP *client* — see `src/core/mcp/base/` on the TS side.
- Not a config installer — the TS layer drives the writes; this crate only
  produces text.

## Past incidents

opencode reads `opencode.jsonc` at the workspace root, NEVER
`.opencode/settings.json`. Verify against the upstream CLI's discovery rules
when adding a new dialect — convention does NOT survive an upstream rename.
