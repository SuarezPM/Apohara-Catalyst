//! Apohara MCP — internal MCP servers (bootstrap, canonical schema,
//! mcpInjection, base + servers/{ledger,runs,indexer,settings,commit}).
//!
//! Replaces `src/core/mcp/*.ts` (TS legacy). Feature flag:
//! APOHARA_RUST_MCP=1 (default OFF until Phase 1 cierre).
//!
//! Uses `rmcp` (Rust MCP SDK) per spec §0. G1.C.1 skeleton — modules
//! ported task-by-task following TDD.
