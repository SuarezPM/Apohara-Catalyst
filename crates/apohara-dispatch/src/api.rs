//! Direct API surface for the Rust dispatch path (Sprint 23: ex-`tauri_bridge`).
//!
//! Pure async functions callable directly from the Dioxus desktop via
//! `use_future` — no Tauri, no IPC. The gate logic + inner async dispatcher
//! remain testable from plain cargo.
//!
//! Flag: `APOHARA_RUST_DISPATCH=1` defaults ON post-G1.D.2 flip. Export =0 to opt out (TS
//! legacy continues to handle dispatch until Phase 1 cierre flips defaults
//! in G1.D.2).

use crate::cli_driver::{CliDriver, DispatchOutcome, DispatchRequest};
use serde::{Deserialize, Serialize};

/// Pure gate predicate — testable without env mutation.
pub fn is_enabled(env_value: Option<&str>) -> bool {
    env_value != Some("0")
}

/// Inner async dispatcher reused by both the Tauri command and the
/// CLI binary (Phase 1 G1.D).
pub async fn rust_dispatch_inner(req: DispatchRequest) -> Result<DispatchOutcome, String> {
    let env = std::env::var("APOHARA_RUST_DISPATCH").ok();
    if !is_enabled(env.as_deref()) {
        return Err(
            "APOHARA_RUST_DISPATCH explicitly disabled (=0) — TS legacy path active".to_string(),
        );
    }
    CliDriver::dispatch(req).await.map_err(|e| e.to_string())
}

/// A provider in the active roster plus whether its CLI binary resolves on the
/// host `PATH`. Consumed by the desktop roster (W3.A.2) and the TUI
/// (`active_agents`). Pablo's hard rule: exactly these 3 ids are active.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ActiveProvider {
    pub id: String,
    pub binary_path: String,
    pub available: bool,
}

/// One entry in the blade discovery catalog: a known agent CLI, its binary
/// name, the config path its MCP injection lands at, and whether Apohara has
/// an MCP bridge adapter for it. Only providers with an adapter can complete
/// the MCP handshake and therefore join the active roster.
struct CatalogEntry {
    /// Roster id (stable, kebab-case).
    id: &'static str,
    /// CLI binary probed on `PATH`.
    binary: &'static str,
    /// Where this provider reads its MCP config. Active providers inject into
    /// the workspace (`<ws>/...`); legacy ones document their per-user home.
    config_path: &'static str,
    /// True only when a `crates/apohara-mcp-bridge/src/adapters/*` adapter
    /// exists for this provider — the prerequisite for MCP bus membership.
    has_mcp_adapter: bool,
}

/// The 3 active providers — each has an MCP bridge adapter (`adapters/claude`,
/// `adapters/codex`, `adapters/opencode`) and an injection writer in
/// `apohara-mcp::injection`. `config_path` mirrors `inject_mcp_config` exactly.
/// Pablo's hard rule: exactly these ids are ever active.
const ACTIVE_PROVIDERS: [CatalogEntry; 3] = [
    CatalogEntry {
        id: "claude-code-cli",
        binary: "claude",
        config_path: "<ws>/.claude/mcp.json",
        has_mcp_adapter: true,
    },
    CatalogEntry {
        id: "codex-cli",
        binary: "codex",
        config_path: "<ws>/.codex/config.toml",
        has_mcp_adapter: true,
    },
    CatalogEntry {
        id: "opencode-go",
        binary: "opencode",
        // Workspace root — NOT .opencode/settings.json (past-incident, see
        // CLAUDE.md). Matches apohara-mcp::injection::inject_opencode.
        config_path: "<ws>/opencode.jsonc",
        has_mcp_adapter: true,
    },
];

/// Known non-active agent CLIs. Probed ONLY under `APOHARA_LEGACY_PROVIDERS=1`.
/// None has an MCP bridge adapter, so even when detected they are reported as
/// excluded — never promoted into the active roster. Binary names + config
/// homes are sourced from real CLI evidence (orca `agent-trust-presets.ts` for
/// cursor-agent / copilot / codex; orca antigravity hook-service for gemini;
/// aider's documented `~/.aider.conf.yml`).
const LEGACY_PROVIDERS: [CatalogEntry; 4] = [
    CatalogEntry {
        id: "cursor-agent",
        binary: "cursor-agent",
        config_path: "~/.cursor/projects/<slug>/.workspace-trusted",
        has_mcp_adapter: false,
    },
    CatalogEntry {
        id: "copilot",
        binary: "copilot",
        config_path: "~/.copilot/config.json",
        has_mcp_adapter: false,
    },
    CatalogEntry {
        id: "gemini",
        binary: "gemini",
        config_path: "~/.gemini/settings.json",
        has_mcp_adapter: false,
    },
    CatalogEntry {
        id: "aider",
        binary: "aider",
        config_path: "~/.aider.conf.yml",
        has_mcp_adapter: false,
    },
];

