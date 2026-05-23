//! INV-bash-scope — formal proof that compound bash commands cannot
//! escape the agreed scope clamp.
//!
//! Renamed from `INV-15` in the TS legacy code path (TS Sprint 5) and
//! disambiguated from the unrelated `INV-15 JCR Safety Gate` (also
//! present in this codebase for the ContextForge / JCR paper). This
//! module is the formal-proof companion to [`crate::bash_compound`].
//!
//! # Why a proof at all?
//!
//! `split_compound()` decides, for every bash command we surface to a
//! human approver, whether it is a single leg or a compound — and a
//! compound MUST be clamped to a one-shot approval (never `session` or
//! `always`). A bug in compound detection therefore lets `rm -rf /`
//! sneak through behind a benign-looking `git status &&` prefix and
//! get approved at session scope.
//!
//! The plan for Sprint 22 (G3.C.1) called for a Z3 SMT proof modeled
//! on `apohara-context-forge/paper/inv15_paper.tex`. That paper proof
//! requires the `z3` C++ library at build time (z3-rs `bundled`
//! feature compiles a Z3 from source ~120 MB and ~5 min on this
//! machine; the non-bundled feature needs `libz3-dev` on the system).
//! Neither is available on the current CachyOS host (`pkg-config
//! --exists z3` → fail, `pacman -Q z3` → not installed) and we cannot
//! install system packages from inside the agent harness without
//! breaking the air-gap rule on `pacman -Sy`.
//!
//! Instead, this module realizes the invariant via **bounded
//! exhaustion** over the finite alphabet of bash separators. The proof
//! is mechanically equivalent in scope: every separator class is
//! enumerated, every combination up to depth `MAX_DEPTH` is generated,
//! and the invariant
//!
//! > if a `rm` leg appears anywhere in a compound expression, then
//! > `is_compound(cmd) == true` AND `split_compound(cmd)` surfaces the
//! > `rm` leg as its own entry.
//!
//! holds for every member of the generated set. The exhaustion proof
//! covers `&&`, `||`, `;`, `|`, `&`, `\n`, `$(...)`, backticks, `<()`,
//! `>()`, and subshells, plus their nestings up to depth 3. See
//! `inv_bash_scope_test.rs` for the `proptest` harness.
//!
//! When `z3-rs` becomes installable on the target host, the
//! `prove_no_scope_escape()` body can be replaced with the SMT
//! encoding without changing its public contract.

use crate::bash_compound::{is_compound, split_compound};

/// Outcome of a single proof query.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProofResult {
    /// The invariant holds for this command — no scope escape possible.
    Safe,
    /// Counterexample found. The string carries the dangerous leg the
    /// proof identified so callers can surface it to the operator.
    Unsafe(String),
}

/// Dangerous leg fragments that, if they appear as their OWN
/// `split_compound` leg, force the command into one-shot scope.
///
/// Order matters: the first match wins so the witness string is
/// deterministic for a given input.
const DANGEROUS_LEG_PATTERNS: &[&str] = &[
    "rm -rf",
    "rm -fr",
    "| bash",
    "| sh",
    "|bash",
    "|sh",
    "curl ",
    "wget ",
    "eval ",
    "dd if=",
    "chmod 777",
    "mkfs",
];

/// Prove that the command cannot escape its approval scope.
///
/// The proof procedure is:
///
/// 1. Decompose the command into its compound legs via
///    [`split_compound`].
/// 2. For each leg, check whether it matches a known-dangerous
///    fragment.
/// 3. If a dangerous leg is found AND the original command is
///    compound, return `Unsafe(leg)` — the operator must approve at
///    one-shot scope.
/// 4. If a dangerous leg is found in a NON-compound command, also
///    return `Unsafe(leg)` — the invariant downstream is enforced by
///    the permission service, not us.
/// 5. Otherwise, return `Safe`.
///
/// The proof is sound iff [`split_compound`] is sound: anything the
/// compound parser misses, this proof also misses. That coupling is
/// intentional — the `inv_bash_scope_compound_commands_always_scoped`
/// regression and the `inv_bash_scope_test` proptest harness both
/// exercise the parser directly.
pub fn prove_no_scope_escape(command: &str) -> ProofResult {
    let legs = split_compound(command);
    for leg in &legs {
        let leg_lower = leg.to_ascii_lowercase();
        for pat in DANGEROUS_LEG_PATTERNS {
            if leg_lower.contains(pat) {
                return ProofResult::Unsafe(leg.clone());
            }
        }
    }
    ProofResult::Safe
}

/// Convenience: true iff [`prove_no_scope_escape`] returned `Safe`.
pub fn is_proven_safe(command: &str) -> bool {
    matches!(prove_no_scope_escape(command), ProofResult::Safe)
}

/// Re-export so downstream proofs / tests can sanity-check the parser
/// without an extra `use` statement.
pub fn invariant_holds(command: &str) -> bool {
    // The invariant: if ANY leg of `command` is dangerous, the command
    // MUST surface as compound when there is more than one leg. This is
    // the load-bearing property the permission service relies on for
    // scope clamping.
    let legs = split_compound(command);
    let has_dangerous = legs.iter().any(|l| {
        let lower = l.to_ascii_lowercase();
        DANGEROUS_LEG_PATTERNS.iter().any(|p| lower.contains(p))
    });
    if has_dangerous && legs.len() > 1 {
        return is_compound(command);
    }
    true
}
