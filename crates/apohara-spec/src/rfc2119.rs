//! RFC 2119 validator (port of `src/core/spec/rfc2119-validator.ts`).
//!
//! RFC 2119 reserves the all-caps words MUST, MUST NOT, SHALL, SHALL NOT,
//! REQUIRED, SHOULD, SHOULD NOT, RECOMMENDED, MAY, and OPTIONAL as
//! requirement-strength keywords. A spec that uses these words in
//! lowercase or mixed case is ambiguous — the validator flags such cases.
//!
//! Profiles:
//!   - `Strict`  — every reserved word, in any non-ALL-CAPS form, is an
//!                 error. Default.
//!   - `Lenient` — the "must" trio (MUST / SHALL / REQUIRED) remains an
//!                 error; SHOULD / MAY / RECOMMENDED / OPTIONAL become
//!                 warnings.
//!   - `Off`     — no-op; the validator returns no violations.
//!
//! Markdown-aware: reserved keywords inside ```fenced``` blocks and
//! inline `code` spans are ignored — same-length space masking preserves
//! line/column offsets so the caller's line counter stays accurate.

use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rfc2119Profile {
    Strict,
    Lenient,
    Off,
}

impl Default for Rfc2119Profile {
    fn default() -> Self {
        Self::Strict
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rfc2119Severity {
    Error,
    Warning,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rfc2119Violation {
    /// 1-based line number where the violation occurred.
    pub line: usize,
    /// The reserved word as RFC 2119 spells it (e.g. "MUST").
    pub keyword: String,
    /// The exact text the writer used (e.g. "must", "Should").
    pub matched_text: String,
    pub severity: Rfc2119Severity,
    /// Short fix hint.
    pub suggestion: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rfc2119Result {
    pub profile: Rfc2119Profile,
    pub violations: Vec<Rfc2119Violation>,
}

// Canonical keyword + case-insensitive pattern. Order matters: two-word
// forms first so "must not" wins over the lone "must".
struct Keyword {
    canonical: &'static str,
    pattern: &'static str,
}

static KEYWORDS: &[Keyword] = &[
    Keyword { canonical: "MUST NOT", pattern: r"(?i)\bmust\s+not\b" },
    Keyword { canonical: "SHALL NOT", pattern: r"(?i)\bshall\s+not\b" },
    Keyword { canonical: "SHOULD NOT", pattern: r"(?i)\bshould\s+not\b" },
    Keyword { canonical: "MUST", pattern: r"(?i)\bmust\b" },
    Keyword { canonical: "SHALL", pattern: r"(?i)\bshall\b" },
    Keyword { canonical: "REQUIRED", pattern: r"(?i)\brequired\b" },
    Keyword { canonical: "SHOULD", pattern: r"(?i)\bshould\b" },
    Keyword { canonical: "RECOMMENDED", pattern: r"(?i)\brecommended\b" },
    Keyword { canonical: "MAY", pattern: r"(?i)\bmay\b" },
    Keyword { canonical: "OPTIONAL", pattern: r"(?i)\boptional\b" },
];

fn compiled_keywords() -> &'static Vec<(String, Regex)> {
    static CACHE: OnceLock<Vec<(String, Regex)>> = OnceLock::new();
    CACHE.get_or_init(|| {
        KEYWORDS
            .iter()
            .map(|k| (k.canonical.to_string(), Regex::new(k.pattern).unwrap()))
            .collect()
    })
}

fn lenient_warn(keyword: &str) -> bool {
    matches!(
        keyword,
        "SHOULD" | "SHOULD NOT" | "MAY" | "RECOMMENDED" | "OPTIONAL"
    )
}

fn severity_for(profile: Rfc2119Profile, keyword: &str) -> Rfc2119Severity {
    if profile == Rfc2119Profile::Lenient && lenient_warn(keyword) {
        Rfc2119Severity::Warning
    } else {
        Rfc2119Severity::Error
    }
}

fn suggestion_for(keyword: &str) -> String {
    format!("use uppercase {keyword} or rephrase to avoid RFC 2119 keywords")
}

/// Mask markdown fenced and inline code by replacing them with same-length
/// runs of spaces. Same-length preserves line/column offsets.
fn mask_code(body: &str) -> String {
    let fence_re = Regex::new(r"^\s*```").unwrap();
    let inline_re = Regex::new(r"`[^`]*`").unwrap();
    let mut in_fence = false;
    let mut out: Vec<String> = Vec::new();
    for line in body.split('\n') {
        // Trim trailing \r so CRLF line endings produce the same width as on Unix.
        let line_trimmed = line.trim_end_matches('\r');
        if fence_re.is_match(line_trimmed) {
            in_fence = !in_fence;
            out.push(" ".repeat(line_trimmed.chars().count()));
            continue;
        }
        if in_fence {
            out.push(" ".repeat(line_trimmed.chars().count()));
            continue;
        }
        // Replace inline `…` with same-width spaces.
        let masked = inline_re.replace_all(line_trimmed, |caps: &regex::Captures| {
            " ".repeat(caps[0].chars().count())
        });
        out.push(masked.into_owned());
    }
    out.join("\n")
}

/// Validate `body` against the chosen profile. See module header.
pub fn validate_rfc2119(body: &str, profile: Rfc2119Profile) -> Rfc2119Result {
    if profile == Rfc2119Profile::Off {
        return Rfc2119Result {
            profile,
            violations: Vec::new(),
        };
    }

    let masked = mask_code(body);
    let lines: Vec<&str> = masked.split('\n').collect();
    let mut violations: Vec<Rfc2119Violation> = Vec::new();
    // line index -> set of starting columns already claimed by a longer keyword.
    let mut claimed: HashMap<usize, HashSet<usize>> = HashMap::new();

    for (canonical, re) in compiled_keywords().iter() {
        for (i, line) in lines.iter().enumerate() {
            for m in re.find_iter(line) {
                // Skip ALL-CAPS occurrences — those are correct usage.
                if m.as_str() == canonical {
                    continue;
                }
                let col = m.start();
                let entry = claimed.entry(i).or_default();
                let mut overlaps = false;
                for &c in entry.iter() {
                    // Same overlap window as TS: col within [c, c + len(keyword) + 1).
                    if col >= c && col < c + canonical.len() + 1 {
                        overlaps = true;
                        break;
                    }
                }
                if overlaps {
                    continue;
                }
                entry.insert(col);
                violations.push(Rfc2119Violation {
                    line: i + 1,
                    keyword: canonical.clone(),
                    matched_text: m.as_str().to_string(),
                    severity: severity_for(profile, canonical),
                    suggestion: suggestion_for(canonical),
                });
            }
        }
    }

    // Stable sort by line for reader-friendly output (TS uses the same).
    violations.sort_by_key(|v| v.line);

    Rfc2119Result { profile, violations }
}
