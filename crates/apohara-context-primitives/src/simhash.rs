//! SimHash — Charikar 2002 64-bit similarity fingerprint.
//!
//! Algorithm (one pass per token):
//!   1. Hash each token to a 64-bit signature via [`crate::fingerprint::hash_token`].
//!   2. Walk the 64 bits. For each bit position `i`:
//!        * if bit `i` of the token hash is 1 → vote `+1` into `v[i]`
//!        * else                              → vote `-1` into `v[i]`
//!   3. Final fingerprint bit `i` is `1` iff `v[i] > 0`.
//!
//! Result: documents that share many tokens accumulate aligned votes, so
//! their fingerprints differ in few bits (low Hamming distance). Two
//! unrelated documents produce roughly uniform random bits → ~32 bits of
//! difference on average.
//!
//! Port reference: `apohara-context-forge/.../dedup/lsh_engine.py::_simhash_block`
//! (the upstream is token-id specific via xorshift; we generalize to a
//! `&str` tokenizer surface so the same routine handles prompts, code,
//! AST symbols, etc.).

use crate::fingerprint::{hash_token, tokenize_shingles, tokenize_whitespace};

/// Charikar 2002 SimHash over whitespace tokens.
///
/// Empty input → returns `0`. Single-token input is degenerate but
/// well-defined: the fingerprint is exactly the bits of the token hash
/// where the bit is `1` (votes never tie, since they're `±1`).
#[inline]
pub fn simhash_64(text: &str) -> u64 {
    let tokens = tokenize_whitespace(text);
    simhash_64_from_tokens(tokens.iter().copied())
}

/// Charikar 2002 SimHash over character shingles of width `width`.
///
/// Far more robust than [`simhash_64`] on short / typoed text — the
/// upstream paper recommends `width = 3` or `width = 4` for English.
/// Returns `0` if no shingle is producible (text shorter than `width`).
pub fn simhash_64_shingles(text: &str, width: usize) -> u64 {
    let shingles = tokenize_shingles(text, width);
    simhash_64_from_tokens(shingles.iter().map(String::as_str))
}

/// Charikar 2002 SimHash over an explicit token iterator.
///
/// Exposed for callers that bring their own tokenizer (BPE, AST symbols,
/// vLLM block IDs, etc.). The hashing primitive is fixed (blake3) — only
/// the tokenization surface is pluggable.
pub fn simhash_64_from_tokens<'a, I>(tokens: I) -> u64
where
    I: IntoIterator<Item = &'a str>,
{
    let mut v = [0i32; 64];
    let mut any = false;
    for token in tokens {
        any = true;
        let h = hash_token(token);
        for (i, vote) in v.iter_mut().enumerate() {
            if (h >> i) & 1 == 1 {
                *vote += 1;
            } else {
                *vote -= 1;
            }
        }
    }
    if !any {
        return 0;
    }
    let mut out: u64 = 0;
    for (i, vote) in v.iter().enumerate() {
        if *vote > 0 {
            out |= 1u64 << i;
        }
    }
    out
}

/// Hamming distance between two 64-bit signatures (bits that differ).
#[inline]
pub fn hamming_distance(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_returns_zero() {
        assert_eq!(simhash_64(""), 0);
        assert_eq!(simhash_64("   \n\t"), 0);
    }

    #[test]
    fn identical_inputs_produce_identical_hash() {
        assert_eq!(simhash_64("hello world"), simhash_64("hello world"));
    }

    #[test]
    fn similar_inputs_have_low_hamming() {
        // Single token swap on a 9-token sentence — most votes survive.
        let a = simhash_64("the quick brown fox jumps over the lazy dog");
        let b = simhash_64("the quick brown fox jumps over the lazy cat");
        let hd = hamming_distance(a, b);
        assert!(hd < 16, "expected <16 bits diff, got {hd}");
    }

    #[test]
    fn unrelated_inputs_have_high_hamming() {
        let a = simhash_64("Rust programming language and async tokio runtime");
        let b = simhash_64("Mediterranean cuisine olive oil tomato basil recipe");
        let hd = hamming_distance(a, b);
        // Random expectation ≈ 32; allow wide margin so the test is not flaky.
        assert!(hd > 12, "expected >12 bits diff, got {hd}");
    }

    #[test]
    fn shingles_capture_short_text_similarity() {
        // Whitespace tokenization collapses these to one or two tokens —
        // shingles do better at the substring level.
        let a = simhash_64_shingles("apohara", 3);
        let b = simhash_64_shingles("apoharra", 3); // single typo
        let hd = hamming_distance(a, b);
        assert!(hd < 24, "shingles should match similar short strings, got {hd}");
    }

    #[test]
    fn shingles_empty_below_width_returns_zero() {
        assert_eq!(simhash_64_shingles("ab", 3), 0);
        assert_eq!(simhash_64_shingles("", 4), 0);
    }

    #[test]
    fn hamming_distance_basic() {
        assert_eq!(hamming_distance(0, 0), 0);
        assert_eq!(hamming_distance(0xFFFF_FFFF_FFFF_FFFF, 0), 64);
        assert_eq!(hamming_distance(0b1010, 0b0101), 4);
    }

    // ---------------------------------------------------------------
    // proptest invariants — guard against algorithmic regressions
    // ---------------------------------------------------------------
    use proptest::prelude::*;

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(64))]

        /// Determinism: same input ⇒ same fingerprint, always.
        #[test]
        fn prop_simhash_is_deterministic(s in "[a-zA-Z0-9 ]{0,200}") {
            prop_assert_eq!(simhash_64(&s), simhash_64(&s));
        }

        /// Hamming distance is symmetric and bounded in [0, 64].
        #[test]
        fn prop_hamming_symmetric_and_bounded(
            a in any::<u64>(),
            b in any::<u64>(),
        ) {
            prop_assert_eq!(hamming_distance(a, b), hamming_distance(b, a));
            prop_assert!(hamming_distance(a, b) <= 64);
        }

        /// Appending the same token to a long enough document doesn't
        /// flip more than a handful of bits — the Charikar averaging
        /// effect means small perturbations on a large signal vector
        /// move few coordinates across zero.
        #[test]
        fn prop_small_append_is_low_hamming(
            base in "[a-z]{2,8}( [a-z]{2,8}){9,20}",
            tail in "[a-z]{2,8}",
        ) {
            let a = simhash_64(&base);
            let b = simhash_64(&format!("{base} {tail}"));
            let hd = hamming_distance(a, b);
            // 9-20 base tokens → adding one token moves at most a handful
            // of bits across zero. Allow up to 24 (~37.5%) for the small
            // base case, where the new token has more leverage.
            prop_assert!(hd <= 24, "single-token append moved {hd} bits");
        }
    }
}
