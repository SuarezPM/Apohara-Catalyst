//! MCP servers bootstrap.
//!
//! Mirrors `src/core/mcp/bootstrap.ts`. Spins up all 4 (or 5)
//! internal MCP servers on loopback, writes the endpoint descriptor
//! atomically, and returns a handle that stops every server + removes
//! the endpoint file when dropped via `stop().await`.
//!
//! The TS bootstrap couples to bun:sqlite via OrchestrationDb. This
//! port takes the four backends as injected dependencies (ledger /
//! runs / indexer / settings-path) so the cli/desktop binary builds
//! them once and hands them in; the crate itself stays db-agnostic.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::injection::EndpointPorts;
use crate::server::{McpServer, McpServerConfig, RunningServer};
use crate::servers;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointPort {
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointServers {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ledger: Option<EndpointPort>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub runs: Option<EndpointPort>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub indexer: Option<EndpointPort>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<EndpointPort>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EndpointDescriptor {
    pub token: String,
    pub servers: EndpointServers,
    pub started_at: i64,
}

pub fn default_endpoint_file_path() -> PathBuf {
    let mut p = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push(".apohara");
    p.push("sockets");
    p.push("mcp-endpoints.json");
    p
}

pub fn default_audit_log_path() -> PathBuf {
    let mut p = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push(".apohara");
    p.push("audit");
    p.push("mcp.jsonl");
    p
}

pub fn default_settings_storage_path() -> PathBuf {
    let mut p = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push(".apohara");
    p.push("settings.json");
    p
}

pub struct BootstrapOpts {
    pub ledger: Arc<dyn servers::ledger::LedgerBackend>,
    pub runs: Arc<dyn servers::runs::RunsBackend>,
    pub indexer: Arc<dyn servers::indexer::IndexerClient>,
    pub settings_storage_path: PathBuf,
    pub audit_log_path: PathBuf,
    pub endpoint_file_path: PathBuf,
    /// When true (default false) skip the settings server entirely
    /// (`APOHARA_MCP_SETTINGS_DISABLED=1` kill switch).
    pub disable_settings: bool,
}

impl BootstrapOpts {
    pub fn new(
        ledger: Arc<dyn servers::ledger::LedgerBackend>,
        runs: Arc<dyn servers::runs::RunsBackend>,
        indexer: Arc<dyn servers::indexer::IndexerClient>,
    ) -> Self {
        Self {
            ledger,
            runs,
            indexer,
            settings_storage_path: default_settings_storage_path(),
            audit_log_path: default_audit_log_path(),
            endpoint_file_path: default_endpoint_file_path(),
            disable_settings: false,
        }
    }
}

pub struct BootstrapHandle {
    pub endpoint: EndpointDescriptor,
    pub endpoint_file_path: PathBuf,
    servers: Vec<RunningServer>,
}

impl BootstrapHandle {
    pub fn endpoint_ports(&self) -> EndpointPorts {
        let mut p = EndpointPorts::new();
        if let Some(l) = &self.endpoint.servers.ledger {
            p.push("ledger", l.port);
        }
        if let Some(r) = &self.endpoint.servers.runs {
            p.push("runs", r.port);
        }
        if let Some(i) = &self.endpoint.servers.indexer {
            p.push("indexer", i.port);
        }
        if let Some(s) = &self.endpoint.servers.settings {
            p.push("settings", s.port);
        }
        p
    }

    pub async fn stop(self) {
        for s in self.servers {
            s.stop().await;
        }
        let _ = tokio::fs::remove_file(&self.endpoint_file_path).await;
    }
}

fn random_token_hex() -> String {
    let mut buf = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut buf);
    hex::encode(buf)
}

async fn write_descriptor_atomic(
    path: &Path,
    descriptor: &EndpointDescriptor,
) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let tmp = tempfile::Builder::new()
        .prefix(".apohara-endpoint-")
        .tempfile_in(parent)?;
    let tmp_path = tmp.path().to_path_buf();
    let bytes = serde_json::to_vec_pretty(descriptor)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    tokio::fs::write(&tmp_path, &bytes).await?;
    let (_keep, persisted) = tmp.keep().map_err(|e| e.error)?;
    tokio::fs::rename(&persisted, path).await
}