/// Why a detected provider is (or is not) in the active roster. Serialized
/// snake_case so the UI can render the reason without a translation table.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case", tag = "kind", content = "reason")]
pub enum ProviderStatus {
    /// In `PATH`, has an MCP adapter → joins the active roster.
    Active,
    /// In `PATH` but no MCP bridge adapter exists, so it cannot complete the
    /// MCP handshake. Reported (not silently dropped) with this reason.
    ExcludedNoMcpAdapter(String),
    /// Catalog member whose binary was not found on `PATH`.
    Unavailable(String),
}

/// A catalog provider after PATH probing: its id, the resolved (or bare)
/// binary path, its config path, whether it can join the MCP bus, and a
/// status that REPORTS why it is or isn't in the active roster.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DetectedProvider {
    pub id: String,
    pub binary_path: String,
    pub config_path: String,
    pub available: bool,
    pub mcp_ready: bool,
    pub status: ProviderStatus,
}

#[cfg(unix)]
fn is_executable(path: &std::path::Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(path)
        .map(|m| m.is_file() && m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false)
}

#[cfg(not(unix))]
fn is_executable(path: &std::path::Path) -> bool {
    path.is_file()
}

/// Resolve `binary` against the host `PATH`, returning the first executable
/// match. Pure lookup — no subprocess spawn — so it's cheap and deterministic.
fn find_in_path(binary: &str) -> Option<String> {
    let paths = std::env::var_os("PATH")?;
    std::env::split_paths(&paths)
        .map(|dir| dir.join(binary))
        .find(|candidate| is_executable(candidate))
        .map(|p| p.to_string_lossy().into_owned())
}

/// Classify a single catalog entry against the host `PATH`. `binary_path` is
/// the resolved path when found, else the bare binary name (so the UI can show
/// what it searched for). The status reports *why* the provider is or isn't in
/// the active roster — a detected binary that cannot join the MCP bus is
/// excluded with a reason, never silently dropped.
fn classify(entry: &CatalogEntry) -> DetectedProvider {
    let found = find_in_path(entry.binary);
    let available = found.is_some();
    let binary_path = found.unwrap_or_else(|| entry.binary.to_string());
    let (mcp_ready, status) = match (available, entry.has_mcp_adapter) {
        (true, true) => (true, ProviderStatus::Active),
        (true, false) => (
            false,
            ProviderStatus::ExcludedNoMcpAdapter(format!(
                "{} is on PATH but has no MCP bridge adapter; cannot complete the MCP handshake",
                entry.id
            )),
        ),
        (false, _) => (
            false,
            ProviderStatus::Unavailable(format!("{} not found on PATH", entry.binary)),
        ),
    };
    DetectedProvider {
        id: entry.id.to_string(),
        binary_path,
        config_path: entry.config_path.to_string(),
        available,
        mcp_ready,
        status,
    }
}

/// PATH-aware blade discovery over the known agent-CLI catalog: the 3 active
/// providers always, plus the LEGACY set only when `APOHARA_LEGACY_PROVIDERS=1`.
/// Every catalog member is classified and REPORTED — a detected legacy binary
/// with no MCP adapter is surfaced as `ExcludedNoMcpAdapter`, never dropped.
/// Order is deterministic: active entries first, then legacy.
pub fn detect_providers() -> Vec<DetectedProvider> {
    let legacy_enabled = std::env::var("APOHARA_LEGACY_PROVIDERS").as_deref() == Ok("1");
    let mut out: Vec<DetectedProvider> = ACTIVE_PROVIDERS.iter().map(classify).collect();
    if legacy_enabled {
        out.extend(LEGACY_PROVIDERS.iter().map(classify));
    }
    out
}

