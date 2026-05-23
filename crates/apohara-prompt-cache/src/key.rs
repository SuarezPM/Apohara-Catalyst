//! Cache key with L1 scoping safety.
//!
//! Layer 1 of the 3-layer safety system: every cache key MUST include
//! `provider_id` + `model_id` so a response cached for one provider can
//! never satisfy a lookup from a different provider/model pair. This
//! prevents cross-provider response contamination.
//!
//! Key fingerprint is blake3(provider || ':' || model || ':' || prompt).
//! Prompt fingerprint (for L2 hamming-distance match) is a 64-bit
//! token-bag simhash computed in-process (no external service).

use blake3::Hasher;

/// 32-byte blake3 digest used as the primary cache key.
pub type CacheKey = [u8; 32];

/// Compute scoped cache key. L1 safety: keys scope provider + model so
/// `(provider_a, model_x, prompt) != (provider_b, model_x, prompt)`.
pub fn key_scope(prompt: &str, provider_id: &str, model_id: &str) -> CacheKey {
    let mut h = Hasher::new();
    h.update(provider_id.as_bytes());
    h.update(b":");
    h.update(model_id.as_bytes());
    h.update(b":");
    h.update(prompt.as_bytes());
    *h.finalize().as_bytes()
}

/// Token-bag 64-bit simhash used by L2 hamming-distance matching.
///
/// Tokenisation: split on ASCII whitespace, lowercase. Each token feeds
/// blake3 → take the first 8 bytes as a 64-bit fingerprint. The simhash
/// accumulator adds +1 / -1 per bit based on the token fingerprint,
/// then collapses sign back into a 64-bit signature.
///
/// This is intentionally simple — `apohara-context-primitives` will
/// expose a richer LSH-aware implementation in a parallel sprint; the
/// prompt-cache only needs deterministic L2 confidence buckets.
pub fn prompt_simhash(prompt: &str) -> u64 {
    let mut accum = [0i32; 64];
    let mut token_count = 0u32;
    for raw_token in prompt.split_ascii_whitespace() {
        let token = raw_token.to_ascii_lowercase();
        let fp = token_fingerprint(token.as_bytes());
        for (i, slot) in accum.iter_mut().enumerate() {
            if (fp >> i) & 1 == 1 {
                *slot += 1;
            } else {
                *slot -= 1;
            }
        }
        token_count += 1;
    }
    if token_count == 0 {
        return 0;
    }
    let mut sig: u64 = 0;
    for (i, slot) in accum.iter().enumerate() {
        if *slot > 0 {
            sig |= 1u64 << i;
        }
    }
    sig
}

fn token_fingerprint(bytes: &[u8]) -> u64 {
    let digest = blake3::hash(bytes);
    let b = digest.as_bytes();
    u64::from_le_bytes([b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7]])
}

/// Hamming distance between two 64-bit simhashes.
pub fn hamming_distance(a: u64, b: u64) -> u32 {
    (a ^ b).count_ones()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cache_key_includes_provider() {
        let k = key_scope("hello", "claude-code-cli", "sonnet-4-7");
        let other = key_scope("hello", "codex-cli", "sonnet-4-7");
        assert_ne!(k, other, "L1 safety: different providers MUST differ");
    }

    #[test]
    fn cache_key_includes_model() {
        let sonnet = key_scope("hello", "claude-code-cli", "sonnet-4-7");
        let opus = key_scope("hello", "claude-code-cli", "opus-4-7");
        assert_ne!(sonnet, opus, "L1 safety: different models MUST differ");
    }

    #[test]
    fn cache_key_identical_for_same_inputs() {
        let a = key_scope("hello world", "claude-code-cli", "sonnet-4-7");
        let b = key_scope("hello world", "claude-code-cli", "sonnet-4-7");
        assert_eq!(a, b);
    }

    #[test]
    fn cache_key_no_separator_collision() {
        // "claude" + ":foo" prompt MUST NOT collide with "claude:foo" + "" prompt.
        let a = key_scope(":foo", "claude", "m");
        let b = key_scope("foo", "claude:", "m");
        assert_ne!(a, b, "separator byte must not allow trivial collision");
    }

    #[test]
    fn simhash_is_deterministic() {
        let a = prompt_simhash("the quick brown fox jumps over the lazy dog");
        let b = prompt_simhash("the quick brown fox jumps over the lazy dog");
        assert_eq!(a, b);
    }

    #[test]
    fn simhash_empty_is_zero() {
        assert_eq!(prompt_simhash(""), 0);
        assert_eq!(prompt_simhash("    "), 0);
    }

    #[test]
    fn hamming_distance_identical_is_zero() {
        assert_eq!(hamming_distance(0xDEAD_BEEF, 0xDEAD_BEEF), 0);
    }

    #[test]
    fn hamming_distance_single_bit_is_one() {
        assert_eq!(hamming_distance(0b0001, 0b0000), 1);
    }
}
