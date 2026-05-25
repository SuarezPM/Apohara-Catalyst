//! Provider roster state — replaces `packages/desktop/src/store/agentConfigStore.ts`.
//!
//! The TS side keyed `agentConfigAtom` by `providerId` (`claude-code-cli`,
//! `codex-cli`, `opencode-go`). The Dioxus side keeps the same shape — a
//! `GlobalSignal<HashMap<String, ProviderEntry>>` — so the runtime can
//! list providers, query roles, and surface `runActive` to the UI without
//! the React/jotai dependency.

use dioxus::prelude::*;
use std::collections::HashMap;

/// MCP server health as surfaced by the bridge. Mirrors the TS literal
/// union `"connected" | "disconnected" | "error"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpStatus {
    Connected,
    Disconnected,
    Error,
}

/// One MCP server attached to a provider entry.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct McpServer {
    pub name: String,
    pub status: McpStatus,
}

/// UI projection of an agent provider. Mirrors `AgentConfigEntry` in
/// `agentConfigStore.ts`.
#[derive(Debug, Clone, PartialEq)]
pub struct ProviderEntry {
    pub provider_id: String,
    pub display_name: String,
    pub roles: Vec<String>,
    pub capabilities: Vec<String>,
    pub permissions: Vec<String>,
    pub mcp_servers: Vec<McpServer>,
    pub run_active: bool,
    /// Whether the provider's CLI binary resolves on the host `PATH`. Set by
    /// the startup probe (W3.A.2); defaults `false` until probed.
    pub available: bool,
}

/// Root signal: `Map<ProviderId, ProviderEntry>`. The Sprint 18 (G2.C.4)
/// re-wire will subscribe `ProviderRoster` to this signal.
pub static ROSTER: GlobalSignal<HashMap<String, ProviderEntry>> =
    Signal::global(HashMap::new);

/// Insert or replace a provider keyed by `entry.provider_id`.
pub fn upsert_provider(entry: ProviderEntry) {
    ROSTER.write().insert(entry.provider_id.clone(), entry);
}

/// Remove a provider by id; no-op if it doesn't exist.
pub fn remove_provider(provider_id: &str) {
    ROSTER.write().remove(provider_id);
}

/// True if any provider currently has `run_active == true`.
pub fn any_run_active() -> bool {
    ROSTER.read().values().any(|p| p.run_active)
}
