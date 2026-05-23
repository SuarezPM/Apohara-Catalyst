//! Quality gates — direct port of `src/core/verification/qualityGates/*.ts`.
//!
//! Each gate decides:
//!   * `applies_to(input)` → should it run on this input at all?
//!   * `evaluate(input)`   → pass, or block with reason + agent feedback?
//!
//! The orchestrator [`run_all_gates`] runs every applicable gate and
//! collects passes / blocks; it never short-circuits because the
//! critic wants the FULL block list (TS parity).
//!
//! Why all gates live in ONE module while the TS source uses one file
//! per gate:
//!
//!   * Each gate body is < 30 LOC and shares the same input/output
//!     types — splitting into 6 files would cost more than it saves.
//!   * Centralizing the regex `OnceLock` cache keeps cold-start
//!     allocation predictable for the bench microbench.
//!
//! The behaviour, regex literals, and feedback strings are
//! byte-for-byte the same as the TS implementation so the two paths
//! produce identical critic output during Phase 1 double-maintenance.

use std::sync::OnceLock;

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};

/// Mirrors TS `AgentRole` union. Currently only used to namespace the
/// gate input; gates branch on `persona` more often than role today.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AgentRole {
    Planner,
    Coder,
    Critic,
    Judge,
    Explorer,
    Editor,
}

/// Mirrors TS `Persona` union. Closed set so a typo in routing won't
/// silently skip every gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Persona {
    Backend,
    Frontend,
    Db,
    Cloud,
    Deployment,
    Auth,
    Crypto,
    Perf,
}

/// Inputs the orchestrator feeds to every gate.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateInput {
    pub task_role: AgentRole,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub persona: Option<Persona>,
    pub diff: String,
    pub output: String,
}

/// Result of a single gate evaluation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum GateResult {
    /// Gate had no issues with the inputs.
    Pass,
    /// Gate vetoed the change; `reason` is operator-facing,
    /// `feedback_to_agent` is fed back to the next agent attempt so
    /// the loop converges.
    #[serde(rename_all = "camelCase")]
    Block {
        reason: String,
        feedback_to_agent: String,
    },
}

/// Trait for the six built-in gates. External callers wanting a
/// custom gate can implement it; the orchestrator accepts any
/// `&dyn QualityGate`.
pub trait QualityGate: Send + Sync {
    fn name(&self) -> &'static str;
    fn applies_to(&self, input: &GateInput) -> bool;
    fn evaluate(&self, input: &GateInput) -> GateResult;
}

/// Aggregated outcome of [`run_all_gates`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiGateResult {
    pub passes: Vec<String>,
    pub blocks: Vec<GateBlock>,
}

/// One blocked-gate entry inside [`MultiGateResult`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateBlock {
    pub gate: String,
    pub reason: String,
    pub feedback_to_agent: String,
}

// =====================================================================
// Regex cache — every regex compiled exactly once across the process.
// =====================================================================

fn re_tradeoff() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        RegexBuilder::new(r"trade-?off")
            .case_insensitive(true)
            .build()
            .unwrap()
    })
}

fn re_alternatives() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        RegexBuilder::new(r"alternatives?\s+considered")
            .case_insensitive(true)
            .build()
            .unwrap()
    })
}

fn re_findings() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        RegexBuilder::new(r"finding|issue|defect")
            .case_insensitive(true)
            .build()
            .unwrap()
    })
}

fn re_severity() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        RegexBuilder::new(r"severity\s*[:=]\s*(low|medium|high|critical)")
            .case_insensitive(true)
            .build()
            .unwrap()
    })
}

fn re_root_cause() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        RegexBuilder::new(r"root\s+cause")
            .case_insensitive(true)
            .build()
            .unwrap()
    })
}

fn re_aria() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        RegexBuilder::new(r"aria-|role\s*=")
            .case_insensitive(true)
            .build()
            .unwrap()
    })
}

