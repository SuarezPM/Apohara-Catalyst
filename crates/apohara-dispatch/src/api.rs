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

/// (roster id, CLI binary name) for the 3 active providers. Others are LEGACY
/// behind `APOHARA_LEGACY_PROVIDERS=1` and intentionally excluded here.
const ACTIVE_PROVIDERS: [(&str, &str); 3] = [
    ("claude-code-cli", "claude"),
    ("codex-cli", "codex"),
    ("opencode-go", "opencode"),
];

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

/// Probe `PATH` for each active provider's CLI binary so the desktop can render
/// roster availability at startup. `binary_path` is the resolved path when
/// found, else the bare binary name (so the UI can show what it searched for).
pub fn list_active_providers() -> Vec<ActiveProvider> {
    ACTIVE_PROVIDERS
        .iter()
        .map(|(id, binary)| match find_in_path(binary) {
            Some(path) => ActiveProvider {
                id: (*id).to_string(),
                binary_path: path,
                available: true,
            },
            None => ActiveProvider {
                id: (*id).to_string(),
                binary_path: (*binary).to_string(),
                available: false,
            },
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
