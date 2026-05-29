//! Opt-in model-judge tier (prompt-build + flag plumbing only).
//!
//! HARD RULE — zero-token by default. The model-judge is the ONLY
//! token-spending path Apohara's verification crate would ever have, so its
//! flag uses **opt-IN** semantics: it is OFF unless `APOHARA_MODEL_JUDGE=1`.
//! This is the deliberate INVERSE of `apohara-mcp::api::is_enabled`, which
//! defaults ON unless `=0` — copying that idiom here would silently spend
//! tokens (pre-mortem scenario 3). See [`judge_enabled`].
//!
//! Scope (Decision 4A — de-scoped): this module gates **prompt assembly**
//! behind the flag and emits the ready-to-dispatch prompt `String`. It does
//! NOT invoke any model. `apohara-verification` has no model-invocation path
//! today (`critic_prompt::build_critic_prompt` only renders a `String`;
//! `quality_gates::run_all_gates` is pure regex over `GateInput`; zero
//! spawn/dispatch/reqwest sites exist in the crate). The actual model
//! dispatch + `APPROVE | NEEDS_CHANGES | REJECT` parsing is a DEFERRED
//! follow-up (ADR Follow-up §1) — NOT wired here. Because no dispatch path
//! exists in the gate crate, even a flag bug cannot spend tokens.
//!
//! The token-accounting hook point for that deferred dispatch lives in
//! [`record_judge_cost`]: when the follow-up lands, the per-provider
//! absolute accounting (§0.14) is already wired through
//! `apohara_token_accounting::TokenCounter::record_absolute`.

use apohara_token_accounting::{TokenCounter, TokenSnapshot};

use crate::critic_prompt::{build_critic_prompt, CriticContext};

/// Opt-IN flag predicate for the model-judge tier.
///
/// Returns `true` **only** for `Some("1")`. `None`, `Some("0")`, and any
/// other value all yield `false`. This is the INVERSE of
/// `apohara-mcp::api::is_enabled` (default ON unless `=0`) — see module doc.
pub fn judge_enabled(env: Option<&str>) -> bool {
    env == Some("1")
}

/// Reads `APOHARA_MODEL_JUDGE` from the environment and applies the opt-in
/// predicate. Wraps [`judge_enabled`] for call sites that don't already hold
/// the env value.
pub fn judge_enabled_from_env() -> bool {
    judge_enabled(std::env::var("APOHARA_MODEL_JUDGE").ok().as_deref())
}

/// Assemble the ready-to-dispatch judge prompt **iff** the opt-in flag is set.
///
/// Returns `Some(prompt)` only when `judge_enabled(flag)` is true; `None`
/// otherwise. The prompt is produced by the existing
/// [`build_critic_prompt`] — no model is invoked (Decision 4A). The caller
/// of a future dispatch follow-up would feed this `String` to a provider
/// round-trip and parse the verdict back; that path is deliberately absent
/// here so the tier cannot spend tokens.
pub fn build_judge_prompt(flag: Option<&str>, ctx: &CriticContext) -> Option<String> {
    if !judge_enabled(flag) {
        return None;
    }
    Some(build_critic_prompt(ctx))
}

/// Token-accounting hook point for the (deferred) judge dispatch.
///
/// The judge tier is the ONLY token-spending path in this crate's design,
/// and it is opt-in (see module doc). This helper records a per-provider
/// **absolute** snapshot (§0.14 — absolutes > deltas) so that when the
/// deferred model dispatch lands (ADR Follow-up §1) the accounting wiring is
/// already in place. It performs no I/O and invokes no model.
pub fn record_judge_cost(
    counter: &mut TokenCounter,
    provider_id: &str,
    thread_id: &str,
    cost: TokenSnapshot,
) {
    counter.record_absolute(provider_id, thread_id, cost);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::critic_prompt::CriticContext;

    fn sample_ctx() -> CriticContext {
        CriticContext {
            task_description: "Add login endpoint".to_string(),
            prior_attempts: 0,
            incidents: None,
        }
    }

    #[test]
    fn judge_enabled_is_opt_in() {
        // HARD RULE (scenario 3): default OFF — only Some("1") enables.
        assert!(!judge_enabled(None), "absent flag must be OFF");
        assert!(!judge_enabled(Some("0")), "explicit 0 must be OFF");
        assert!(!judge_enabled(Some("true")), "anything-else must be OFF");
        assert!(!judge_enabled(Some("")), "empty must be OFF");
        assert!(judge_enabled(Some("1")), "Some(\"1\") must be ON");
    }

    #[test]
    fn judge_tier_absent_when_flag_unset() {
        let ctx = sample_ctx();

        // Flag unset → no judge tier (prompt-build returns None), so the gate
        // path is byte-identical to today (the 7 regex gates are untouched).
        assert!(
            build_judge_prompt(None, &ctx).is_none(),
            "flag unset must yield no judge tier"
        );
        assert!(
            build_judge_prompt(Some("0"), &ctx).is_none(),
            "flag=0 must yield no judge tier"
        );

        // Flag set → the prompt-build tier is present (ready-to-dispatch
        // String), and it is exactly the existing critic prompt (no model).
        let prompt = build_judge_prompt(Some("1"), &ctx).expect("flag=1 must yield a prompt");
        assert_eq!(prompt, build_critic_prompt(&ctx), "tier output is the critic prompt verbatim");
        assert!(prompt.contains("You are the critic"), "got: {prompt}");
    }

    #[test]
    fn record_judge_cost_records_absolute() {
        let mut counter = TokenCounter::new();
        let cost = TokenSnapshot { input: 1200, output: 300, cache_creation: 0, cache_read: 0 };
        record_judge_cost(&mut counter, "claude", "judge-thread", cost.clone());

        let stored = counter.get("claude", "judge-thread").expect("absolute not recorded");
        assert_eq!(stored, &cost, "judge cost must be stored as an absolute snapshot");
    }
}
