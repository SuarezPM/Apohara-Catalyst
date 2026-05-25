//! Direct API surface for the Rust safety path (Sprint 23: ex-`tauri_bridge`).
//!
//! Pure functions callable directly from the Dioxus desktop via
//! `use_future` — no Tauri, no IPC. The gate logic + inner functions
//! remain testable from plain cargo.
//!
//! Flag: `APOHARA_RUST_SAFETY=1` defaults ON post-G1.D.2 flip. Export =0 to opt out
//! (TS legacy continues to handle permissions until Phase 1 cierre flips
//! defaults in G1.D.2).

use crate::bash_compound::{is_compound, split_compound};
use crate::patterns::{match_pattern, parse_pattern_string, ToolInvocation};
use crate::permission_cache::PermissionCache;
use crate::permission_service::{check, PermissionDecision, PermissionServiceOpts};
use crate::settings_hierarchy::MergedSettings;
use serde::{Deserialize, Serialize};

/// Pure gate predicate — testable without env mutation.
pub fn is_enabled(env_value: Option<&str>) -> bool {
    env_value != Some("0")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CheckPermissionRequest {
    pub session_id: String,
    pub inv: ToolInvocation,
    pub settings: MergedSettings,
    /// Cached session-scope patterns (serialized form). The cache is
    /// reconstructed for every call to keep the bridge stateless.
    pub cached_patterns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BashCompoundAnalysis {
    pub is_compound: bool,
    pub legs: Vec<String>,
}

/// Inner sync check, reused by the desktop API surface + the CLI binary
/// (Phase 1 G1.D).
pub fn safety_check_permission_inner(
    req: CheckPermissionRequest,
) -> Result<PermissionDecision, String> {
    let env = std::env::var("APOHARA_RUST_SAFETY").ok();
    if !is_enabled(env.as_deref()) {
        return Err(
            "APOHARA_RUST_SAFETY explicitly disabled (=0) — TS legacy path active".to_string(),
        );
    }
    // Validate every cached pattern parses before populating the cache
    // so a corrupted on-disk session entry doesn't silently degrade the
    // decision (parity with TS pattern_validator gate at the boundary).
    let mut cache = PermissionCache::new();
    for p in &req.cached_patterns {
        if parse_pattern_string(p).is_some() {
            cache.add(&req.session_id, p);
        }
    }
    let decision = check(
        &req.session_id,
        &req.inv,
        PermissionServiceOpts {
            cache: &cache,
            settings: &req.settings,
        },
    );
    Ok(decision)
}

/// Pure compound-analysis entrypoint — no env gate (read-only,
/// always safe to call so the UI can preview).
pub fn safety_analyze_bash_compound_inner(command: String) -> BashCompoundAnalysis {
    BashCompoundAnalysis {
        is_compound: is_compound(&command),
        legs: split_compound(&command),
    }
}

/// Pure pattern-match preview — used by UI to render the "this pattern
/// would cover N pending tool calls" hint without rerunning the full
/// permission service. No env gate.
pub fn safety_match_pattern_inner(pattern: String, inv: ToolInvocation) -> bool {
    match parse_pattern_string(&pattern) {
        Some(p) => match_pattern(&p, &inv),
        None => false,
    }
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
    fn check_returns_err_when_flag_zero() {
        std::env::set_var("APOHARA_RUST_SAFETY", "0");
        let req = CheckPermissionRequest {
            session_id: "s".to_string(),
            inv: ToolInvocation::new("Read"),
            settings: MergedSettings::default(),
            cached_patterns: vec![],
        };
        let err = safety_check_permission_inner(req).unwrap_err();
        assert!(err.contains("explicitly disabled"));
    }

    #[test]
    fn analyze_bash_compound_works_without_env_gate() {
        let res = safety_analyze_bash_compound_inner("ls && rm".to_string());
        assert!(res.is_compound);
        assert_eq!(res.legs, vec!["ls", "rm"]);
    }

    #[test]
    fn match_pattern_inner_handles_bad_pattern() {
        assert!(!safety_match_pattern_inner(
            "not a pattern".to_string(),
            ToolInvocation::new("Read")
        ));
    }

    #[test]
    fn match_pattern_inner_positive_case() {
        let inv = ToolInvocation::new("Bash").with_input("command", json!("npm test --silent"));
        assert!(safety_match_pattern_inner(
            "Bash(npm test:*)".to_string(),
            inv
        ));
    }

    #[test]
    fn request_roundtrips_serde() {
        let req = CheckPermissionRequest {
            session_id: "s".to_string(),
            inv: ToolInvocation::new("Bash").with_input("command", json!("ls")),
            settings: MergedSettings::default(),
            cached_patterns: vec!["Bash(npm test:*)".to_string()],
        };
        let json_s = serde_json::to_string(&req).unwrap();
        let back: CheckPermissionRequest = serde_json::from_str(&json_s).unwrap();
        assert_eq!(back.session_id, "s");
    }
}