pub async fn bootstrap_mcp_servers(opts: BootstrapOpts) -> std::io::Result<BootstrapHandle> {
    let token = random_token_hex();
    let mut running: Vec<RunningServer> = Vec::with_capacity(4);

    // ledger
    let mut ledger_server = McpServer::new(McpServerConfig::new(
        "apohara.ledger",
        0,
        &token,
        opts.audit_log_path.clone(),
    ));
    for tool in servers::ledger::build_ledger_tools(opts.ledger.clone()) {
        ledger_server.register(tool);
    }
    let ledger_running = ledger_server.start().await?;
    let ledger_port = ledger_running.port();
    running.push(ledger_running);

    // runs
    let mut runs_server = McpServer::new(McpServerConfig::new(
        "apohara.runs",
        0,
        &token,
        opts.audit_log_path.clone(),
    ));
    for tool in servers::runs::build_runs_tools(opts.runs.clone()) {
        runs_server.register(tool);
    }
    let runs_running = runs_server.start().await?;
    let runs_port = runs_running.port();
    running.push(runs_running);

    // indexer
    let mut indexer_server = McpServer::new(McpServerConfig::new(
        "apohara.indexer",
        0,
        &token,
        opts.audit_log_path.clone(),
    ));
    for tool in servers::indexer::build_indexer_tools(opts.indexer.clone()) {
        indexer_server.register(tool);
    }
    let indexer_running = indexer_server.start().await?;
    let indexer_port = indexer_running.port();
    running.push(indexer_running);

    // settings (optional)
    let settings_port = if opts.disable_settings {
        None
    } else {
        let store = servers::settings::SettingsStore::open(&opts.settings_storage_path).await?;
        let mut settings_server = McpServer::new(McpServerConfig::new(
            "apohara.settings",
            0,
            &token,
            opts.audit_log_path.clone(),
        ));
        for tool in servers::settings::build_settings_tools(store) {
            settings_server.register(tool);
        }
        let s = settings_server.start().await?;
        let port = s.port();
        running.push(s);
        Some(port)
    };

    let descriptor = EndpointDescriptor {
        token,
        servers: EndpointServers {
            ledger: Some(EndpointPort { port: ledger_port }),
            runs: Some(EndpointPort { port: runs_port }),
            indexer: Some(EndpointPort { port: indexer_port }),
            settings: settings_port.map(|port| EndpointPort { port }),
        },
        started_at: chrono::Utc::now().timestamp_millis(),
    };

    write_descriptor_atomic(&opts.endpoint_file_path, &descriptor).await?;

    Ok(BootstrapHandle {
        endpoint: descriptor,
        endpoint_file_path: opts.endpoint_file_path,
        servers: running,
    })
}

/// Convenience: build the canonical config the providers consume,
/// using the bootstrap handle + the path to the apohara binary that
/// will host `apohara mcp serve`.
pub fn build_canonical_from_handle(
    handle: &BootstrapHandle,
    apohara_bin: &str,
) -> crate::McpCanonical {
    crate::injection::build_canonical_from_endpoint(
        apohara_bin,
        &handle.endpoint.token,
        &handle.endpoint_ports(),
    )
}

