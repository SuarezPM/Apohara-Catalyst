//! Per-run token aggregation, CLI-stream usage parsing, and budget throttle
//! (US-F2.4 — the data pipeline behind the utilization dashboard).
//!
//! Three pure pieces, all unit-testable without a live blade:
//!   * [`parse_usage_snapshot`] — pull a cumulative [`TokenSnapshot`] out of a
//!     CLI stream line so the dispatch loop can feed `record_absolute` (today
//!     nothing parses usage, so `current_totals` is always zero).
//!   * [`RunLedger`] — the per-run dimension [`crate::counter::TokenCounter`]
//!     lacks: tokens-per-run, keyed by run id, absolute-not-delta (§0.14).
//!   * [`decide_throttle`] — the Escenario-4 spawn throttle: hold new spawns
//!     once spend reaches the configured daily budget.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

use crate::counter::TokenSnapshot;

/// Pull a cumulative [`TokenSnapshot`] out of an already-parsed JSON value.
/// `usage` may be nested (claude `{"usage":{...}}`) or the object itself may
/// carry the fields (flat codex/opencode variants). Requires at least one of
/// `input_tokens`/`output_tokens` — otherwise `None`.
///
/// ASSUMES the counts are CUMULATIVE (the caller `record_absolute`s = replace).
/// Verified for claude (message_delta/result). codex/opencode are assumed
/// cumulative too — verify per upstream release; if either emits INCREMENTAL
/// usage, that provider would need an accumulator instead of replace.
fn snapshot_from_value(v: &serde_json::Value) -> Option<TokenSnapshot> {
    let u = v.get("usage").unwrap_or(v);
    let input = u.get("input_tokens").and_then(serde_json::Value::as_u64);
    let output = u.get("output_tokens").and_then(serde_json::Value::as_u64);
    if input.is_none() && output.is_none() {
        return None;
    }
    Some(TokenSnapshot {
        input: input.unwrap_or(0),
        output: output.unwrap_or(0),
        cache_creation: u
            .get("cache_creation_input_tokens")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0),
        cache_read: u
            .get("cache_read_input_tokens")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0),
    })
}

/// Parse a single CLI stream line for a cumulative usage snapshot.
///
/// Recognizes the Anthropic/Claude `stream-json` shape
/// `{"usage":{"input_tokens":N,"output_tokens":M,...}}` as well as a flat
/// top-level `{"input_tokens":N,...}` (codex/opencode variants). A line with
/// no `input_tokens`/`output_tokens` (plain text, control frames) yields
/// `None`, so the caller can blindly try every streamed line. Cache fields are
/// optional and default to 0.
///
/// Snapshots are CUMULATIVE per the provider contract, so the caller feeds
/// them to `record_absolute` (replace, not add) — matching §0.14.
pub fn parse_usage_snapshot(line: &str) -> Option<TokenSnapshot> {
    let v: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    snapshot_from_value(&v)
}

/// US-S4 — which provider's stream a line belongs to, for [`parse_line`].
///
/// This is an OWN enum, deliberately NOT `apohara_dispatch::ProviderKind`:
/// `apohara-token-accounting` is a LEAF crate (zero `apohara-*` deps) imported
/// by dispatch / desktop / verification / tui. Importing `apohara-dispatch`
/// here would INVERT the dep-graph (dispatch → token-accounting, never the
/// reverse) and cycle. The caller (apohara-dispatch / desktop) maps its
/// `ProviderKind` → this discriminant.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamDialect {
    Claude,
    Codex,
    Opencode,
}

impl StreamDialect {
    /// Map a roster id to its stream dialect. `None` for an unknown/legacy id.
    pub fn from_roster_id(id: &str) -> Option<Self> {
        match id {
            "claude-code-cli" => Some(Self::Claude),
            "codex-cli" => Some(Self::Codex),
            "opencode-go" => Some(Self::Opencode),
            _ => None,
        }
    }
}

