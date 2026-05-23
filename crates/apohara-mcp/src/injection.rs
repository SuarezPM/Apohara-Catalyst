//! Per-provider MCP config injection.
//!
//! Mirrors `src/core/mcp/mcpInjection.ts`. Given a canonical config +
//! a target provider id, writes the provider-native dialect to the
//! workspace's expected path:
//!
//!   - claude-code-cli → `<ws>/.claude/mcp.json` (JSON, `mcpServers`)
//!   - codex-cli       → `<ws>/.codex/config.toml` (TOML)
//!   - opencode-go     → `<ws>/opencode.jsonc` (JSON; NOT
//!     `.opencode/settings.json` — opencode 1.15+ discovers config from
//!     `opencode.jsonc` at the workspace root. See past-incident note
//!     in CLAUDE.md for the post-mortem.)
//!
//! Every writer goes through an atomic tmp+rename so a crash mid-write
//! cannot leave a half-baked config that breaks the provider's next
//! startup (§0.8 atomic file writes).

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use apohara_mcp_bridge::{adapters, McpCanonical, McpServerCanonical, McpServerType};
use serde_json::{json, Map, Value};

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderId {
    #[serde(rename = "claude-code-cli")]
    ClaudeCodeCli,
    #[serde(rename = "codex-cli")]
    CodexCli,
    #[serde(rename = "opencode-go")]
    OpencodeGo,
}