// Helper kept for symmetry with the TS export — gives a consistent
// way to label endpoint env per-server when downstream code wants a
// concrete `(name, port, env)` triple instead of going through the
// canonical schema.
pub fn label_endpoint_env(name: &str, port: u16, token: &str) -> HashMap<String, String> {
    let mut env = HashMap::new();
    env.insert("APOHARA_MCP_TOKEN".to_string(), token.to_string());
    env.insert("APOHARA_MCP_SERVER".to_string(), name.to_string());
    env.insert("APOHARA_MCP_PORT".to_string(), port.to_string());
    env
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::servers::ledger::LedgerBackend;
    use crate::servers::runs::{RunsBackend, RunRow};
    use async_trait::async_trait;
    use tempfile::TempDir;

    struct EmptyLedger;
    #[async_trait]
    impl LedgerBackend for EmptyLedger {
        async fn read_events(
            &self,
            _: Option<&str>,
            _: Option<&[String]>,
            _: i64,
            _: i64,
        ) -> Result<Vec<crate::servers::ledger::LedgerEvent>, String> {
            Ok(vec![])
        }
        async fn replay_run(
            &self,
            _: &str,
        ) -> Result<Vec<crate::servers::ledger::LedgerEvent>, String> {
            Ok(vec![])
        }
        async fn last_event(
            &self,
            _: &str,
            _: &str,
        ) -> Result<Option<crate::servers::ledger::LedgerEvent>, String> {
            Ok(None)
        }
        async fn search_events(
            &self,
            _: &str,
            _: &str,
        ) -> Result<Vec<crate::servers::ledger::LedgerEvent>, String> {
            Ok(vec![])
        }
    }

    struct EmptyRuns;
    #[async_trait]
    impl RunsBackend for EmptyRuns {
        async fn list_runs(
            &self,
            _filter: crate::servers::runs::ListFilter,
        ) -> Result<Vec<RunRow>, String> {
            Ok(vec![])
        }
        async fn inspect_run(&self, _: &str) -> Result<(Option<RunRow>, i64), String> {
            Ok((None, 0))
        }
        async fn current_run(&self) -> Result<Option<RunRow>, String> {
            Ok(None)
        }
        async fn run_diff(
            &self,
            _: &str,
        ) -> Result<Vec<crate::servers::runs::TaskOutcome>, String> {
            Ok(vec![])
        }
    }

    fn opts(tmp: &TempDir) -> BootstrapOpts {
        let mut o = BootstrapOpts::new(
            Arc::new(EmptyLedger),
            Arc::new(EmptyRuns),
            Arc::new(crate::servers::indexer::StubIndexerClient),
        );
        o.audit_log_path = tmp.path().join("audit.jsonl");
        o.settings_storage_path = tmp.path().join("settings.json");
        o.endpoint_file_path = tmp.path().join("endpoint.json");
        o
    }

    #[tokio::test]
    async fn bootstrap_writes_endpoint_with_4_servers_by_default() {
        let tmp = TempDir::new().unwrap();
        let handle = bootstrap_mcp_servers(opts(&tmp)).await.unwrap();
        assert!(handle.endpoint.servers.ledger.is_some());
        assert!(handle.endpoint.servers.runs.is_some());
        assert!(handle.endpoint.servers.indexer.is_some());
        assert!(handle.endpoint.servers.settings.is_some());
        let bytes = tokio::fs::read(&handle.endpoint_file_path).await.unwrap();
        let parsed: EndpointDescriptor = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(parsed.token, handle.endpoint.token);
        assert_eq!(parsed.token.len(), 32, "16 hex bytes = 32 chars");
        handle.stop().await;
    }

    #[tokio::test]
    async fn bootstrap_omits_settings_when_disabled() {
        let tmp = TempDir::new().unwrap();
        let mut o = opts(&tmp);
        o.disable_settings = true;
        let handle = bootstrap_mcp_servers(o).await.unwrap();
        assert!(handle.endpoint.servers.settings.is_none());
        handle.stop().await;
    }

    #[tokio::test]
    async fn stop_removes_endpoint_file() {
        let tmp = TempDir::new().unwrap();
        let handle = bootstrap_mcp_servers(opts(&tmp)).await.unwrap();
        let path = handle.endpoint_file_path.clone();
        assert!(path.exists());
        handle.stop().await;
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn build_canonical_from_handle_includes_token_and_ports() {
        let tmp = TempDir::new().unwrap();
        let handle = bootstrap_mcp_servers(opts(&tmp)).await.unwrap();
        let canonical = build_canonical_from_handle(&handle, "apohara");
        assert_eq!(canonical.servers.len(), 4);
        for s in &canonical.servers {
            assert_eq!(s.env.get("APOHARA_MCP_TOKEN").unwrap(), &handle.endpoint.token);
            assert!(s.name.starts_with("apohara."));
        }
        handle.stop().await;
    }

    #[test]
    fn label_endpoint_env_carries_token_and_meta() {
        let env = label_endpoint_env("ledger", 4321, "tok");
        assert_eq!(env["APOHARA_MCP_TOKEN"], "tok");
        assert_eq!(env["APOHARA_MCP_SERVER"], "ledger");
        assert_eq!(env["APOHARA_MCP_PORT"], "4321");
    }
}
