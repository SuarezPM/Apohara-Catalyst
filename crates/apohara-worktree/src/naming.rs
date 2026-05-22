//! Slug naming: `<adjective>-<noun>-<6 hex>` per spec §3.1.

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

pub fn random_slug() -> String {
    use rand::Rng;
    let mut rng = rand::thread_rng();
    let adj = ADJECTIVES[rng.gen_range(0..ADJECTIVES.len())];
    let noun = NOUNS[rng.gen_range(0..NOUNS.len())];
    let suffix: String = (0..6).map(|_| {
        let n = rng.gen_range(0..16u8);
        std::char::from_digit(n as u32, 16).unwrap()
    }).collect();
    format!("{}-{}-{}", adj, noun, suffix)
}

pub fn parse_slug(s: &str) -> Result<ParsedSlug, NamingError> {
    let parts: Vec<&str> = s.split('-').collect();
    if parts.len() != 3 {
        return Err(NamingError::InvalidShape(s.into()));
    }
    if parts[2].len() != 6 || !parts[2].chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(NamingError::InvalidShape(s.into()));
    }
    Ok(ParsedSlug {
        adjective: parts[0].into(),
        noun: parts[1].into(),
        suffix: parts[2].into(),
    })
}