/// US-S4 — a parsed CLI stream line. Every field is optional: a line that does
/// not match (plain text, control frame, non-JSON) yields an all-`None`
/// `ParsedLine` and NEVER panics, so the caller can blindly feed every line.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ParsedLine {
    /// Cumulative usage snapshot, if this line carried token counts.
    pub usage: Option<TokenSnapshot>,
    /// Terminal turn outcome: `Some(true)` = success result, `Some(false)` =
    /// error result (claude `{"type":"result","is_error":true}`). `None` when
    /// the line is not a terminal marker — dispatch success then rests on the
    /// process exit code (US-S3).
    pub terminal_success: Option<bool>,
    /// Session id announced by the line (claude `system`/`result`), if any.
    /// Scaffolding for resume/reconnect (a future story); not consumed by the
    /// dispatch loop yet.
    pub session_id: Option<String>,
}

/// US-S4 — parse one CLI stream line per the provider `dialect`. PURE and TOTAL:
/// any line that isn't recognized (non-JSON, plain text, control frame) yields
/// `ParsedLine::default()` — never a panic. `success` for the whole dispatch is
/// the process exit code (US-S3) AND the absence of a terminal `is_error`.
pub fn parse_line(dialect: StreamDialect, line: &str) -> ParsedLine {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) else {
        return ParsedLine::default();
    };
    match dialect {
        StreamDialect::Claude => {
            let ty = v.get("type").and_then(serde_json::Value::as_str);
            let terminal_success = if ty == Some("result") {
                // A `result` is the terminal marker. FAIL-CLOSED: `is_error`
                // absent → success; present-and-literal-`false` → success;
                // anything else (true, or a mistyped string/number) → failure.
                // A mistyped is_error must NOT pass as success.
                let is_error = match v.get("is_error") {
                    None => false,
                    Some(e) => e.as_bool() != Some(false),
                };
                Some(!is_error)
            } else {
                None
            };
            ParsedLine {
                usage: snapshot_from_value(&v),
                terminal_success,
                session_id: v
                    .get("session_id")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string),
            }
        }
        // codex/opencode emit JSON events; usage (when present) rides the same
        // nested/flat shape. No claude-style terminal marker — exit code decides.
        StreamDialect::Codex | StreamDialect::Opencode => ParsedLine {
            usage: snapshot_from_value(&v),
            ..Default::default()
        },
    }
}

/// Per-run token aggregation: the run dimension [`crate::counter::TokenCounter`]
/// (keyed by provider/thread) does not carry. Absolute-not-delta — recording a
/// run's snapshot REPLACES the prior one, so replays/reconnects stay idempotent.
#[derive(Default, Debug)]
pub struct RunLedger {
    runs: HashMap<String, TokenSnapshot>,
}

impl RunLedger {
    pub fn new() -> Self {
        Self::default()
    }

    /// Record the cumulative snapshot for `run_id` (replace, §0.14).
    pub fn record_absolute(&mut self, run_id: &str, snap: TokenSnapshot) {
        self.runs.insert(run_id.to_string(), snap);
    }

    /// Tokens for one run (zero if the run never recorded).
    pub fn total_for_run(&self, run_id: &str) -> TokenSnapshot {
        self.runs.get(run_id).cloned().unwrap_or_default()
    }

    /// Sum across every run.
    pub fn total(&self) -> TokenSnapshot {
        self.runs
            .values()
            .fold(TokenSnapshot::default(), |acc, s| acc.add(s))
    }

    /// Number of runs recorded.
    pub fn run_count(&self) -> usize {
        self.runs.len()
    }
}

/// Spawn-throttle verdict for the Escenario-4 budget cap.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "decision", rename_all = "snake_case")]
pub enum ThrottleDecision {
    /// Under budget (or no cap configured) — new spawns allowed.
    Allow,
    /// Spend reached the cap — hold new spawns until the window resets.
    Throttle { spent_usd: f64, budget_usd: f64 },
}

