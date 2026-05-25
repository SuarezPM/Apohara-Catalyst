//! Direct API surface for the Rust mcp path (Sprint 23: ex-`tauri_bridge`).
//!
//! Pure async functions callable directly from the Dioxus desktop via
//! `use_future` — no Tauri, no IPC. The gate logic + inner async commands
//! remain testable from plain cargo.
//!
//! Flag: `APOHARA_RUST_MCP=1` defaults ON post-G1.D.2 flip. Export =0 to opt out (TS
//! legacy continues to handle MCP until Phase 1 cierre flips defaults
//! in G1.D.2).

use std::path::PathBuf;
use std::sync::Arc;

use crate::bootstrap::{
    bootstrap_mcp_servers, BootstrapHandle, BootstrapOpts, EndpointDescriptor,
};
use crate::injection::{inject_mcp_config, InjectionResult, ProviderId};
use crate::servers::indexer::StubIndexerClient;
use crate::servers::ledger::{LedgerBackend, LedgerEvent};
use crate::servers::runs::{ListFilter, RunRow, RunsBackend, TaskOutcome};
use crate::McpCanonical;

use async_trait::async_trait;

/// Pure gate predicate — testable without env mutation.
pub fn is_enabled(env_value: Option<&str>) -> bool {
    env_value != Some("0")
}

fn check_enabled() -> Result<(), String> {
    let env = std::env::var("APOHARA_RUST_MCP").ok();
    if !is_enabled(env.as_deref()) {
        return Err("APOHARA_RUST_MCP explicitly disabled (=0) — TS legacy path active".to_string());
    }
    Ok(())
}

/// Minimal pre-wire backends so `mcp_bootstrap_servers` returns a
/// usable handle even before the cli/desktop binary supplies the real
/// db-backed adapters. They return empty results — the cli/desktop
/// binary swaps them out in G1.D when wiring the orchestration db.
struct EmptyLedger;
#[async_trait]
impl LedgerBackend for EmptyLedger {
    async fn read_events(
        &self,
        _: Option<&str>,
        _: Option<&[String]>,
        _: i64,
        _: i64,
    ) -> Result<Vec<LedgerEvent>, String> {
        Ok(vec![])
    }
    async fn replay_run(&self, _: &str) -> Result<Vec<LedgerEvent>, String> {
        Ok(vec![])
    }
    async fn last_event(&self, _: &str, _: &str) -> Result<Option<LedgerEvent>, String> {
        Ok(None)
    }
    async fn search_events(&self, _: &str, _: &str) -> Result<Vec<LedgerEvent>, String> {
        Ok(vec![])
    }
}

struct EmptyRuns;
#[async_trait]
impl RunsBackend for EmptyRuns {
    async fn list_runs(&self, _: ListFilter) -> Result<Vec<RunRow>, String> {
        Ok(vec![])
    }
    async fn inspect_run(&self, _: &str) -> Result<(Option<RunRow>, i64), String> {
        Ok((None, 0))
    }
    async fn current_run(&self) -> Result<Option<RunRow>, String> {
        Ok(None)
    }
    async fn run_diff(&self, _: &str) -> Result<Vec<TaskOutcome>, String> {
        Ok(vec![])
    }
}

/// Inner async bootstrap reused by the desktop API surface and the
/// CLI binary (Phase 1 G1.D). Uses default paths under `~/.apohara/`.
pub async fn mcp_bootstrap_servers_inner() -> Result<EndpointDescriptor, String> {
    check_enabled()?;
    let opts = BootstrapOpts::new(
        Arc::new(EmptyLedger),
        Arc::new(EmptyRuns),
        Arc::new(StubIndexerClient),
    );
    let handle = bootstrap_mcp_servers(opts)
        .await
        .map_err(|e| e.to_string())?;
    let descriptor = handle.endpoint.clone();
    // Persist handle reference is not required for the bridge —
    // the cli/desktop binary keeps a long-lived `BootstrapHandle`
    // when it wires its own backends. From the IPC's vantage point
    // we just return the descriptor (port + token) and let the
    // shell hold its own reference.
    leak_handle(handle);
    Ok(descriptor)
}

/// Keep the bootstrap handle alive for the lifetime of the desktop
/// process so the servers don't shut down when the IPC call returns.
/// This is intentionally a leak — the process is the lifetime.
fn leak_handle(handle: BootstrapHandle) {
    Box::leak(Box::new(handle));
}

/// Inner async injector reused by the desktop API surface and the CLI
/// binary. The desktop UI calls this after `mcp_bootstrap_servers`
/// returns to write each provider's native config.
pub async fn mcp_inject_config_inner(
    provider_id: ProviderId,
    canonical: McpCanonical,
    workspace_path: String,
) -> Result<InjectionResult, String> {
    check_enabled()?;
    inject_mcp_config(provider_id, &canonical, &PathBuf::from(&workspace_path))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_enabled_default_on_only_zero_disables() {
        assert!(!is_enabled(Some("0")));
        assert!(is_enabled(Some("1")));
        assert!(is_enabled(Some("true")));
        assert!(is_enabled(None));
        assert!(is_enabled(Some("")));
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_mcp_flag)]
    async fn bootstrap_errors_when_flag_unset() {
        std::env::set_var("APOHARA_RUST_MCP", "0");
        let err = mcp_bootstrap_servers_inner().await.unwrap_err();
        assert!(err.contains("explicitly disabled"), "got: {err}");
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_mcp_flag)]
    async fn inject_errors_when_flag_unset() {
        std::env::set_var("APOHARA_RUST_MCP", "0");
        let err = mcp_inject_config_inner(
            ProviderId::ClaudeCodeCli,
            McpCanonical { servers: vec![] },
            "/tmp".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("explicitly disabled"), "got: {err}");
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_mcp_flag)]
    async fn inject_succeeds_when_flag_set() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::env::set_var("APOHARA_RUST_MCP", "1");
        let res = mcp_inject_config_inner(
            ProviderId::ClaudeCodeCli,
            McpCanonical { servers: vec![] },
            tmp.path().display().to_string(),
        )
        .await;
        std::env::remove_var("APOHARA_RUST_MCP");
        let out = res.unwrap();
        assert_eq!(out.provider_id, ProviderId::ClaudeCodeCli);
        assert!(out.config_path.ends_with(".claude/mcp.json"));
    }

    #[test]
    fn endpoint_descriptor_roundtrip_serde() {
        let d = EndpointDescriptor {
            token: "deadbeef".into(),
            servers: crate::bootstrap::EndpointServers {
                ledger: Some(crate::bootstrap::EndpointPort { port: 1 }),
                runs: None,
                indexer: None,
                settings: None,
            },
            started_at: 42,
        };
        let json = serde_json::to_string(&d).unwrap();
        let back: EndpointDescriptor = serde_json::from_str(&json).unwrap();
        assert_eq!(back.token, "deadbeef");
        assert_eq!(back.started_at, 42);
        assert_eq!(back.servers.ledger.as_ref().unwrap().port, 1);
    }
}