fn re_viewport() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        RegexBuilder::new(r"viewport|breakpoint|@media|responsive")
            .case_insensitive(true)
            .build()
            .unwrap()
    })
}

fn re_perf_metric() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    // `\b\d+\s*(ms|MB|req/s|qps|GB|μs)\b` — matches "450ms", "12 MB",
    // "5 req/s", etc. Word-boundary on each side; case-insensitive
    // keeps `MS`/`mb` matches in parity with the TS source.
    R.get_or_init(|| {
        RegexBuilder::new(r"\b\d+\s*(ms|MB|req/s|qps|GB|μs)\b")
            .case_insensitive(true)
            .build()
            .unwrap()
    })
}

fn re_perf_before_after() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    // TS uses `/(before|baseline).*\b(after|now|optimized)\b/is`:
    // case-insensitive + dot-matches-newline. The Rust regex crate
    // expresses the latter via `dot_matches_new_line(true)`.
    R.get_or_init(|| {
        RegexBuilder::new(r"(before|baseline).*\b(after|now|optimized)\b")
            .case_insensitive(true)
            .dot_matches_new_line(true)
            .build()
            .unwrap()
    })
}

fn re_perf_diff_trigger() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        RegexBuilder::new(r"performance|optimiz|latency|throughput")
            .case_insensitive(true)
            .build()
            .unwrap()
    })
}

fn re_security_diff_trigger() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        RegexBuilder::new(r"authentic|authoriz|input validation")
            .case_insensitive(true)
            .build()
            .unwrap()
    })
}

fn re_security_remediation() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    R.get_or_init(|| {
        RegexBuilder::new(r"remediation\s*[:=]|how to fix")
            .case_insensitive(true)
            .build()
            .unwrap()
    })
}

const OWASP: [&str; 10] = [
    "injection",
    "broken authentication",
    "xss",
    "csrf",
    "ssrf",
    "xxe",
    "deserialization",
    "logging",
    "monitoring",
    "access control",
];

fn re_owasp_categories() -> &'static [Regex; 10] {
    static R: OnceLock<[Regex; 10]> = OnceLock::new();
    R.get_or_init(|| {
        OWASP.map(|cat| {
            RegexBuilder::new(&regex::escape(cat))
                .case_insensitive(true)
                .build()
                .unwrap()
        })
    })
}

/// Dangerous shell patterns the sysadmin-safety gate refuses to let
/// past. Order matches the TS source so the FIRST hit wins (and the
/// block message is deterministic for the same diff/output pair).
fn dangerous_patterns() -> &'static [(Regex, &'static str)] {
    static R: OnceLock<Vec<(Regex, &'static str)>> = OnceLock::new();
    R.get_or_init(|| {
        vec![
            (
                // Original TS: /\brm\s+-rf\s+\/(?!\w)/ — anchor `/` then negative
                // lookahead for a word char. Rust regex has no lookahead, so we
                // accept either: end of string, or a non-word char after `/`.
                Regex::new(r"\brm\s+-rf\s+/(?:[^A-Za-z0-9_]|$)").unwrap(),
                "rm -rf / (root deletion)",
            ),
            (
                Regex::new(r"\b(iptables\s+-F|ufw\s+disable|firewall-cmd\s+--set-default-zone\s*=\s*trusted)\b").unwrap(),
                "firewall disable",
            ),
            (
                Regex::new(r"curl[^\n]*\|\s*sudo\s+(?:sh|bash)").unwrap(),
                "curl piped to sudo shell",
            ),
            (
                Regex::new(r"\bchmod\s+777\b").unwrap(),
                "world-writable chmod",
            ),
            (
                Regex::new(r"\bdd\s+if=/dev/(zero|random)\s+of=/dev/sd[a-z]\b").unwrap(),
                "raw disk write",
            ),
        ]
    })
        .as_slice()
}

// =====================================================================
// Gate impls.
// =====================================================================

/// Backend / db / cloud / deployment personas must explain the
/// trade-off + alternatives they evaluated.
pub struct ArchitectureGate;
impl QualityGate for ArchitectureGate {
    fn name(&self) -> &'static str {
        "architecture"
    }
    fn applies_to(&self, input: &GateInput) -> bool {
        matches!(
            input.persona,
            Some(Persona::Backend) | Some(Persona::Db) | Some(Persona::Cloud) | Some(Persona::Deployment)
        )
    }
    fn evaluate(&self, input: &GateInput) -> GateResult {
        let has_tradeoff = re_tradeoff().is_match(&input.output);
        let has_alternatives = re_alternatives().is_match(&input.output);
        if !has_tradeoff || !has_alternatives {
            return GateResult::Block {
                reason: "Architecture output missing 'Trade-off' or 'Alternatives considered' section".to_string(),
                feedback_to_agent: "Add a 'Trade-off' section explaining what you traded away and an 'Alternatives considered' section listing other approaches you evaluated.".to_string(),
            };
        }
        GateResult::Pass
    }
}