impl ProviderId {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::ClaudeCodeCli => "claude-code-cli",
            Self::CodexCli => "codex-cli",
            Self::OpencodeGo => "opencode-go",
        }
    }

    pub fn try_from_str(s: &str) -> Option<Self> {
        Some(match s {
            "claude-code-cli" => Self::ClaudeCodeCli,
            "codex-cli" => Self::CodexCli,
            "opencode-go" => Self::OpencodeGo,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
pub struct InjectionResult {
    pub provider_id: ProviderId,
    pub config_path: PathBuf,
    pub bytes_written: usize,
}

#[derive(Debug, thiserror::Error)]
pub enum InjectionError {
    #[error("unknown provider for MCP injection: {0}")]
    UnknownProvider(String),
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("serialize: {0}")]
    Serialize(#[from] serde_json::Error),
}

pub async fn inject_mcp_config(
    provider_id: ProviderId,
    canonical: &McpCanonical,
    workspace_path: &Path,
) -> Result<InjectionResult, InjectionError> {
    match provider_id {
        ProviderId::ClaudeCodeCli => inject_claude(canonical, workspace_path).await,
        ProviderId::CodexCli => inject_codex(canonical, workspace_path).await,
        ProviderId::OpencodeGo => inject_opencode(canonical, workspace_path).await,
    }
}

async fn atomic_write(path: &Path, contents: &[u8]) -> Result<(), std::io::Error> {
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }
    // tempfile in the same parent dir so the rename stays inside one fs.
    let parent = path.parent().unwrap_or_else(|| Path::new("."));
    let tmp = tempfile::Builder::new()
        .prefix(".apohara-mcp-")
        .tempfile_in(parent)?;
    let tmp_path = tmp.path().to_path_buf();
    tokio::fs::write(&tmp_path, contents).await?;
    // Persist (rename) into place. tempfile crate handles unlink-on-drop
    // for the original handle.
    let (_keep, persisted_path) = tmp.keep().map_err(|e| e.error)?;
    tokio::fs::rename(&persisted_path, path).await?;
    Ok(())
}

async fn inject_claude(
    c: &McpCanonical,
    workspace: &Path,
) -> Result<InjectionResult, InjectionError> {
    let config_path = workspace.join(".claude").join("mcp.json");
    // Build via the bridge adapter (single source of truth for Claude
    // dialect shape).
    let payload = adapters::claude::to_claude(c);
    let mut content = serde_json::to_string_pretty(&payload)?;
    content.push('\n');
    atomic_write(&config_path, content.as_bytes()).await?;
    Ok(InjectionResult {
        provider_id: ProviderId::ClaudeCodeCli,
        config_path,
        bytes_written: content.len(),
    })
}

async fn inject_codex(
    c: &McpCanonical,
    workspace: &Path,
) -> Result<InjectionResult, InjectionError> {
    let config_path = workspace.join(".codex").join("config.toml");
    let content = adapters::codex::to_codex_toml(c);
    atomic_write(&config_path, content.as_bytes()).await?;
    Ok(InjectionResult {
        provider_id: ProviderId::CodexCli,
        config_path,
        bytes_written: content.len(),
    })
}

/// OpenCode injection — uses the upstream 1.15+ schema:
///   { type: "local", command: [bin, ...args], environment?: {...} }
/// (Note: `command` is ONE array, NOT separate `command + args`; and
///  the env field is `environment`, NOT `env`.) The bridge adapter
/// emits the older shape, so we build the JSON directly here.
async fn inject_opencode(
    c: &McpCanonical,
    workspace: &Path,
) -> Result<InjectionResult, InjectionError> {
    let config_path = workspace.join("opencode.jsonc");
    let mut mcp = Map::new();
    for s in &c.servers {
        mcp.insert(s.name.clone(), opencode_server_value(s));
    }
    let payload = json!({ "mcp": Value::Object(mcp) });
    let mut content = serde_json::to_string_pretty(&payload)?;
    content.push('\n');
    atomic_write(&config_path, content.as_bytes()).await?;
    Ok(InjectionResult {
        provider_id: ProviderId::OpencodeGo,
        config_path,
        bytes_written: content.len(),
    })
}

fn opencode_server_value(s: &McpServerCanonical) -> Value {
    let mut full_command = Vec::with_capacity(1 + s.args.len());
    full_command.push(Value::String(s.command.clone()));
    for a in &s.args {
        full_command.push(Value::String(a.clone()));
    }
    let mut obj = Map::new();
    match s.ty {
        McpServerType::Local => {
            obj.insert("type".to_string(), Value::String("local".to_string()));
            obj.insert("command".to_string(), Value::Array(full_command));
            if !s.env.is_empty() {
                let env_value: Map<String, Value> = s
                    .env
                    .iter()
                    .map(|(k, v)| (k.clone(), Value::String(v.clone())))
                    .collect();
                obj.insert("environment".to_string(), Value::Object(env_value));
            }
        }
        McpServerType::Remote => {
            obj.insert("type".to_string(), Value::String("remote".to_string()));
            obj.insert("command".to_string(), Value::Array(full_command));
        }
    }
    Value::Object(obj)
}

/// Build a canonical config from the bootstrap descriptor — the
/// generated config tells the provider how to spawn the `apohara mcp
/// serve <name>` subprocess + carries the bearer token through env.
pub fn build_canonical_from_endpoint(
    apohara_bin: &str,
    token: &str,
    servers: &EndpointPorts,
) -> McpCanonical {
    let mut out: Vec<McpServerCanonical> = Vec::new();
    for (name, port) in servers.iter() {
        let mut env = HashMap::new();
        env.insert("APOHARA_MCP_TOKEN".to_string(), token.to_string());
        out.push(McpServerCanonical {
            name: format!("apohara.{name}"),
            meta: HashMap::new(),
            command: apohara_bin.to_string(),
            args: vec![
                "mcp".to_string(),
                "serve".to_string(),
                name.to_string(),
                "--port".to_string(),
                port.to_string(),
            ],
            env,
            ty: McpServerType::Local,
        });
    }
    McpCanonical { servers: out }
}

/// Stable-ordered key→port map for endpoint enumeration.
#[derive(Debug, Default, Clone)]
pub struct EndpointPorts(Vec<(String, u16)>);

impl EndpointPorts {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&mut self, name: impl Into<String>, port: u16) {
        self.0.push((name.into(), port));
    }

    pub fn iter(&self) -> impl Iterator<Item = &(String, u16)> {
        self.0.iter()
    }

    pub fn len(&self) -> usize {
        self.0.len()
    }

    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn canonical_one() -> McpCanonical {
        let mut env = HashMap::new();
        env.insert("APOHARA_MCP_TOKEN".to_string(), "tok".to_string());
        McpCanonical {
            servers: vec![McpServerCanonical {
                name: "apohara.ledger".to_string(),
                meta: HashMap::new(),
                command: "apohara".to_string(),
                args: vec!["mcp".into(), "serve".into(), "ledger".into()],
                env,
                ty: McpServerType::Local,
            }],
        }
    }

    #[test]
    fn provider_id_roundtrip() {
        for p in [
            ProviderId::ClaudeCodeCli,
            ProviderId::CodexCli,
            ProviderId::OpencodeGo,
        ] {
            assert_eq!(ProviderId::try_from_str(p.as_str()), Some(p));
        }
        assert_eq!(ProviderId::try_from_str("unknown"), None);
    }

    #[tokio::test]
    async fn claude_injection_writes_mcp_servers_shape() {
        let tmp = TempDir::new().unwrap();
        let res = inject_mcp_config(ProviderId::ClaudeCodeCli, &canonical_one(), tmp.path())
            .await
            .unwrap();
        assert_eq!(res.provider_id, ProviderId::ClaudeCodeCli);
        assert_eq!(res.config_path, tmp.path().join(".claude/mcp.json"));
        let raw = tokio::fs::read_to_string(&res.config_path).await.unwrap();
        let parsed: Value = serde_json::from_str(&raw).unwrap();
        assert!(parsed["mcpServers"]["apohara.ledger"]["command"].is_string());
    }

    #[tokio::test]
    async fn codex_injection_writes_quoted_toml_section() {
        let tmp = TempDir::new().unwrap();
        let res = inject_mcp_config(ProviderId::CodexCli, &canonical_one(), tmp.path())
            .await
            .unwrap();
        assert_eq!(res.config_path, tmp.path().join(".codex/config.toml"));
        let raw = tokio::fs::read_to_string(&res.config_path).await.unwrap();
        // Dot in server name forces quoted key — otherwise codex parses as nested table.
        assert!(
            raw.contains("[mcp_servers.\"apohara.ledger\"]"),
            "got: {raw}"
        );
        assert!(!raw.contains("[mcp_servers.apohara.ledger]"));
    }

    #[tokio::test]
    async fn opencode_injection_uses_upstream_1_15_schema() {
        let tmp = TempDir::new().unwrap();
        let res = inject_mcp_config(ProviderId::OpencodeGo, &canonical_one(), tmp.path())
            .await
            .unwrap();
        // Path lives at the workspace root, NOT .opencode/settings.json
        // (past-incident: see CLAUDE.md note).
        assert_eq!(res.config_path, tmp.path().join("opencode.jsonc"));
        let raw = tokio::fs::read_to_string(&res.config_path).await.unwrap();
        let parsed: Value = serde_json::from_str(&raw).unwrap();
        let entry = &parsed["mcp"]["apohara.ledger"];
        assert_eq!(entry["type"], "local");
        // command MUST be a unified array, not separate command/args.
        assert!(entry["command"].is_array());
        assert_eq!(entry["command"][0], "apohara");
        // env field MUST be `environment`, not `env`.
        assert!(entry["environment"]["APOHARA_MCP_TOKEN"].is_string());
        assert!(entry.get("env").is_none(), "no `env` key in opencode shape");
        assert!(
            entry.get("args").is_none(),
            "no separate `args` key in opencode shape"
        );
    }

    #[tokio::test]
    async fn injection_atomic_writes_create_parent_dirs() {
        let tmp = TempDir::new().unwrap();
        // No .claude dir yet — injection must create it.
        let res = inject_mcp_config(ProviderId::ClaudeCodeCli, &canonical_one(), tmp.path())
            .await
            .unwrap();
        assert!(res.config_path.exists());
    }

    #[tokio::test]
    async fn injection_overwrites_existing_file_atomically() {
        let tmp = TempDir::new().unwrap();
        let path = tmp.path().join(".claude/mcp.json");
        tokio::fs::create_dir_all(path.parent().unwrap()).await.unwrap();
        tokio::fs::write(&path, b"OLD CONTENT").await.unwrap();
        let res = inject_mcp_config(ProviderId::ClaudeCodeCli, &canonical_one(), tmp.path())
            .await
            .unwrap();
        let raw = tokio::fs::read_to_string(&res.config_path).await.unwrap();
        assert!(!raw.contains("OLD CONTENT"));
        assert!(raw.contains("apohara.ledger"));
    }

    #[test]
    fn build_canonical_from_endpoint_includes_serve_args() {
        let mut ports = EndpointPorts::new();
        ports.push("ledger", 4001);
        ports.push("runs", 4002);
        let canonical = build_canonical_from_endpoint("apohara", "tok", &ports);
        assert_eq!(canonical.servers.len(), 2);
        let s0 = &canonical.servers[0];
        assert_eq!(s0.name, "apohara.ledger");
        assert_eq!(s0.command, "apohara");
        assert_eq!(s0.args, vec!["mcp", "serve", "ledger", "--port", "4001"]);
        assert_eq!(s0.env.get("APOHARA_MCP_TOKEN").unwrap(), "tok");
        assert_eq!(s0.ty, McpServerType::Local);
    }
}
