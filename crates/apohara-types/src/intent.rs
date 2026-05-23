//! Intent classification per G6.D.1 (Smart router, opt-in via `APOHARA_SMART_ROUTER=1`).
//!
//! Tags a single user prompt with one of 8 categories so the Coordinator
//! can route it to the most appropriate provider (e.g. Implement →
//! `claude-code-cli`, Refactor → `codex-cli`, Explain → `opencode-go`).
//!
//! `#[derive(TS)]` so the same enum is exposed to the TS side via the
//! ts-rs SSoT (§0.7) — `bun run generate-types` regenerates
//! `packages/apohara-shared/types.ts`. NEVER hand-edit that file.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS, PartialOrd, Ord)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum Intent {
    Implement,
    Refactor,
    Debug,
    Document,
    Test,
    Explain,
    Review,
    Other,
}

impl Intent {
    pub fn all() -> &'static [Intent] {
        &[
            Intent::Implement,
            Intent::Refactor,
            Intent::Debug,
            Intent::Document,
            Intent::Test,
            Intent::Explain,
            Intent::Review,
            Intent::Other,
        ]
    }

    /// Snake-case wire name — kept in sync with `#[serde(rename_all)]`.
    pub fn as_str(self) -> &'static str {
        match self {
            Intent::Implement => "implement",
            Intent::Refactor => "refactor",
            Intent::Debug => "debug",
            Intent::Document => "document",
            Intent::Test => "test",
            Intent::Explain => "explain",
            Intent::Review => "review",
            Intent::Other => "other",
        }
    }

    pub fn parse(s: &str) -> Option<Intent> {
        match s {
            "implement" => Some(Intent::Implement),
            "refactor" => Some(Intent::Refactor),
            "debug" => Some(Intent::Debug),
            "document" => Some(Intent::Document),
            "test" => Some(Intent::Test),
            "explain" => Some(Intent::Explain),
            "review" => Some(Intent::Review),
            "other" => Some(Intent::Other),
            _ => None,
        }
    }
}

/// Mapping from `Intent` to the default provider id used by the smart
/// router when `APOHARA_SMART_ROUTER=1`. Conservative defaults — the
/// roster is restricted to the 3 active CLIs per spec (claude-code-cli,
/// codex-cli, opencode-go). `Other` falls back to claude as the most
/// general-purpose provider.
pub fn default_provider_for(intent: Intent) -> &'static str {
    match intent {
        Intent::Implement => "claude-code-cli",
        Intent::Refactor => "codex-cli",
        Intent::Debug => "claude-code-cli",
        Intent::Document => "opencode-go",
        Intent::Test => "claude-code-cli",
        Intent::Explain => "opencode-go",
        Intent::Review => "codex-cli",
        Intent::Other => "claude-code-cli",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn all_eight_variants() {
        assert_eq!(Intent::all().len(), 8);
    }

    #[test]
    fn roundtrip_str() {
        for i in Intent::all() {
            assert_eq!(Intent::parse(i.as_str()), Some(*i));
        }
    }

    #[test]
    fn unknown_parse_is_none() {
        assert!(Intent::parse("nonsense").is_none());
        assert!(Intent::parse("").is_none());
    }

    #[test]
    fn serde_snake_case() {
        let s = serde_json::to_string(&Intent::Implement).unwrap();
        assert_eq!(s, "\"implement\"");
        let back: Intent = serde_json::from_str("\"refactor\"").unwrap();
        assert_eq!(back, Intent::Refactor);
    }

    #[test]
    fn default_provider_within_active_roster() {
        let allowed = ["claude-code-cli", "codex-cli", "opencode-go"];
        for i in Intent::all() {
            let p = default_provider_for(*i);
            assert!(allowed.contains(&p), "provider {} not in active roster", p);
        }
    }
}