/// Always-on gate: every critic report must list ≥ 2 findings, assign
/// severity, and articulate root cause.
pub struct CodeQualityGate;
impl QualityGate for CodeQualityGate {
    fn name(&self) -> &'static str {
        "code_quality"
    }
    fn applies_to(&self, _input: &GateInput) -> bool {
        true
    }
    fn evaluate(&self, input: &GateInput) -> GateResult {
        let finding_count = re_findings().find_iter(&input.output).count();
        let has_severity = re_severity().is_match(&input.output);
        let has_root_cause = re_root_cause().is_match(&input.output);
        if finding_count < 2 || !has_severity || !has_root_cause {
            return GateResult::Block {
                reason: format!(
                    "Code quality requires 2+ findings + severity + root cause (got {finding_count} findings, severity={has_severity}, root_cause={has_root_cause})"
                ),
                feedback_to_agent: "List at least 2 specific findings, assign severity to each, and articulate the root cause (not just symptoms).".to_string(),
            };
        }
        GateResult::Pass
    }
}

/// Frontend persona must mention ARIA attributes + viewport reasoning.
pub struct FrontendGate;
impl QualityGate for FrontendGate {
    fn name(&self) -> &'static str {
        "frontend"
    }
    fn applies_to(&self, input: &GateInput) -> bool {
        input.persona == Some(Persona::Frontend)
    }
    fn evaluate(&self, input: &GateInput) -> GateResult {
        let has_aria = re_aria().is_match(&input.output);
        let has_viewport = re_viewport().is_match(&input.output);
        if !has_aria || !has_viewport {
            return GateResult::Block {
                reason: "Frontend output requires ARIA attribute mentions + viewport/breakpoint reasoning".to_string(),
                feedback_to_agent: "Address accessibility via ARIA attributes/roles, and explain viewport/breakpoint behavior for the UI.".to_string(),
            };
        }
        GateResult::Pass
    }
}

/// Perf persona OR any diff that mentions performance keywords: gate
/// the output for concrete metrics + before/after framing.
pub struct PerfGate;
impl QualityGate for PerfGate {
    fn name(&self) -> &'static str {
        "perf"
    }
    fn applies_to(&self, input: &GateInput) -> bool {
        input.persona == Some(Persona::Perf) || re_perf_diff_trigger().is_match(&input.diff)
    }
    fn evaluate(&self, input: &GateInput) -> GateResult {
        let has_metric = re_perf_metric().is_match(&input.output);
        let has_before_after = re_perf_before_after().is_match(&input.output);
        if !has_metric || !has_before_after {
            return GateResult::Block {
                reason: "Perf output requires concrete metrics (ms/MB/req/s) + before/after comparison".to_string(),
                feedback_to_agent: "Include measured numbers (e.g. '450ms → 120ms', '50MB → 12MB') with explicit before/after framing.".to_string(),
            };
        }
        GateResult::Pass
    }
}

