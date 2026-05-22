//! Slug naming: `<adjective>-<noun>-<16 hex>` per spec §3.1.
//!
//! The hex suffix is 64 bits of `OsRng` entropy. The previous 24-bit
//! `thread_rng` suffix had non-trivial collision probability in
//! long-running deployments where many worktrees are created per
//! second; 64-bit OsRng makes a same-second collision essentially
//! impossible AND uses a CSPRNG so the slug is unpredictable to other
//! local users.

use rand::RngCore;
use rand::rngs::OsRng;
use thiserror::Error;

const ADJECTIVES: &[&str] = &[
    "hopeful", "brave", "calm", "eager", "gentle", "jolly", "keen", "lucid",
    "merry", "nimble", "swift", "bright", "valiant", "patient", "earnest",
];
const NOUNS: &[&str] = &[
    "bhaskara", "euler", "gauss", "hopper", "lovelace", "newton", "pascal",
    "ramanujan", "tesla", "turing", "fermat", "hilbert", "noether", "boole",
];

#[derive(Debug, Error)]
pub enum NamingError {
    #[error("invalid slug shape: {0}")]
    InvalidShape(String),
}

#[derive(Debug, Clone)]
pub struct ParsedSlug {
    pub adjective: String,
    pub noun: String,
    pub suffix: String,
}

/// Number of hex characters in the random suffix. 16 hex → 64 bits of
/// entropy from `OsRng`. Anything less invites collisions when many
/// worktrees are created in the same second.
pub const SUFFIX_HEX_LEN: usize = 16;

pub fn random_slug() -> String {
    let mut rng = OsRng;
    // Pick adjective/noun via OsRng too — `thread_rng` is fine for
    // these but using a single RNG keeps the slug end-to-end uniform.
    let adj_idx = (rng.next_u32() as usize) % ADJECTIVES.len();
    let noun_idx = (rng.next_u32() as usize) % NOUNS.len();
    let adj = ADJECTIVES[adj_idx];
    let noun = NOUNS[noun_idx];
    let mut suffix_bytes = [0u8; 8];
    rng.fill_bytes(&mut suffix_bytes);
    let suffix = suffix_bytes
        .iter()
        .map(|b| format!("{:02x}", b))
        .collect::<String>();
    format!("{}-{}-{}", adj, noun, suffix)
}

pub fn parse_slug(s: &str) -> Result<ParsedSlug, NamingError> {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 3 {
        return Err(NamingError::InvalidShape(s.into()));
    }
    if parts[2].len() != SUFFIX_HEX_LEN
        || !parts[2].chars().all(|c| c.is_ascii_hexdigit())
    {
        return Err(NamingError::InvalidShape(s.into()));
    }
    Ok(ParsedSlug {
        adjective: parts[0].into(),
        noun: parts[1].into(),
        suffix: parts[2].into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn random_slug_has_64_bit_suffix() {
        let s = random_slug();
        let parts: Vec<&str> = s.split('-').collect();
        assert_eq!(parts.len(), 3);
        assert_eq!(parts[2].len(), SUFFIX_HEX_LEN);
        assert!(parts[2].chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn parse_slug_accepts_new_format() {
        let s = "swift-turing-deadbeefcafebabe";
        let p = parse_slug(s).expect("must parse");
        assert_eq!(p.adjective, "swift");
        assert_eq!(p.noun, "turing");
        assert_eq!(p.suffix, "deadbeefcafebabe");
    }

    #[test]
    fn parse_slug_rejects_legacy_6_hex() {
        // The pre-fix 6-hex format is intentionally rejected so we
        // can't accidentally adopt a stale low-entropy slug from an
        // older deployment.
        assert!(parse_slug("swift-turing-abcdef").is_err());
    }
}
