//! Tauri command bridge for the Rust verification path.
//!
//! Feature-gated: `--features tauri` enables `#[tauri::command]`
//! registration. Without the feature, the gate logic + inner async
//! evaluator are still testable from plain cargo. This lets
//! `apohara-verification` compile lean in cli/test contexts and only
//! pulls Tauri when the desktop shell wires it.
//!
//! Flag: `APOHARA_RUST_VERIFICATION=1` enables the Rust path. Default
//! OFF (TS legacy continues to handle verification until Phase 1
//! cierre flips defaults in G1.D.2).

use crate::quality_gates::{run_all_gates, GateInput, MultiGateResult};

/// Pure gate predicate — testable without env mutation. Mirrors the
/// apohara-dispatch tauri_bridge::is_enabled pattern verbatim so
/// future readers can match the two by sight.
pub fn is_enabled(env_value: Option<&str>) -> bool {
    env_value != Some("0")
}

/// Inner async evaluator reused by both the Tauri command and the
/// CLI binary (Phase 1 G1.D). Runs every applicable quality gate and
/// returns the aggregated pass/block list.
pub async fn rust_quality_gates_inner(input: GateInput) -> Result<MultiGateResult, String> {
    let env = std::env::var("APOHARA_RUST_VERIFICATION").ok();
    if !is_enabled(env.as_deref()) {
        return Err(
            "APOHARA_RUST_VERIFICATION explicitly disabled (=0) — TS legacy path active".to_string(),
        );
    }
    // run_all_gates is sync today; we keep the wrapper async so the
    // future signature stays stable when callers add I/O (e.g. spec
    // loading) and so Tauri can suspend us on the runtime properly.
    Ok(run_all_gates(&input))
}

#[cfg(feature = "tauri")]
#[tauri::command]
pub async fn quality_gates_evaluate(input: GateInput) -> Result<MultiGateResult, String> {
    rust_quality_gates_inner(input).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::quality_gates::{AgentRole, Persona};

    #[test]
    fn is_enabled_default_on_only_zero_disables() {
        assert!(!is_enabled(Some("0")));
        assert!(is_enabled(Some("1")));
        assert!(is_enabled(Some("true")));
        assert!(is_enabled(None));
        assert!(is_enabled(Some("")));
    }

    // The two env-var tests share APOHARA_RUST_VERIFICATION; serial_test
    // serializes them so cargo's parallel runner doesn't race on the
    // global env. Matches the apohara-dispatch pattern.
    #[tokio::test]
    #[serial_test::serial]
    async fn inner_returns_err_when_flag_zero() {
        std::env::set_var("APOHARA_RUST_VERIFICATION", "0");
        let input = GateInput {
            task_role: AgentRole::Critic,
            persona: Some(Persona::Frontend),
            diff: "x".to_string(),
            output: "y".to_string(),
        };
        let err = rust_quality_gates_inner(input).await.unwrap_err();
        assert!(err.contains("explicitly disabled"), "got: {err}");
    }

    #[tokio::test]
    #[serial_test::serial]
    async fn inner_runs_gates_when_flag_set() {
        std::env::set_var("APOHARA_RUST_VERIFICATION", "1");
        let input = GateInput {
            task_role: AgentRole::Critic,
            persona: None,
            diff: "diff".to_string(),
            output: "nothing here".to_string(),
        };
        let res = rust_quality_gates_inner(input).await.unwrap();
        // code_quality always evaluates → blocks because no findings.
        let names: Vec<_> = res.blocks.iter().map(|b| b.gate.as_str()).collect();
        assert!(names.contains(&"code_quality"), "blocks: {names:?}");
        std::env::remove_var("APOHARA_RUST_VERIFICATION");
    }

    #[test]
    fn gate_input_roundtrip_serde() {
        let inp = GateInput {
            task_role: AgentRole::Critic,
            persona: Some(Persona::Backend),
            diff: "d".to_string(),
            output: "o".to_string(),
        };
        let json = serde_json::to_string(&inp).unwrap();
        let back: GateInput = serde_json::from_str(&json).unwrap();
        assert_eq!(back.persona, Some(Persona::Backend));
        assert_eq!(back.diff, "d");
    }
}
