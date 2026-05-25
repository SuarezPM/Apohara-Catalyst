//! Direct API surface for the Rust spec path (Sprint 23: ex-`tauri_bridge`).
//!
//! Pure async functions callable directly from the Dioxus desktop via
//! `use_future` — no Tauri, no IPC. The gate logic + inner async commands
//! remain testable from plain cargo.
//!
//! Flag: `APOHARA_RUST_SPEC=1` defaults ON post-G1.D.2 flip. Export =0 to opt out (TS
//! legacy continues to handle spec parsing until Phase 1 cierre flips
//! defaults in G1.D.2).

use std::path::PathBuf;
use std::sync::Arc;

use crate::plan_documents::PlanDocument;
use crate::plan_status_cache::{CacheError, PlanStatusCache};

/// Pure gate predicate — testable without env mutation.
pub fn is_enabled(env_value: Option<&str>) -> bool {
    env_value != Some("0")
}

fn check_enabled() -> Result<(), String> {
    let env = std::env::var("APOHARA_RUST_SPEC").ok();
    if !is_enabled(env.as_deref()) {
        return Err("APOHARA_RUST_SPEC explicitly disabled (=0) — TS legacy path active".to_string());
    }
    Ok(())
}

/// Inner async loader reused by the desktop API surface and the CLI
/// binary (Phase 1 G1.D). Parses a plan document from disk.
pub async fn spec_load_plan_inner(filepath: String) -> Result<PlanDocument, String> {
    check_enabled()?;
    crate::plan_documents::parse_plan_document(PathBuf::from(&filepath).as_path())
        .await
        .map_err(|e| e.to_string())
}

/// Status snapshot for a plan, returned to the desktop UI. The shape
/// mirrors what the TS `getPlanStatus` IPC handler returned so the
/// frontend has no migration work during Phase 1 double maintenance.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanStatusSnapshot {
    pub plan_id: String,
    pub title: String,
    pub status: crate::plan_documents::PlanStatus,
    pub progress: Option<f64>,
    pub acceptance_total: usize,
    pub acceptance_done: usize,
}

/// Inner async getter. Uses an injected cache so the desktop shell can
/// share one cache across calls instead of reparsing every time.
pub async fn spec_get_plan_status_inner(
    cache: Arc<PlanStatusCache>,
    filepath: String,
) -> Result<PlanStatusSnapshot, String> {
    check_enabled()?;
    let path = PathBuf::from(&filepath);
    let plan: PlanDocument = tokio::task::spawn_blocking(move || cache.get_fast(&path))
        .await
        .map_err(|e| format!("join error: {e}"))?
        .map_err(|e: CacheError| e.to_string())?;
    Ok(PlanStatusSnapshot {
        acceptance_total: plan.acceptance_criteria.len(),
        acceptance_done: plan.acceptance_criteria.iter().filter(|i| i.checked).count(),
        plan_id: plan.plan_id,
        title: plan.title,
        status: plan.status,
        progress: plan.progress,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    const PLAN: &str = "---\ntitle: Bridge Plan\nstatus: active\nprogress: 0.5\n---\n## Objective\nx\n## Acceptance Criteria\n- [x] one\n- [ ] two\n";

    #[test]
    fn is_enabled_default_on_only_zero_disables() {
        assert!(!is_enabled(Some("0")));
        assert!(is_enabled(Some("1")));
        assert!(is_enabled(Some("true")));
        assert!(is_enabled(None));
        assert!(is_enabled(Some("")));
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_spec_flag)]
    async fn spec_load_plan_errors_when_flag_unset() {
        std::env::set_var("APOHARA_RUST_SPEC", "0");
        let err = spec_load_plan_inner("/nonexistent".to_string()).await.unwrap_err();
        assert!(err.contains("explicitly disabled"), "got: {err}");
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_spec_flag)]
    async fn spec_get_plan_status_errors_when_flag_zero() {
        std::env::set_var("APOHARA_RUST_SPEC", "0");
        let cache = Arc::new(PlanStatusCache::new());
        let err = spec_get_plan_status_inner(cache, "/nonexistent".to_string())
            .await
            .unwrap_err();
        assert!(err.contains("explicitly disabled"), "got: {err}");
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_spec_flag)]
    async fn spec_load_plan_returns_plan_when_flag_set() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("plan.md");
        std::fs::write(&p, PLAN).unwrap();
        std::env::set_var("APOHARA_RUST_SPEC", "1");
        let plan = spec_load_plan_inner(p.display().to_string()).await.unwrap();
        std::env::remove_var("APOHARA_RUST_SPEC");
        assert_eq!(plan.title, "Bridge Plan");
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_spec_flag)]
    async fn spec_get_plan_status_returns_snapshot() {
        let tmp = TempDir::new().unwrap();
        let p = tmp.path().join("plan.md");
        std::fs::write(&p, PLAN).unwrap();
        std::env::set_var("APOHARA_RUST_SPEC", "1");
        let cache = Arc::new(PlanStatusCache::new());
        let snap = spec_get_plan_status_inner(cache, p.display().to_string())
            .await
            .unwrap();
        std::env::remove_var("APOHARA_RUST_SPEC");
        assert_eq!(snap.title, "Bridge Plan");
        assert_eq!(snap.acceptance_total, 2);
        assert_eq!(snap.acceptance_done, 1);
        assert_eq!(snap.progress, Some(0.5));
    }

    #[test]
    fn plan_status_snapshot_roundtrip_serde() {
        let snap = PlanStatusSnapshot {
            plan_id: "abc".to_string(),
            title: "t".to_string(),
            status: crate::plan_documents::PlanStatus::Active,
            progress: Some(0.25),
            acceptance_total: 4,
            acceptance_done: 1,
        };
        let json = serde_json::to_string(&snap).unwrap();
        // camelCase keys for wire compat with the TS frontend.
        assert!(json.contains("\"planId\""));
        assert!(json.contains("\"acceptanceTotal\""));
        assert!(json.contains("\"acceptanceDone\""));
        let back: PlanStatusSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(back.acceptance_total, 4);
    }
}
