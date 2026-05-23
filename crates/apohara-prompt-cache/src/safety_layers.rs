//! 3-layer safety system for the prompt cache.
//!
//! These layers are intentionally orthogonal so a regression in one layer
//! cannot silently disable the others:
//!
//! * **L1 — cache key scoping.** Every entry is keyed by
//!   `(provider_id, model_id, prompt_fingerprint)` via [`key::key_scope`].
//!   `ScopedLookup` couples a key together with the scope tuple that
//!   produced it so audits / telemetry never lose provenance.
//! * **L2 — confidence threshold.** Lookups bucket the prompt simhash by
//!   hamming distance (0 / 1-3 / 4-7 / 8-15 / 16+). Each bucket has a
//!   per-bucket accept gate; below threshold = miss.
//! * **L3 — opt-in flag.** Cache is OFF unless `APOHARA_PROMPT_CACHE=1`.
//!   The predicate is pure so callers can test the gate without
//!   mutating process env.

use crate::key::{key_scope, CacheKey};

/// A cache key together with the scope tuple that produced it.
/// Useful for telemetry / audit pipelines that need to attribute a hit
/// or a miss back to a `(provider, model)` pair.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScopedLookup<'a> {
    pub provider_id: &'a str,
    pub model_id: &'a str,
    pub key: CacheKey,
}

impl<'a> ScopedLookup<'a> {
    pub fn new(prompt: &str, provider_id: &'a str, model_id: &'a str) -> Self {
        Self {
            provider_id,
            model_id,
            key: key_scope(prompt, provider_id, model_id),
        }
    }
}

#[cfg(test)]
mod l1_tests {
    use super::*;

    #[test]
    fn scoped_lookup_preserves_scope_fields() {
        let s = ScopedLookup::new("hello", "claude-code-cli", "sonnet-4-7");
        assert_eq!(s.provider_id, "claude-code-cli");
        assert_eq!(s.model_id, "sonnet-4-7");
    }

    #[test]
    fn scoped_lookup_key_matches_key_scope() {
        let s = ScopedLookup::new("hello", "claude-code-cli", "sonnet-4-7");
        let direct = key_scope("hello", "claude-code-cli", "sonnet-4-7");
        assert_eq!(s.key, direct);
    }

    #[test]
    fn scoped_lookup_l1_cross_provider_differs() {
        let a = ScopedLookup::new("hello", "claude-code-cli", "sonnet-4-7");
        let b = ScopedLookup::new("hello", "codex-cli", "sonnet-4-7");
        assert_ne!(a.key, b.key, "L1: cross-provider keys MUST differ");
    }

    #[test]
    fn scoped_lookup_l1_cross_model_differs() {
        let a = ScopedLookup::new("hello", "claude-code-cli", "sonnet-4-7");
        let b = ScopedLookup::new("hello", "claude-code-cli", "opus-4-7");
        assert_ne!(a.key, b.key, "L1: cross-model keys MUST differ");
    }
}