/// Auth / crypto persona OR diff that mentions security keywords:
/// require ≥ 2 OWASP category mentions + severity + remediation.
pub struct SecurityGate;
impl QualityGate for SecurityGate {
    fn name(&self) -> &'static str {
        "security"
    }
    fn applies_to(&self, input: &GateInput) -> bool {
        matches!(input.persona, Some(Persona::Auth) | Some(Persona::Crypto))
            || re_security_diff_trigger().is_match(&input.diff)
    }
    fn evaluate(&self, input: &GateInput) -> GateResult {
        let categories_hit: usize = re_owasp_categories()
            .iter()
            .filter(|re| re.is_match(&input.output))
            .count();
        let has_severity = re_severity().is_match(&input.output);
        let has_remediation = re_security_remediation().is_match(&input.output);
        if categories_hit < 2 || !has_severity || !has_remediation {
            return GateResult::Block {
                reason: format!(
                    "Security output requires 2+ OWASP categories + severity + remediation (got {categories_hit} categories, severity={has_severity}, remediation={has_remediation})"
                ),
                feedback_to_agent: "Reference at least 2 OWASP categories explicitly, assign a severity (low/medium/high/critical), and provide remediation steps per finding.".to_string(),
            };
        }
        GateResult::Pass
    }
}

/// Always-on gate that blocks five dangerous shell patterns in the
/// diff OR the output. First hit wins (matches TS short-circuit).
pub struct SysadminSafetyGate;
impl QualityGate for SysadminSafetyGate {
    fn name(&self) -> &'static str {
        "sysadmin_safety"
    }
    fn applies_to(&self, _input: &GateInput) -> bool {
        true
    }
    fn evaluate(&self, input: &GateInput) -> GateResult {
        for (re, reason) in dangerous_patterns() {
            if re.is_match(&input.diff) || re.is_match(&input.output) {
                return GateResult::Block {
                    reason: format!("Detected dangerous pattern: {reason}"),
                    feedback_to_agent: format!(
                        "The change includes '{reason}'. Confirm necessity, scope it narrowly (path, network, etc.), and explain rollback. Do NOT proceed silently."
                    ),
                };
            }
        }
        GateResult::Pass
    }
}

// =====================================================================
// Orchestrator.
// =====================================================================

/// The full set of built-in gates, in the same order as the TS
/// `GATES` array — order matters for the deterministic block list.
pub fn default_gates() -> Vec<Box<dyn QualityGate>> {
    vec![
        Box::new(ArchitectureGate),
        Box::new(SecurityGate),
        Box::new(PerfGate),
        Box::new(CodeQualityGate),
        Box::new(FrontendGate),
        Box::new(SysadminSafetyGate),
    ]
}

/// Run every applicable gate against `input` and aggregate the
/// pass/block lists. Never short-circuits — the critic needs the FULL
/// block list to feed back to the agent (TS parity).
pub fn run_all_gates(input: &GateInput) -> MultiGateResult {
    let gates = default_gates();
    run_gates(input, gates.iter().map(|g| g.as_ref()))
}

/// Lower-level orchestrator that accepts a custom gate iterator.
/// Useful for tests that want to evaluate a single gate in isolation
/// without rebuilding the default set.
pub fn run_gates<'a, I>(input: &GateInput, gates: I) -> MultiGateResult
where
    I: IntoIterator<Item = &'a dyn QualityGate>,
{
    let mut passes: Vec<String> = Vec::new();
    let mut blocks: Vec<GateBlock> = Vec::new();
    for gate in gates {
        if !gate.applies_to(input) {
            continue;
        }
        match gate.evaluate(input) {
            GateResult::Pass => passes.push(gate.name().to_string()),
            GateResult::Block {
                reason,
                feedback_to_agent,
            } => blocks.push(GateBlock {
                gate: gate.name().to_string(),
                reason,
                feedback_to_agent,
            }),
        }
    }
    MultiGateResult { passes, blocks }
}
