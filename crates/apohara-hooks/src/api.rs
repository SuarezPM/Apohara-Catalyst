//! Direct API surface for the Rust hooks path (Sprint 23: ex-`tauri_bridge`).
//!
//! Pure functions callable directly from the Dioxus desktop via
//! `use_future` — no Tauri, no IPC. The gate logic + inner functions
//! remain testable from plain cargo.
//!
//! Flag: `APOHARA_RUST_HOOKS=1` defaults ON post-G1.D.2 flip. Export =0 to opt out
//! (TS legacy continues to install hooks + dispatch events until Phase 1
//! cierre flips defaults in G1.D.2).

use crate::events::{parse_hook_event, HookEvent};
use crate::installer::{install_hook, InstallResult};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Pure gate predicate — testable without env mutation.
pub fn is_enabled(env_value: Option<&str>) -> bool {
    env_value != Some("0")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstallForProviderRequest {
    /// Provider identifier (e.g. `claude-code-cli`). Carried for audit
    /// logging — the bridge does not consult it directly because the
    /// caller already resolved the on-disk script path.
    #[serde(rename = "providerId")]
    pub provider_id: String,
    /// Absolute path the hook script should land at.
    #[serde(rename = "targetPath")]
    pub target_path: PathBuf,
    /// Raw script bytes (UTF-8).
    #[serde(rename = "scriptContent")]
    pub script_content: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DispatchEventRequest {
    /// Raw envelope as broadcast by the hooks-server. Parsed via
    /// [`parse_hook_event`] before being returned — the inner function
    /// performs validation on the bridge boundary so the UI can render a
    /// structured error instead of crashing on malformed JSON.
    pub envelope: serde_json::Value,
}

/// Inner installer entry point, reused by the desktop API surface and any
/// future CLI binary (Phase 1 G1.D).
pub fn hooks_install_for_provider_inner(
    req: InstallForProviderRequest,
) -> Result<InstallResult, String> {
    let env = std::env::var("APOHARA_RUST_HOOKS").ok();
    if !is_enabled(env.as_deref()) {
        return Err("APOHARA_RUST_HOOKS explicitly disabled (=0) — TS legacy path active".to_string());
    }
    install_hook(&req.target_path, &req.script_content).map_err(|e| e.to_string())
}

/// Inner dispatcher — parses the wire envelope and returns the typed
/// [`HookEvent`] for the caller to route. The dispatcher itself is
/// stateless: hookups to compact-reinjection / learnings-dump /
/// context-warnings live on the UI bridge side, since each instance is
/// owned by a specific session orchestrator.
pub fn hooks_dispatch_event_inner(req: DispatchEventRequest) -> Result<HookEvent, String> {
    let env = std::env::var("APOHARA_RUST_HOOKS").ok();
    if !is_enabled(env.as_deref()) {
        return Err("APOHARA_RUST_HOOKS explicitly disabled (=0) — TS legacy path active".to_string());
    }
    parse_hook_event(&req.envelope).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn is_enabled_default_on_only_zero_disables() {
        assert!(!is_enabled(Some("0")));
        assert!(is_enabled(Some("1")));
        assert!(is_enabled(Some("true")));
        assert!(is_enabled(None));
        assert!(is_enabled(Some("")));
    }

    #[test]
    fn install_returns_err_when_flag_zero() {
        std::env::set_var("APOHARA_RUST_HOOKS", "0");
        let req = InstallForProviderRequest {
            provider_id: "claude-code-cli".into(),
            target_path: PathBuf::from("/tmp/should-not-exist-apohara-hooks-bridge"),
            script_content: "#!/bin/sh\n".into(),
        };
        let err = hooks_install_for_provider_inner(req).unwrap_err();
        assert!(err.contains("explicitly disabled"), "got: {err}");
    }

    #[test]
    fn dispatch_returns_err_when_flag_zero() {
        std::env::set_var("APOHARA_RUST_HOOKS", "0");
        let req = DispatchEventRequest {
            envelope: json!({ "type": "stop", "pane_key": "p", "payload": {"reason":"completed","timestamp":1} }),
        };
        let err = hooks_dispatch_event_inner(req).unwrap_err();
        assert!(err.contains("explicitly disabled"));
    }

    #[test]
    fn install_request_roundtrips_serde() {
        let req = InstallForProviderRequest {
            provider_id: "claude".into(),
            target_path: PathBuf::from("/tmp/hook.sh"),
            script_content: "x".into(),
        };
        let s = serde_json::to_string(&req).unwrap();
        let back: InstallForProviderRequest = serde_json::from_str(&s).unwrap();
        assert_eq!(back.provider_id, "claude");
        assert_eq!(back.target_path, PathBuf::from("/tmp/hook.sh"));
    }

    #[test]
    fn dispatch_request_roundtrips_serde() {
        let req = DispatchEventRequest {
            envelope: json!({ "type": "user_prompt_submit", "pane_key": "p", "payload": {"prompt":"hi","timestamp":1}}),
        };
        let s = serde_json::to_string(&req).unwrap();
        let back: DispatchEventRequest = serde_json::from_str(&s).unwrap();
        assert_eq!(back.envelope, req.envelope);
    }
}
