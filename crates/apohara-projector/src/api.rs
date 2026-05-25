//! Direct API surface for the Rust projector path (Sprint 23: ex-`tauri_bridge`).
//!
//! Pure functions callable directly from the Dioxus desktop via
//! `use_future` — no Tauri, no IPC. The gate logic + inner sync projector
//! entry points remain testable from plain `cargo test`.
//!
//! Flag: `APOHARA_RUST_PROJECTOR=1` defaults ON post-G1.D.2 flip. Export =0 to opt out
//! (TS legacy continues to handle projection until Phase 1 cierre flips
//! defaults in G1.D.2).

use crate::transcript_transformer::{
    project_to_search_rows, project_to_ui_cards, EventLog, SearchRow, UiTaskCard,
};

/// Pure gate predicate — testable without env mutation.
pub fn is_enabled(env_value: Option<&str>) -> bool {
    env_value != Some("0")
}

/// Inner UI-cards projector reused by the desktop API surface and the
/// CLI binary (Phase 1 G1.D).
pub fn projector_to_ui_cards_inner(events: Vec<EventLog>) -> Result<Vec<UiTaskCard>, String> {
    let env = std::env::var("APOHARA_RUST_PROJECTOR").ok();
    if !is_enabled(env.as_deref()) {
        return Err(
            "APOHARA_RUST_PROJECTOR explicitly disabled (=0) — TS legacy path active".to_string(),
        );
    }
    Ok(project_to_ui_cards(&events))
}

/// Inner search-rows projector reused by the desktop API surface and the
/// CLI binary (Phase 1 G1.D).
pub fn projector_to_search_rows_inner(events: Vec<EventLog>) -> Result<Vec<SearchRow>, String> {
    let env = std::env::var("APOHARA_RUST_PROJECTOR").ok();
    if !is_enabled(env.as_deref()) {
        return Err(
            "APOHARA_RUST_PROJECTOR explicitly disabled (=0) — TS legacy path active".to_string(),
        );
    }
    Ok(project_to_search_rows(&events))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transcript_transformer::EventSeverity;
    use serde_json::json;

    fn ev(task: Option<&str>) -> EventLog {
        EventLog {
            id: "e1".to_string(),
            timestamp: "2026-05-22T10:00:00Z".to_string(),
            event_type: "task_scheduled".to_string(),
            severity: EventSeverity::Info,
            task_id: task.map(String::from),
            payload: json!({"prompt": "p"}),
            metadata: None,
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

    // Tauri bridge env-gated tests share the process env, so we group them
    // in a single test that sets+unsets the flag inline to avoid races
    // with other tests in this crate (none of which touch the flag today,
    // but cargo runs threaded by default).
    #[test]
    fn bridges_gate_on_env_flag() {
        std::env::set_var("APOHARA_RUST_PROJECTOR", "0");

        let err_ui = projector_to_ui_cards_inner(vec![ev(Some("t1"))]).unwrap_err();
        assert!(err_ui.contains("explicitly disabled"), "got: {err_ui}");

        let err_rows = projector_to_search_rows_inner(vec![ev(Some("t1"))]).unwrap_err();
        assert!(err_rows.contains("explicitly disabled"), "got: {err_rows}");

        std::env::set_var("APOHARA_RUST_PROJECTOR", "1");
        let cards = projector_to_ui_cards_inner(vec![ev(Some("t1"))]).unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].task_id, "t1");

        let rows = projector_to_search_rows_inner(vec![ev(Some("t1"))]).unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].event_id, "e1");

        std::env::remove_var("APOHARA_RUST_PROJECTOR");
    }
}
