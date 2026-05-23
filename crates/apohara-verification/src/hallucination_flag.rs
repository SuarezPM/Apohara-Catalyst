//! chorus H6 — post-spawn cheap detection of hallucinations.
//!
//! Direct port of `src/core/verification/hallucinationFlag.ts`. Two
//! classes of red flags caught here:
//!
//!   1. Imports of relative modules that do not resolve on disk.
//!   2. Calls to identifiers that are not in the `defined_symbols` set
//!      (when provided).
//!
//! Heuristic only — full type-checking is `tsc --noEmit`; this exists
//! to provide a fast red-flag signal to the critic role before invoking
//! the expensive tooling. False negatives are acceptable; false
//! positives should be rare so the critic does not learn to ignore the
//! signal.
//!
//! Notes on the regex layer:
//!
//!   * The import regex captures the module specifier from
//!     `import ... from "spec"`, `import "spec"`, single or double
//!     quotes.
//!   * The call regex matches `Identifier(` calls. `import(` and
//!     `require(` are explicitly excluded — they are syntax/builtin,
//!     not "symbols a user might fail to define."
//!   * The Rust `regex` crate does not support lookbehind. We emulate
//!     the TS `(?<![.\w])` guard with an explicit byte check on the
//!     character immediately before each match (and treat
//!     start-of-string as "not preceded by `.` or word char").

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use regex::Regex;
use serde::{Deserialize, Serialize};

/// Inputs to [`detect_hallucinations`]. Mirrors the TS `DetectArgs`
/// interface; `defined_symbols` is optional so callers can opt out of
/// the symbol-call check (TS passes `undefined` for the same effect).
#[derive(Debug, Clone)]
pub struct DetectArgs<'a> {
    pub code: &'a str,
    pub existing_files: &'a [PathBuf],
    pub workspace_path: &'a Path,
    pub defined_symbols: Option<&'a HashSet<String>>,
}

/// Output of [`detect_hallucinations`]. The TS port returns `string[]`
/// — we wrap it so future extensions (severities, ranges) don't break
/// the wire contract.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct DetectResult {
    pub hallucinations: Vec<String>,
}

fn import_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    // Matches:  import x from "spec"   /   import "spec"   (any whitespace).
    // The `(?:[\w*{},\s]+?\s+from\s+)?` group is optional so bare
    // side-effect imports (`import "polyfill"`) still match. The
    // specifier itself is captured in group 1.
    R.get_or_init(|| {
        Regex::new(r#"import\s+(?:[\w*{},\s]+?\s+from\s+)?["']([^"']+)["']"#).unwrap()
    })
}

fn call_regex() -> &'static Regex {
    static R: OnceLock<Regex> = OnceLock::new();
    // Capture the identifier in group 1. Lookbehind unsupported — we
    // filter member-access calls in code below.
    R.get_or_init(|| Regex::new(r"([A-Za-z_][A-Za-z0-9_]*)\s*\(").unwrap())
}

/// Run both red-flag checks and collect findings. Empty result =
/// nothing suspicious (the caller still has to run real type
/// checkers).
pub fn detect_hallucinations(args: &DetectArgs<'_>) -> DetectResult {
    let mut out: Vec<String> = Vec::new();

    // ---- 1. Imports of relative paths -----------------------------------
    for caps in import_regex().captures_iter(args.code) {
        let spec = caps.get(1).unwrap().as_str();
        if !spec.starts_with('.') {
            continue;
        }
        let candidates = relative_candidates(args.workspace_path, spec);
        let is_real = candidates.iter().any(|c| args.existing_files.contains(c))
            || candidates.iter().any(|c| c.exists());
        if !is_real {
            out.push(spec.to_string());
        }
    }

    // ---- 2. Undefined symbol calls --------------------------------------
    if let Some(defined) = args.defined_symbols {
        let code = args.code;
        for caps in call_regex().captures_iter(code) {
            let m = caps.get(1).unwrap();
            // Emulate TS lookbehind `(?<![.\w])` — reject the match
            // when the byte immediately before it is `.` or a word
            // character (mid-identifier or member access).
            let start = m.start();
            if start > 0 {
                let prev = code.as_bytes()[start - 1];
                if prev == b'.' || prev.is_ascii_alphanumeric() || prev == b'_' {
                    continue;
                }
            }
            let sym = m.as_str();
            if sym == "import" || sym == "require" {
                continue;
            }
            if !defined.contains(sym) {
                out.push(sym.to_string());
            }
        }
    }

    DetectResult {
        hallucinations: out,
    }
}

/// Mirrors the TS candidate list: bare path, four file extensions,
/// then two `index.*` resolutions. Keeping the order identical so
/// `existing_files` lookups behave the same on both sides.
fn relative_candidates(workspace: &Path, spec: &str) -> Vec<PathBuf> {
    let base = workspace.join(spec);
    vec![
        base.clone(),
        workspace.join(format!("{spec}.ts")),
        workspace.join(format!("{spec}.tsx")),
        workspace.join(format!("{spec}.js")),
        workspace.join(format!("{spec}.mjs")),
        base.join("index.ts"),
        base.join("index.js"),
    ]
}
