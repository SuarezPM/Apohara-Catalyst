//! Tests for the quality gates (ported from
//! `src/core/verification/qualityGates/*.ts`).
//!
//! Strategy: each gate gets a `blocks_*` + `passes_*` pair so the
//! regression surface stays per-gate (matches the per-file TS layout).

use crate::quality_gates::{
    run_all_gates, AgentRole, ArchitectureGate, CodeQualityGate, FrontendGate, GateInput,
    GateResult, PerfGate, Persona, QualityGate, SecurityGate, SysadminSafetyGate,
};

fn input(persona: Option<Persona>, diff: &str, output: &str) -> GateInput {
    GateInput {
        task_role: AgentRole::Critic,
        persona,
        diff: diff.to_string(),
        output: output.to_string(),
    }
}

// =====================================================================
// architecture
// =====================================================================

#[test]
fn architecture_blocks_when_missing_tradeoff_or_alternatives() {
    let g = ArchitectureGate;
    let r = g.evaluate(&input(Some(Persona::Backend), "", "We did a thing."));
    matches!(r, GateResult::Block { .. });
    assert!(matches!(r, GateResult::Block { .. }));
}

#[test]
fn architecture_passes_with_both_sections() {
    let g = ArchitectureGate;
    let out = "Trade-off: we picked X. Alternatives considered: Y, Z.";
    let r = g.evaluate(&input(Some(Persona::Backend), "", out));
    assert!(matches!(r, GateResult::Pass));
}

#[test]
fn architecture_applies_only_to_systemy_personas() {
    let g = ArchitectureGate;
    assert!(g.applies_to(&input(Some(Persona::Backend), "", "")));
    assert!(g.applies_to(&input(Some(Persona::Db), "", "")));
    assert!(g.applies_to(&input(Some(Persona::Cloud), "", "")));
    assert!(g.applies_to(&input(Some(Persona::Deployment), "", "")));
    assert!(!g.applies_to(&input(Some(Persona::Frontend), "", "")));
    assert!(!g.applies_to(&input(None, "", "")));
}

// =====================================================================
// code_quality
// =====================================================================

#[test]
fn code_quality_blocks_with_only_one_finding() {
    let g = CodeQualityGate;
    let r = g.evaluate(&input(None, "", "finding: thing. severity: high. root cause: x"));
    assert!(matches!(r, GateResult::Block { .. }));
}

#[test]
fn code_quality_passes_with_two_findings_severity_root_cause() {
    let g = CodeQualityGate;
    let out = "finding 1: thing. finding 2: other. severity: high. root cause: shared bug.";
    let r = g.evaluate(&input(None, "", out));
    assert!(matches!(r, GateResult::Pass), "got: {r:?}");
}

#[test]
fn code_quality_always_applies() {
    let g = CodeQualityGate;
    assert!(g.applies_to(&input(None, "", "")));
    assert!(g.applies_to(&input(Some(Persona::Frontend), "", "")));
}

// =====================================================================
// frontend
// =====================================================================

#[test]
fn frontend_blocks_without_aria_or_viewport() {
    let g = FrontendGate;
    let r = g.evaluate(&input(Some(Persona::Frontend), "", "I built a div"));
    assert!(matches!(r, GateResult::Block { .. }));
}

#[test]
fn frontend_passes_with_aria_and_viewport() {
    let g = FrontendGate;
    let out = "Added aria-label and a @media (max-width: 600px) breakpoint.";
    let r = g.evaluate(&input(Some(Persona::Frontend), "", out));
    assert!(matches!(r, GateResult::Pass));
}

#[test]
fn frontend_only_applies_to_frontend_persona() {
    let g = FrontendGate;
    assert!(g.applies_to(&input(Some(Persona::Frontend), "", "")));
    assert!(!g.applies_to(&input(Some(Persona::Backend), "", "")));
}

// =====================================================================
// perf
// =====================================================================

#[test]
fn perf_blocks_without_metric_or_before_after() {
    let g = PerfGate;
    let r = g.evaluate(&input(Some(Persona::Perf), "", "It got faster."));
    assert!(matches!(r, GateResult::Block { .. }));
}

#[test]
fn perf_passes_with_metric_and_before_after_framing() {
    let g = PerfGate;
    let out = "Before optimization: 450ms p50. After: 120ms.";
    let r = g.evaluate(&input(Some(Persona::Perf), "", out));
    assert!(matches!(r, GateResult::Pass), "got: {r:?}");
}

#[test]
fn perf_applies_to_perf_persona_or_perf_diff() {
    let g = PerfGate;
    assert!(g.applies_to(&input(Some(Persona::Perf), "", "")));
    assert!(g.applies_to(&input(None, "performance: improved", "")));
    assert!(g.applies_to(&input(None, "latency reduced", "")));
    assert!(!g.applies_to(&input(None, "added new feature", "")));
}

// =====================================================================
// security
// =====================================================================