/// Probe `PATH` for each active provider's CLI binary so the desktop can render
/// roster availability at startup. Thin filter over [`detect_providers`]:
/// returns only the 3 active providers (legacy never appears here) in the same
/// `ActiveProvider` shape the desktop + TUI consumers depend on.
pub fn list_active_providers() -> Vec<ActiveProvider> {
    detect_providers()
        .into_iter()
        .filter(|p| ACTIVE_PROVIDERS.iter().any(|e| e.id == p.id))
        .map(|p| ActiveProvider {
            id: p.id,
            binary_path: p.binary_path,
            available: p.available,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    #[test]
    fn list_active_providers_returns_three_known_ids() {
        let providers = list_active_providers();
        let ids: Vec<&str> = providers.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, vec!["claude-code-cli", "codex-cli", "opencode-go"]);
    }

    #[test]
    fn list_active_providers_available_reflects_path() {
        // No panic regardless of which binaries exist on the host. When a
        // provider is marked available, its resolved path must actually exist;
        // when not, binary_path falls back to the bare binary name.
        for p in list_active_providers() {
            if p.available {
                assert!(
                    std::path::Path::new(&p.binary_path).exists(),
                    "{} marked available but path {} is missing",
                    p.id,
                    p.binary_path
                );
            } else {
                assert!(!p.binary_path.contains('/'), "{}: {}", p.id, p.binary_path);
            }
        }
    }

    #[test]
    fn is_enabled_default_on_only_zero_disables() {
        assert!(!is_enabled(Some("0")));
        assert!(is_enabled(Some("1")));
        assert!(is_enabled(Some("true")));
        assert!(is_enabled(None));
        assert!(is_enabled(Some("")));
    }

    #[tokio::test]
    async fn inner_dispatch_returns_err_when_flag_unset() {
        let req = DispatchRequest {
            provider_id: "/bin/echo".to_string(),
            workspace: "/tmp".to_string(),
            prompt: "test".to_string(),
            role: "test".to_string(),
            runner_policy: r#"{"preset":"Balanced"}"#.to_string(),
            ..Default::default()
        };
        // Worst case: env is set in the test harness. Unset it first to be safe,
        // but accept that races with parallel tests are minimal here because no
        // other test in this crate sets APOHARA_RUST_DISPATCH.
        std::env::set_var("APOHARA_RUST_DISPATCH", "0");
        let err = rust_dispatch_inner(req).await.unwrap_err();
        assert!(err.contains("explicitly disabled"), "got: {err}");
    }

    #[test]
    fn dispatch_request_roundtrip_serde() {
        let req = DispatchRequest {
            provider_id: "claude".to_string(),
            workspace: "/tmp/ws".to_string(),
            prompt: "hi".to_string(),
            role: "implementer".to_string(),
            runner_policy: "{}".to_string(),
            ..Default::default()
        };
        let json = serde_json::to_string(&req).unwrap();
        let back: DispatchRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(back.provider_id, "claude");
        assert_eq!(back.workspace, "/tmp/ws");
    }

    #[test]
    fn dispatch_outcome_roundtrip_serde() {
        let out = DispatchOutcome {
            success: true,
            output: "ok".to_string(),
            error: None,
            duration_ms: 42,
        };
        let json = serde_json::to_string(&out).unwrap();
        let back: DispatchOutcome = serde_json::from_str(&json).unwrap();
        assert!(back.success);
        assert_eq!(back.duration_ms, 42);
    }

    /// Drop a fake executable named `binary` into `dir` so `find_in_path`
    /// resolves it without requiring a real CLI on the host.
    #[cfg(unix)]
    fn fake_exe(dir: &std::path::Path, binary: &str) {
        use std::os::unix::fs::PermissionsExt;
        let path = dir.join(binary);
        std::fs::write(&path, b"#!/bin/sh\n").unwrap();
        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&path, perms).unwrap();
    }

    #[test]
    fn detect_providers_reports_config_paths_for_active_catalog() {
        // Host-independent: we assert the catalog's config paths regardless of
        // which binaries exist. Every active provider must surface mcp_ready
        // and a non-placeholder config path matching its injection writer.
        let detected = detect_providers();
        let claude = detected
            .iter()
            .find(|p| p.id == "claude-code-cli")
            .expect("claude-code-cli in active catalog");
        assert_eq!(claude.config_path, "<ws>/.claude/mcp.json");
        let opencode = detected
            .iter()
            .find(|p| p.id == "opencode-go")
            .expect("opencode-go in active catalog");
        // Workspace root, not .opencode/settings.json (past-incident).
        assert_eq!(opencode.config_path, "<ws>/opencode.jsonc");
        let codex = detected
            .iter()
            .find(|p| p.id == "codex-cli")
            .expect("codex-cli in active catalog");
        assert_eq!(codex.config_path, "<ws>/.codex/config.toml");
        // At least the 3 active CLIs are catalogued with config paths.
        assert!(detected.len() >= 3);
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn detect_providers_lists_two_plus_clis_with_correct_config_paths() {
        // Controlled PATH with exactly two known binaries present → host
        // independent. Both must resolve to their catalog config paths.
        let tmp = tempfile::TempDir::new().unwrap();
        fake_exe(tmp.path(), "claude");
        fake_exe(tmp.path(), "opencode");
        let prev_path = std::env::var_os("PATH");
        std::env::set_var("PATH", tmp.path());
        std::env::remove_var("APOHARA_LEGACY_PROVIDERS");

        let detected = detect_providers();
        let available: Vec<&DetectedProvider> = detected.iter().filter(|p| p.available).collect();
        assert!(
            available.len() >= 2,
            "expected >=2 detected CLIs, got {available:?}"
        );
        let claude = available.iter().find(|p| p.id == "claude-code-cli").unwrap();
        assert!(claude.mcp_ready);
        assert_eq!(claude.config_path, "<ws>/.claude/mcp.json");
        assert_eq!(claude.status, ProviderStatus::Active);
        let opencode = available.iter().find(|p| p.id == "opencode-go").unwrap();
        assert_eq!(opencode.config_path, "<ws>/opencode.jsonc");

        match prev_path {
            Some(p) => std::env::set_var("PATH", p),
            None => std::env::remove_var("PATH"),
        }
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn detected_legacy_without_adapter_is_excluded_with_reason() {
        // A detected legacy binary with no MCP adapter must be REPORTED as
        // excluded (mcp_ready=false, non-empty reason), never silently dropped
        // and never promoted into the active roster.
        let tmp = tempfile::TempDir::new().unwrap();
        fake_exe(tmp.path(), "gemini");
        let prev_path = std::env::var_os("PATH");
        let prev_legacy = std::env::var_os("APOHARA_LEGACY_PROVIDERS");
        std::env::set_var("PATH", tmp.path());
        std::env::set_var("APOHARA_LEGACY_PROVIDERS", "1");

        let detected = detect_providers();
        let gemini = detected
            .iter()
            .find(|p| p.id == "gemini")
            .expect("gemini probed under APOHARA_LEGACY_PROVIDERS=1");
        assert!(gemini.available, "fake gemini is on the temp PATH");
        assert!(!gemini.mcp_ready);
        assert_eq!(gemini.config_path, "~/.gemini/settings.json");
        match &gemini.status {
            ProviderStatus::ExcludedNoMcpAdapter(reason) => {
                assert!(!reason.is_empty(), "excluded reason must be non-empty");
                assert!(reason.contains("gemini"), "reason names the provider: {reason}");
            }
            other => panic!("expected ExcludedNoMcpAdapter, got {other:?}"),
        }
        // Hard rule: legacy never leaks into the active roster.
        assert!(
            !list_active_providers().iter().any(|p| p.id == "gemini"),
            "legacy provider must not appear in the active roster"
        );

        match prev_path {
            Some(p) => std::env::set_var("PATH", p),
            None => std::env::remove_var("PATH"),
        }
        match prev_legacy {
            Some(v) => std::env::set_var("APOHARA_LEGACY_PROVIDERS", v),
            None => std::env::remove_var("APOHARA_LEGACY_PROVIDERS"),
        }
    }

    #[cfg(unix)]
    #[test]
    #[serial]
    fn legacy_providers_hidden_without_env_flag() {
        // Without APOHARA_LEGACY_PROVIDERS=1 the legacy set is never probed,
        // so detect_providers() yields exactly the 3 active entries.
        let prev_legacy = std::env::var_os("APOHARA_LEGACY_PROVIDERS");
        std::env::remove_var("APOHARA_LEGACY_PROVIDERS");

        let detected = detect_providers();
        assert_eq!(detected.len(), 3);
        assert!(detected.iter().all(|p| ACTIVE_PROVIDERS.iter().any(|e| e.id == p.id)));

        match prev_legacy {
            Some(v) => std::env::set_var("APOHARA_LEGACY_PROVIDERS", v),
            None => std::env::remove_var("APOHARA_LEGACY_PROVIDERS"),
        }
    }

    #[test]
    fn provider_status_serializes_snake_case_with_reason() {
        let excluded = ProviderStatus::ExcludedNoMcpAdapter("no adapter".to_string());
        let json = serde_json::to_value(&excluded).unwrap();
        assert_eq!(json["kind"], "excluded_no_mcp_adapter");
        assert_eq!(json["reason"], "no adapter");
        let active = serde_json::to_value(ProviderStatus::Active).unwrap();
        assert_eq!(active["kind"], "active");
    }
}
