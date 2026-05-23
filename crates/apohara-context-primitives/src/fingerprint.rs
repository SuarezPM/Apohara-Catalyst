//! Token fingerprinting primitives — blake3-based, deterministic.
//!
//! Provides the shared building blocks consumed by [`crate::simhash`]:
//!   * `hash_token` — stable 64-bit hash of an arbitrary string token
//!   * `tokenize_whitespace` — minimal tokenizer (whitespace split)
//!   * `tokenize_shingles`   — character n-gram tokenizer for short-text robustness
//!
//! All hashing routes through `blake3` for a single source of truth on the
//! cryptographic primitive. No allocation in the hot loop beyond what
//! `blake3::Hasher` does internally.

use blake3::Hasher;

/// Deterministic 64-bit fingerprint of a byte slice.
///
/// Uses the low 8 bytes of the blake3 digest. blake3 is uniformly
/// distributed, so a 64-bit truncation is collision-resistant for the
/// feature-hashing regime SimHash needs (we tolerate occasional bit
/// collisions; SimHash averages over many tokens).
#[inline]
pub fn hash_bytes(bytes: &[u8]) -> u64 {
    let mut h = Hasher::new();
    h.update(bytes);
    let digest = h.finalize();
    let arr = digest.as_bytes();
    u64::from_le_bytes([
        arr[0], arr[1], arr[2], arr[3], arr[4], arr[5], arr[6], arr[7],
    ])
}

/// Deterministic 64-bit fingerprint of a string token.
#[inline]
pub fn hash_token(token: &str) -> u64 {
    hash_bytes(token.as_bytes())
}

/// Split `text` on Unicode whitespace, returning non-empty tokens.
///
/// Allocates a `Vec<&str>` — caller decides whether to materialize. For
/// stream-friendly use, prefer iterating `text.split_whitespace()` directly.
pub fn tokenize_whitespace(text: &str) -> Vec<&str> {
    text.split_whitespace().collect()
}

/// Character-shingle tokenizer (`width`-character sliding window).
///
/// More robust than whitespace splitting for short / typoed text because
/// adjacent shingles preserve local edit-distance signals. `width = 3` is
/// the Charikar 2002 default for SimHash near-duplicate detection.
///
/// Returns an empty vector if `text.chars().count() < width` or `width == 0`.
pub fn tokenize_shingles(text: &str, width: usize) -> Vec<String> {
    if width == 0 {
        return Vec::new();
    }
    let chars: Vec<char> = text.chars().collect();
    if chars.len() < width {
        return Vec::new();
    }
    let mut out = Vec::with_capacity(chars.len() + 1 - width);
    for window in chars.windows(width) {
        out.push(window.iter().collect::<String>());
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hash_token_is_deterministic() {
        assert_eq!(hash_token("apohara"), hash_token("apohara"));
    }

    #[test]
    fn hash_token_distinguishes_inputs() {
        assert_ne!(hash_token("foo"), hash_token("bar"));
    }

    #[test]
    fn hash_bytes_matches_hash_token_for_utf8() {
        assert_eq!(hash_bytes(b"abc"), hash_token("abc"));
    }

    #[test]
    fn whitespace_tokenizer_drops_empties() {
        let toks = tokenize_whitespace("  hello   world\t\n");
        assert_eq!(toks, vec!["hello", "world"]);
    }

    #[test]
    fn shingle_tokenizer_width_3() {
        let s = tokenize_shingles("abcde", 3);
        assert_eq!(s, vec!["abc", "bcd", "cde"]);
    }

    #[test]
    fn shingle_tokenizer_handles_short_input() {
        assert!(tokenize_shingles("ab", 3).is_empty());
        assert!(tokenize_shingles("", 3).is_empty());
        assert!(tokenize_shingles("abcde", 0).is_empty());
    }

    #[test]
    fn shingle_tokenizer_unicode_safe() {
        // Each emoji is one char in Rust's char iteration.
        let s = tokenize_shingles("aé€b", 2);
        assert_eq!(s, vec!["aé", "é€", "€b"]);
    }
}
