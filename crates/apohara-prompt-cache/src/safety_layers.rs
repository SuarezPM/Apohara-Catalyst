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

use crate::key::{hamming_distance, key_scope, CacheKey};

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

// ---------------------------------------------------------------------------
// L2 — confidence threshold via hamming-distance ladder
// ---------------------------------------------------------------------------

/// Hamming-distance ladder buckets for L2 confidence gating.
///
/// `Exact` (distance 0) is the only bucket admitted by default — the
/// other buckets exist so a future fuzzy-match path can opt in
/// per-bucket without rewriting the ladder.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ConfidenceBucket {
    /// hamming = 0 — byte-identical prompts.
    Exact,
    /// hamming 1..=3 — near-duplicates (whitespace / punctuation drift).
    Near,
    /// hamming 4..=7 — paraphrase territory.
    Loose,
    /// hamming 8..=15 — same topic, different wording.
    Topical,
    /// hamming 16+ — unrelated; never accept.
    Unrelated,
}

impl ConfidenceBucket {
    /// Classify a hamming distance into a bucket.
    pub fn classify(distance: u32) -> Self {
        match distance {
            0 => Self::Exact,
            1..=3 => Self::Near,
            4..=7 => Self::Loose,
            8..=15 => Self::Topical,
            _ => Self::Unrelated,
        }
    }
}

/// Per-bucket accept gate. Defaults to "Exact only" because fuzzy
/// matching has not yet been validated against production prompts;
/// callers raise the threshold deliberately once telemetry shows
/// safe acceptance rates per bucket.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct ConfidenceGate {
    accept_exact: bool,
    accept_near: bool,
    accept_loose: bool,
    accept_topical: bool,
}

impl Default for ConfidenceGate {
    fn default() -> Self {
        // Exact-only by default. Phase 4 self-tuning may widen this.
        Self {
            accept_exact: true,
            accept_near: false,
            accept_loose: false,
            accept_topical: false,
        }
    }
}

impl ConfidenceGate {
    pub fn exact_only() -> Self {
        Self::default()
    }

    /// Gate that admits every bucket except `Unrelated`. Useful for
    /// tests and for self-tuning experiments — NOT a recommended
    /// production default.
    pub fn all_except_unrelated() -> Self {
        Self {
            accept_exact: true,
            accept_near: true,
            accept_loose: true,
            accept_topical: true,
        }
    }

    /// Whether a lookup with the given hamming distance should be
    /// returned as a hit. `Unrelated` is always rejected.
    pub fn admits(&self, distance: u32) -> bool {
        match ConfidenceBucket::classify(distance) {
            ConfidenceBucket::Exact => self.accept_exact,
            ConfidenceBucket::Near => self.accept_near,
            ConfidenceBucket::Loose => self.accept_loose,
            ConfidenceBucket::Topical => self.accept_topical,
            ConfidenceBucket::Unrelated => false,
        }
    }

    /// Convenience: classify-then-admit using two 64-bit simhashes.
    pub fn admits_simhashes(&self, candidate: u64, stored: u64) -> bool {
        self.admits(hamming_distance(candidate, stored))
    }
}

#[cfg(test)]
mod l2_tests {
    use super::*;

    #[test]
    fn confidence_bucket_exact_at_zero() {
        assert_eq!(ConfidenceBucket::classify(0), ConfidenceBucket::Exact);
    }

    #[test]
    fn confidence_bucket_near_one_to_three() {
        for d in 1..=3 {
            assert_eq!(ConfidenceBucket::classify(d), ConfidenceBucket::Near);
        }
    }

    #[test]
    fn confidence_bucket_loose_four_to_seven() {
        for d in 4..=7 {
            assert_eq!(ConfidenceBucket::classify(d), ConfidenceBucket::Loose);
        }
    }

    #[test]
    fn confidence_bucket_topical_eight_to_fifteen() {
        for d in 8..=15 {
            assert_eq!(ConfidenceBucket::classify(d), ConfidenceBucket::Topical);
        }
    }

    #[test]
    fn confidence_bucket_unrelated_sixteen_plus() {
        for d in [16, 17, 32, 63, 64] {
            assert_eq!(ConfidenceBucket::classify(d), ConfidenceBucket::Unrelated);
        }
    }

    #[test]
    fn default_gate_is_exact_only() {
        let g = ConfidenceGate::default();
        assert!(g.admits(0));
        assert!(!g.admits(1));
        assert!(!g.admits(5));
        assert!(!g.admits(10));
        assert!(!g.admits(20));
    }

    #[test]
    fn all_except_unrelated_admits_through_topical() {
        let g = ConfidenceGate::all_except_unrelated();
        assert!(g.admits(0));
        assert!(g.admits(3));
        assert!(g.admits(7));
        assert!(g.admits(15));
        assert!(!g.admits(16), "Unrelated bucket is always rejected");
        assert!(!g.admits(64));
    }

    #[test]
    fn admits_simhashes_uses_hamming() {
        let g = ConfidenceGate::all_except_unrelated();
        assert!(g.admits_simhashes(0xFFFF_FFFF_FFFF_FFFF, 0xFFFF_FFFF_FFFF_FFFF));
        // hamming 64 — Unrelated bucket — always reject.
        assert!(!g.admits_simhashes(0xFFFF_FFFF_FFFF_FFFF, 0x0));
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
