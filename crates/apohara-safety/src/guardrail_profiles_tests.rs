use super::guardrail_flags::{
    all_guardrail_flags, flag_for, flag_from_str, GuardrailFlagCode, GuardrailSeverity,
};
use super::pure_profiles::{
    apply_pure_profile, get_pure_profile, is_allowed, PureAction, PureProfileName,
};

#[test]
fn every_flag_code_resolves() {
    for code in [
        GuardrailFlagCode::PromptInjectionDetected,
        GuardrailFlagCode::RateLimitExceeded,
        GuardrailFlagCode::BudgetExceeded,
        GuardrailFlagCode::HallucinationFlag,
        GuardrailFlagCode::PathEscapeAttempt,
        GuardrailFlagCode::ToolAutoApprovalDenied,
        GuardrailFlagCode::SandboxEscapeAttempt,
        GuardrailFlagCode::AcceptanceCriteriaNotMet,
    ] {
        let f = flag_for(code);
        assert_eq!(f.code, code);
        assert!(!f.description.is_empty());
        assert!(!f.suggested_action.is_empty());
    }
}

#[test]
fn flag_from_string_roundtrips() {
    let f = flag_from_str("PROMPT_INJECTION_DETECTED").expect("known code");
    assert_eq!(f.severity, GuardrailSeverity::Critical);
    assert!(flag_from_str("WAT_IS_THIS").is_none());
}

#[test]
fn all_flags_lists_eight() {
    assert_eq!(all_guardrail_flags().len(), 8);
}

#[test]
fn strict_profile_denies_writes() {
    assert!(!is_allowed(PureProfileName::Strict, PureAction::FileWrite));
    assert!(!is_allowed(
        PureProfileName::Strict,
        PureAction::NetworkEgress
    ));
    assert!(is_allowed(PureProfileName::Strict, PureAction::FileRead));
}

#[test]
fn read_only_allows_network_but_no_write() {
    assert!(is_allowed(
        PureProfileName::ReadOnly,
        PureAction::NetworkEgress
    ));
    assert!(!is_allowed(
        PureProfileName::ReadOnly,
        PureAction::FileWrite
    ));
}

#[test]
fn eval_allows_shell_and_write_but_no_commit_or_network() {
    assert!(is_allowed(PureProfileName::Eval, PureAction::FileWrite));
    assert!(is_allowed(PureProfileName::Eval, PureAction::ShellExec));
    assert!(!is_allowed(PureProfileName::Eval, PureAction::GitCommit));
    assert!(!is_allowed(PureProfileName::Eval, PureAction::NetworkEgress));
}

#[test]
fn apply_returns_human_readable_reason() {
    let d = apply_pure_profile(PureProfileName::Strict, PureAction::ShellExec);
    assert!(!d.allowed);
    assert!(d.reason.contains("strict"));
    assert!(d.reason.contains("shell_exec"));
}

#[test]
fn get_pure_profile_has_description() {
    assert!(!get_pure_profile(PureProfileName::Strict)
        .description
        .is_empty());
}
