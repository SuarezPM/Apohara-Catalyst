//! Apohara Safety — permission system + bash compound analyzer +
//! settings hierarchy + durable prompt + runner policy.
//!
//! Replaces `src/core/safety/*.ts` (TS legacy). Feature flag:
//! APOHARA_RUST_SAFETY=1 (default OFF until Phase 1 cierre).
//!
//! G1.B.2 port — modules added task-by-task following TDD.
//! Critical invariant preserved from TS: INV-bash-scope (compound bash
//! commands always require scope match; see Sprint 5 INV-15 history).

pub mod auto_approval;
pub mod bash_compound;
pub mod durable_prompt;
pub mod guardrail_flags;
pub mod inv_bash_scope;
pub mod pattern_validator;
pub mod patterns;
pub mod permission_cache;
pub mod permission_grid;
pub mod permission_service;
pub mod pure_profiles;
pub mod runner_policy;
pub mod settings_hierarchy;
pub mod tauri_bridge;

pub use auto_approval::{classify_tool_for_auto_approval, AutoApprovalDecision};
pub use bash_compound::{is_compound, split_compound};
pub use inv_bash_scope::{invariant_holds, is_proven_safe, prove_no_scope_escape, ProofResult};
pub use guardrail_flags::{
    all_guardrail_flags, flag_for, flag_from_str, GuardrailFlag, GuardrailFlagCode,
    GuardrailSeverity,
};
pub use pattern_validator::is_valid_pattern;
pub use patterns::{match_pattern, parse_pattern_string, PermissionPattern, ToolInvocation};
pub use permission_cache::PermissionCache;
pub use permission_grid::{PermissionGrid, PermissionRow, PermissionScope, PermissionState};
pub use permission_service::{
    check as check_permission, AllowReason, DenyReason, PermissionDecision, PermissionServiceOpts,
};
pub use pure_profiles::{
    apply_pure_profile, get_pure_profile, is_allowed, PureAction, PureProfile, PureProfileName,
    SafetyDecision,
};
pub use settings_hierarchy::{
    merge_settings_tiers, MergeOpts, MergedSettings, SettingsSource, SettingsTier,
};

#[cfg(test)]
mod auto_approval_tests;
#[cfg(test)]
mod bash_compound_tests;
#[cfg(test)]
mod guardrail_profiles_tests;
#[cfg(test)]
mod inv_bash_scope_test;
#[cfg(test)]
mod pattern_validator_tests;
#[cfg(test)]
mod patterns_tests;
#[cfg(test)]
mod permission_cache_grid_tests;
#[cfg(test)]
mod durable_prompt_tests;
#[cfg(test)]
mod permission_service_tests;
#[cfg(test)]
mod runner_policy_tests;
#[cfg(test)]
mod settings_hierarchy_tests;