impl ThrottleDecision {
    pub fn is_throttled(&self) -> bool {
        matches!(self, ThrottleDecision::Throttle { .. })
    }
}

/// Decide whether to throttle new blade spawns given `spent_usd` against the
/// configured `daily_budget_usd`. A budget `<= 0` means "no cap" (always
/// [`ThrottleDecision::Allow`]). Spend AT or ABOVE the budget throttles.
pub fn decide_throttle(spent_usd: f64, daily_budget_usd: f64) -> ThrottleDecision {
    if daily_budget_usd <= 0.0 || spent_usd < daily_budget_usd {
        ThrottleDecision::Allow
    } else {
        ThrottleDecision::Throttle {
            spent_usd,
            budget_usd: daily_budget_usd,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_nested_claude_usage() {
        let line = r#"{"type":"message_delta","usage":{"input_tokens":1200,"output_tokens":340,"cache_read_input_tokens":900}}"#;
        let snap = parse_usage_snapshot(line).expect("usage present");
        assert_eq!(snap.input, 1200);
        assert_eq!(snap.output, 340);
        assert_eq!(snap.cache_read, 900);
        assert_eq!(snap.cache_creation, 0);
    }

    #[test]
    fn parses_flat_top_level_usage() {
        let line = r#"{"input_tokens":50,"output_tokens":10}"#;
        let snap = parse_usage_snapshot(line).expect("usage present");
        assert_eq!(snap.input, 50);
        assert_eq!(snap.output, 10);
    }

    #[test]
    fn non_usage_line_yields_none() {
        assert!(parse_usage_snapshot("plain text, not json").is_none());
        assert!(parse_usage_snapshot(r#"{"type":"text","text":"hello"}"#).is_none());
    }

    #[test]
    fn run_ledger_is_absolute_not_delta() {
        let mut ledger = RunLedger::new();
        ledger.record_absolute(
            "run-1",
            TokenSnapshot { input: 100, output: 20, cache_creation: 0, cache_read: 0 },
        );
        // A later cumulative snapshot REPLACES (does not add).
        ledger.record_absolute(
            "run-1",
            TokenSnapshot { input: 250, output: 60, cache_creation: 0, cache_read: 0 },
        );
        assert_eq!(ledger.total_for_run("run-1").input, 250);
        assert_eq!(ledger.total_for_run("run-1").output, 60);
        assert_eq!(ledger.run_count(), 1);
    }

    #[test]
    fn run_ledger_totals_across_runs() {
        let mut ledger = RunLedger::new();
        ledger.record_absolute("run-1", TokenSnapshot { input: 100, output: 20, cache_creation: 0, cache_read: 0 });
        ledger.record_absolute("run-2", TokenSnapshot { input: 5, output: 1, cache_creation: 0, cache_read: 0 });
        assert_eq!(ledger.total().input, 105);
        assert_eq!(ledger.total().output, 21);
        assert_eq!(ledger.total_for_run("missing"), TokenSnapshot::default());
    }

    #[test]
    fn throttle_allows_under_budget_and_no_cap() {
        assert_eq!(decide_throttle(5.0, 10.0), ThrottleDecision::Allow);
        // No cap configured (<=0) → always allow.
        assert_eq!(decide_throttle(999.0, 0.0), ThrottleDecision::Allow);
    }

    #[test]
    fn throttle_fires_at_or_above_budget() {
        let d = decide_throttle(10.0, 10.0);
        assert!(d.is_throttled(), "spend == budget must throttle");
        let d2 = decide_throttle(12.5, 10.0);
        assert_eq!(
            d2,
            ThrottleDecision::Throttle { spent_usd: 12.5, budget_usd: 10.0 }
        );
    }

    // ===== US-S4 — per-provider line parsing =====

    #[test]
    fn stream_dialect_from_roster_id_maps_active_providers() {
        assert_eq!(
            StreamDialect::from_roster_id("claude-code-cli"),
            Some(StreamDialect::Claude)
        );
        assert_eq!(
            StreamDialect::from_roster_id("codex-cli"),
            Some(StreamDialect::Codex)
        );
        assert_eq!(
            StreamDialect::from_roster_id("opencode-go"),
            Some(StreamDialect::Opencode)
        );
        assert_eq!(StreamDialect::from_roster_id("gemini"), None);
    }

    #[test]
    fn parse_line_claude_result_is_error_is_terminal_failure() {
        // Fixture: a claude stream-json terminal `result` frame with is_error.
        let line = r#"{"type":"result","subtype":"error","is_error":true,"session_id":"sess-9"}"#;
        let p = parse_line(StreamDialect::Claude, line);
        assert_eq!(p.terminal_success, Some(false));
        assert_eq!(p.session_id.as_deref(), Some("sess-9"));
    }

    #[test]
    fn parse_line_claude_result_ok_is_terminal_success_with_usage() {
        let line = r#"{"type":"result","is_error":false,"usage":{"input_tokens":12,"output_tokens":3}}"#;
        let p = parse_line(StreamDialect::Claude, line);
        assert_eq!(p.terminal_success, Some(true));
        let u = p.usage.expect("result carried usage");
        assert_eq!(u.input, 12);
        assert_eq!(u.output, 3);
    }

    #[test]
    fn parse_line_claude_system_announces_session() {
        let line = r#"{"type":"system","subtype":"init","session_id":"sess-1"}"#;
        let p = parse_line(StreamDialect::Claude, line);
        assert_eq!(p.session_id.as_deref(), Some("sess-1"));
        // A system init is not a terminal marker.
        assert_eq!(p.terminal_success, None);
    }

    #[test]
    fn parse_line_claude_assistant_usage_no_terminal() {
        let line = r#"{"type":"assistant","message":{"usage":{"input_tokens":100,"output_tokens":40}}}"#;
        let p = parse_line(StreamDialect::Claude, line);
        // usage nested under message is NOT at the top-level `usage` key, so a
        // bare assistant frame without a top-level usage yields no snapshot here
        // — the cumulative usage rides the message_delta/result frames.
        assert_eq!(p.terminal_success, None);
        assert_eq!(p.usage, None);
    }

    // US-S4 (robustness): a mistyped `is_error` (string/number instead of bool)
    // in a terminal result must FAIL-CLOSED — never silently pass as success.
    #[test]
    fn parse_line_claude_result_mistyped_is_error_fails_closed() {
        let p = parse_line(
            StreamDialect::Claude,
            r#"{"type":"result","is_error":"true"}"#,
        );
        assert_eq!(p.terminal_success, Some(false), "string is_error → failure");
        let p2 = parse_line(StreamDialect::Claude, r#"{"type":"result","is_error":1}"#);
        assert_eq!(p2.terminal_success, Some(false), "numeric is_error → failure");
        // Literal false is still a success result.
        let p3 = parse_line(StreamDialect::Claude, r#"{"type":"result","is_error":false}"#);
        assert_eq!(p3.terminal_success, Some(true));
    }

    #[test]
    fn parse_line_codex_flat_usage() {
        let line = r#"{"type":"token_count","input_tokens":50,"output_tokens":10}"#;
        let p = parse_line(StreamDialect::Codex, line);
        let u = p.usage.expect("flat usage present");
        assert_eq!(u.input, 50);
        assert_eq!(u.output, 10);
        // codex has no claude-style terminal marker.
        assert_eq!(p.terminal_success, None);
    }

    #[test]
    fn parse_line_non_json_or_text_is_all_none() {
        for d in [
            StreamDialect::Claude,
            StreamDialect::Codex,
            StreamDialect::Opencode,
        ] {
            assert_eq!(parse_line(d, "not json at all"), ParsedLine::default());
            assert_eq!(
                parse_line(d, r#"{"type":"text","text":"hello"}"#),
                ParsedLine::default()
            );
        }
    }
}
