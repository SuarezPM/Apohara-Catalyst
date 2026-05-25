//! Direct API surface for the Rust decomposer path (Sprint 23: ex-`tauri_bridge`).
//!
//! Pure async functions callable directly from the Dioxus desktop via
//! `use_future` — no Tauri, no IPC. The gate logic + inner async commands
//! remain testable from plain cargo.
//!
//! Flag: `APOHARA_RUST_DECOMPOSER=1` defaults ON post-G1.D.2 flip. Export =0 to opt out
//! (TS legacy continues to handle decomposition until Phase 1 cierre
//! flips defaults in G1.D.2).

use crate::manifests::{parse_task_with_manifest, RawTask};
use crate::spec_to_manifest::{decompose_spec, DecomposedManifest};

/// Pure gate predicate — testable without env mutation.
pub fn is_enabled(env_value: Option<&str>) -> bool {
    env_value != Some("0")
}

fn check_enabled() -> Result<(), String> {
    let env = std::env::var("APOHARA_RUST_DECOMPOSER").ok();
    if !is_enabled(env.as_deref()) {
        return Err(
            "APOHARA_RUST_DECOMPOSER explicitly disabled (=0) — TS legacy path active".to_string(),
        );
    }
    Ok(())
}

/// Inner SPEC → manifest decomposer reused by the desktop API surface
/// and the CLI binary (Phase 1 G1.D). Pure / cheap / deterministic.
pub async fn decomposer_run_inner(spec: String) -> Result<DecomposedManifest, String> {
    check_enabled()?;
    Ok(decompose_spec(&spec))
}

/// Inner task-manifest validator reused by the desktop API surface and CLI.
pub async fn decomposer_parse_task_inner(raw: serde_json::Value) -> Result<RawTask, String> {
    check_enabled()?;
    parse_task_with_manifest(&raw).map_err(|e| e.to_string())
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

    #[tokio::test]
    #[serial_test::serial(apohara_rust_decomposer_flag)]
    async fn decomposer_run_errors_when_flag_unset() {
        std::env::set_var("APOHARA_RUST_DECOMPOSER", "0");
        let err = decomposer_run_inner("## Task a: x\n".to_string())
            .await
            .unwrap_err();
        assert!(err.contains("explicitly disabled"), "got: {err}");
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_decomposer_flag)]
    async fn decomposer_run_returns_manifest_when_flag_set() {
        std::env::set_var("APOHARA_RUST_DECOMPOSER", "1");
        let m = decomposer_run_inner("## Task a: x\n## Task b: y\n- depends: a\n".to_string())
            .await
            .unwrap();
        std::env::remove_var("APOHARA_RUST_DECOMPOSER");
        assert_eq!(m.tasks.len(), 2);
        assert_eq!(m.tasks[1].depends_on, vec!["a".to_string()]);
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_decomposer_flag)]
    async fn decomposer_parse_task_errors_when_flag_unset() {
        std::env::set_var("APOHARA_RUST_DECOMPOSER", "0");
        let err = decomposer_parse_task_inner(json!({}))
            .await
            .unwrap_err();
        assert!(err.contains("explicitly disabled"), "got: {err}");
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_decomposer_flag)]
    async fn decomposer_parse_task_validates_when_flag_set() {
        std::env::set_var("APOHARA_RUST_DECOMPOSER", "1");
        let good = json!({
            "id": "t",
            "description": "d",
            "dependsOn": [],
            "agentRole": "coder",
            "symbols": { "reads": [], "writes": [], "renames": [] }
        });
        let parsed = decomposer_parse_task_inner(good).await.unwrap();
        let bad_err = decomposer_parse_task_inner(json!({})).await.unwrap_err();
        std::env::remove_var("APOHARA_RUST_DECOMPOSER");
        assert_eq!(parsed.id, "t");
        assert!(bad_err.contains("id"), "bad_err: {bad_err}");
    }

    #[test]
    fn decomposed_manifest_roundtrip_serde() {
        let m = DecomposedManifest { tasks: vec![] };
        let j = serde_json::to_string(&m).unwrap();
        let back: DecomposedManifest = serde_json::from_str(&j).unwrap();
        assert_eq!(back, m);
    }
}
