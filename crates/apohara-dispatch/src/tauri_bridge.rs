//! Tauri command bridge for the Rust dispatch path.
//!
//! Feature-gated: `--features tauri` enables `#[tauri::command]` registration.
//! Without the feature, the gate logic + inner async dispatcher are still
//! testable from plain cargo. This lets `apohara-dispatch` compile lean in
//! cli/test contexts and only pulls Tauri when the desktop shell wires it.
//!
//! Flag: `APOHARA_RUST_DISPATCH=1` defaults ON post-G1.D.2 flip. Export =0 to opt out (TS
//! legacy continues to handle dispatch until Phase 1 cierre flips defaults
//! in G1.D.2).

use crate::cli_driver::{CliDriver, DispatchOutcome, DispatchRequest};

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

#[cfg(feature = "tauri")]
#[tauri::command]
pub async fn rust_dispatch(req: DispatchRequest) -> Result<DispatchOutcome, String> {
    rust_dispatch_inner(req).await
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