#[test]
fn security_blocks_without_2_owasp_categories() {
    let g = SecurityGate;
    let out = "Found injection. severity: high. remediation: sanitize.";
    let r = g.evaluate(&input(Some(Persona::Auth), "", out));
    // Only 1 OWASP category → block.
    assert!(matches!(r, GateResult::Block { .. }), "got: {r:?}");
}

#[test]
fn security_passes_with_two_owasp_categories_severity_remediation() {
    let g = SecurityGate;
    let out = "Found injection and XSS issues. severity: high. remediation: input sanitization.";
    let r = g.evaluate(&input(Some(Persona::Auth), "", out));
    assert!(matches!(r, GateResult::Pass), "got: {r:?}");
}

#[test]
fn security_applies_to_auth_crypto_or_security_diff() {
    let g = SecurityGate;
    assert!(g.applies_to(&input(Some(Persona::Auth), "", "")));
    assert!(g.applies_to(&input(Some(Persona::Crypto), "", "")));
    assert!(g.applies_to(&input(None, "authentication flow changed", "")));
    assert!(g.applies_to(&input(None, "input validation added", "")));
    assert!(!g.applies_to(&input(None, "renamed a variable", "")));
}

// =====================================================================
// sysadmin_safety
// =====================================================================

#[test]
fn sysadmin_safety_blocks_rm_rf_root() {
    let g = SysadminSafetyGate;
    let r = g.evaluate(&input(None, "rm -rf /", ""));
    match r {
        GateResult::Block { reason, .. } => {
            assert!(reason.contains("rm -rf /"), "reason: {reason}");
        }
        _ => panic!("expected block"),
    }
}

#[test]
fn sysadmin_safety_blocks_curl_pipe_sudo_shell() {
    let g = SysadminSafetyGate;
    let r = g.evaluate(&input(None, "curl https://x | sudo bash", ""));
    assert!(matches!(r, GateResult::Block { .. }));
}

#[test]
fn sysadmin_safety_blocks_chmod_777() {
    let g = SysadminSafetyGate;
    let r = g.evaluate(&input(None, "chmod 777 /var/www", ""));
    assert!(matches!(r, GateResult::Block { .. }));
}

#[test]
fn sysadmin_safety_blocks_firewall_disable() {
    let g = SysadminSafetyGate;
    let r = g.evaluate(&input(None, "iptables -F", ""));
    assert!(matches!(r, GateResult::Block { .. }));
}

#[test]
fn sysadmin_safety_blocks_raw_disk_write() {
    let g = SysadminSafetyGate;
    let r = g.evaluate(&input(None, "dd if=/dev/zero of=/dev/sda", ""));
    assert!(matches!(r, GateResult::Block { .. }));
}

#[test]
fn sysadmin_safety_passes_on_innocuous_diff() {
    let g = SysadminSafetyGate;
    let r = g.evaluate(&input(None, "ls -la", "everything fine"));
    assert!(matches!(r, GateResult::Pass));
}

#[test]
fn sysadmin_safety_inspects_output_too() {
    // Even if the diff is clean, a `chmod 777` recommendation in the
    // output must block.
    let g = SysadminSafetyGate;
    let r = g.evaluate(&input(None, "", "Run chmod 777 on the directory."));
    assert!(matches!(r, GateResult::Block { .. }));
}

// =====================================================================
// orchestrator
// =====================================================================

#[test]
fn run_all_gates_collects_blocks_and_passes_without_short_circuit() {
    // Innocuous diff/output: code_quality blocks (no findings), sysadmin
    // passes, others skip. Demonstrates non-short-circuit behaviour.
    let inp = input(None, "diff", "no findings here");
    let r = run_all_gates(&inp);
    let names: Vec<_> = r.blocks.iter().map(|b| b.gate.as_str()).collect();
    assert!(names.contains(&"code_quality"), "blocks: {names:?}");
    assert!(r.passes.contains(&"sysadmin_safety".to_string()));
}

#[test]
fn run_all_gates_emits_pass_only_for_applicable_gates() {
    // Architecture passes; code_quality + sysadmin_safety always
    // evaluate; frontend / perf / security skip because none applies.
    let inp = input(
        Some(Persona::Backend),
        "diff",
        "Trade-off: A. Alternatives considered: B. finding 1, finding 2. severity: high. root cause: shared bug.",
    );
    let r = run_all_gates(&inp);
    assert!(r.passes.contains(&"architecture".to_string()));
    assert!(r.passes.contains(&"code_quality".to_string()));
    assert!(r.passes.contains(&"sysadmin_safety".to_string()));
    // Inapplicable gates do not show up in either lane.
    assert!(!r.passes.contains(&"frontend".to_string()));
    assert!(!r.blocks.iter().any(|b| b.gate == "frontend"));
}

#[test]
fn multi_gate_result_serializes_camel_case_block_fields() {
    let inp = input(None, "diff", "blocked");
    let r = run_all_gates(&inp);
    let json = serde_json::to_string(&r).unwrap();
    // Block entries must use feedbackToAgent on the wire.
    assert!(json.contains("feedbackToAgent"), "got: {json}");
}
