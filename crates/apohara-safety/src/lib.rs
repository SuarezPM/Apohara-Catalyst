//! Apohara Safety — permission system + bash compound analyzer +
//! settings hierarchy + durable prompt + runner policy.
//!
//! Replaces `src/core/safety/*.ts` (TS legacy). Feature flag:
//! APOHARA_RUST_SAFETY=1 (default OFF until Phase 1 cierre).
//!
//! G1.B.2 port — modules added task-by-task following TDD.
//! Critical invariant preserved from TS: INV-bash-scope (compound bash
//! commands always require scope match; see Sprint 5 INV-15 history).

pub mod bash_compound;
pub mod pattern_validator;
pub mod patterns;
pub mod permission_cache;
pub mod permission_grid;
pub mod settings_hierarchy;

pub use bash_compound::{is_compound, split_compound};
pub use pattern_validator::is_valid_pattern;
pub use patterns::{match_pattern, parse_pattern_string, PermissionPattern, ToolInvocation};
pub use permission_cache::PermissionCache;
pub use permission_grid::{PermissionGrid, PermissionRow, PermissionScope, PermissionState};
pub use settings_hierarchy::{
    merge_settings_tiers, MergeOpts, MergedSettings, SettingsSource, SettingsTier,
};

#[cfg(test)]
mod bash_compound_tests;
#[cfg(test)]
mod pattern_validator_tests;
#[cfg(test)]
mod patterns_tests;
#[cfg(test)]
mod permission_cache_grid_tests;
#[cfg(test)]
mod settings_hierarchy_tests;
