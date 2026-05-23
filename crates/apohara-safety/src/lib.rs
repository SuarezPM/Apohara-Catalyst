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
pub mod patterns;

pub use bash_compound::{is_compound, split_compound};
pub use patterns::{match_pattern, parse_pattern_string, PermissionPattern, ToolInvocation};

#[cfg(test)]
mod bash_compound_tests;
#[cfg(test)]
mod patterns_tests;
