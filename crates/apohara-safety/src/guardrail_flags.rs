//! Self-describing guardrail flags — ports `src/core/safety/guardrail-flags.ts`
//! (symphony #14 / G5.G.8).
//!
//! Each flag carries the metadata UI / audit / telemetry surfaces consume:
//! stable code, human description, severity, suggested action. Single
//! source of truth so consumers cannot drift.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum GuardrailSeverity {
    Info,
    Warning,
    Error,
    Critical,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum GuardrailFlagCode {
    PromptInjectionDetected,
    RateLimitExceeded,
    BudgetExceeded,
    HallucinationFlag,
    PathEscapeAttempt,
    ToolAutoApprovalDenied,
    SandboxEscapeAttempt,
    AcceptanceCriteriaNotMet,
}

impl GuardrailFlagCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::PromptInjectionDetected => "PROMPT_INJECTION_DETECTED",
            Self::RateLimitExceeded => "RATE_LIMIT_EXCEEDED",
            Self::BudgetExceeded => "BUDGET_EXCEEDED",
            Self::HallucinationFlag => "HALLUCINATION_FLAG",
            Self::PathEscapeAttempt => "PATH_ESCAPE_ATTEMPT",
            Self::ToolAutoApprovalDenied => "TOOL_AUTO_APPROVAL_DENIED",
            Self::SandboxEscapeAttempt => "SANDBOX_ESCAPE_ATTEMPT",
            Self::AcceptanceCriteriaNotMet => "ACCEPTANCE_CRITERIA_NOT_MET",
        }
    }

    pub fn from_str(s: &str) -> Option<Self> {
        Some(match s {
            "PROMPT_INJECTION_DETECTED" => Self::PromptInjectionDetected,
            "RATE_LIMIT_EXCEEDED" => Self::RateLimitExceeded,
            "BUDGET_EXCEEDED" => Self::BudgetExceeded,
            "HALLUCINATION_FLAG" => Self::HallucinationFlag,
            "PATH_ESCAPE_ATTEMPT" => Self::PathEscapeAttempt,
            "TOOL_AUTO_APPROVAL_DENIED" => Self::ToolAutoApprovalDenied,
            "SANDBOX_ESCAPE_ATTEMPT" => Self::SandboxEscapeAttempt,
            "ACCEPTANCE_CRITERIA_NOT_MET" => Self::AcceptanceCriteriaNotMet,
            _ => return None,
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GuardrailFlag {
    pub code: GuardrailFlagCode,
    pub severity: GuardrailSeverity,
    pub description: &'static str,
    pub suggested_action: &'static str,
}

const FLAGS: &[GuardrailFlag] = &[
    GuardrailFlag {
        code: GuardrailFlagCode::PromptInjectionDetected,
        severity: GuardrailSeverity::Critical,
        description:
            "Hostile instructions were detected inside untrusted content (file/URL) the agent was reading.",
        suggested_action:
            "Abort the current task, review the input source, and re-run with the untrusted content quoted.",
    },
    GuardrailFlag {
        code: GuardrailFlagCode::RateLimitExceeded,
        severity: GuardrailSeverity::Warning,
        description:
            "The provider responded with HTTP 429 / quota error; further calls in this window will fail.",
        suggested_action:
            "Back off and retry after the cooldown indicated by the provider's Retry-After header.",
    },
    GuardrailFlag {
        code: GuardrailFlagCode::BudgetExceeded,
        severity: GuardrailSeverity::Error,
        description:
            "The task's token / cost budget was exhausted before completion.",
        suggested_action:
            "Raise the budget for this task or split it into smaller sub-tasks with their own budgets.",
    },
    GuardrailFlag {
        code: GuardrailFlagCode::HallucinationFlag,
        severity: GuardrailSeverity::Warning,
        description:
            "The agent referenced a file, symbol, or fact that could not be verified against the workspace.",
        suggested_action:
            "Open the verification panel to see which claims need ground-truth checks before acceptance.",
    },
    GuardrailFlag {
        code: GuardrailFlagCode::PathEscapeAttempt,
        severity: GuardrailSeverity::Critical,
        description:
            "A tool tried to read or write a path that escaped the workspace root via symlink or '..'.",
        suggested_action:
            "Inspect the audit log for the offending tool call; the worker has been stopped.",
    },
    GuardrailFlag {
        code: GuardrailFlagCode::ToolAutoApprovalDenied,
        severity: GuardrailSeverity::Info,
        description:
            "A tool call did not match the auto-approval safe-list and was sent for user approval.",
        suggested_action:
            "No action required; approve or deny in the permissions UI as usual.",
    },
    GuardrailFlag {
        code: GuardrailFlagCode::SandboxEscapeAttempt,
        severity: GuardrailSeverity::Critical,
        description:
            "A subprocess attempted a syscall outside the seccomp-bpf allow-list.",
        suggested_action:
            "Abort the agent run, review the sandbox log, and report the regression upstream.",
    },
    GuardrailFlag {
        code: GuardrailFlagCode::AcceptanceCriteriaNotMet,
        severity: GuardrailSeverity::Error,
        description:
            "The verification mesh found at least one acceptance criterion still failing.",
        suggested_action:
            "Re-run the task with the unmet criteria injected as additionalContext, or relax the criterion.",
    },
];

pub fn flag_for(code: GuardrailFlagCode) -> &'static GuardrailFlag {
    FLAGS
        .iter()
        .find(|f| f.code == code)
        .expect("every GuardrailFlagCode variant has a registered metadata row")
}

pub fn flag_from_str(s: &str) -> Option<&'static GuardrailFlag> {
    GuardrailFlagCode::from_str(s).map(flag_for)
}

pub fn all_guardrail_flags() -> &'static [GuardrailFlag] {
    FLAGS
}
