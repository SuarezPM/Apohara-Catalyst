//! Pattern validator — ports `src/core/safety/patternValidator.ts`.
//!
//! LLM output occasionally bleeds code fragments into permission strings
//! (`Bash(const:*)`, `Bash(```:*)`, etc.). Reject these at the boundary so
//! they never reach the permission cache or settings files.

use regex::Regex;
use std::sync::OnceLock;

static GARBAGE: OnceLock<Vec<Regex>> = OnceLock::new();
static SHAPE: OnceLock<Regex> = OnceLock::new();

fn garbage() -> &'static [Regex] {
    GARBAGE
        .get_or_init(|| {
            [
                r"^Bash\(const:",
                r"^Bash\(\[\]:",
                r"^Bash\(//:",
                r"^Bash\(```:",
                r"^Bash\(import:",
                r"^Bash\(function:",
                r"^Bash\(class:",
                r"^Bash\(export:",
                r"^Bash\(let:",
                r"^Bash\(var:",
            ]
            .iter()
            .map(|p| Regex::new(p).expect("static garbage regex compiles"))
            .collect()
        })
        .as_slice()
}

fn shape() -> &'static Regex {
    SHAPE.get_or_init(|| {
        Regex::new(r"^(Bash|WebFetch|Edit|Write|Read|Glob|mcp__[a-z_-]+__[a-z_-]+)(\(.+\))?$")
            .expect("static shape regex compiles")
    })
}

/// True iff `s` is a valid permission pattern string (passes the
/// garbage-LLM-output reject list and the shape regex).
pub fn is_valid_pattern(s: &str) -> bool {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return false;
    }
    if garbage().iter().any(|re| re.is_match(trimmed)) {
        return false;
    }
    shape().is_match(trimmed)
}
