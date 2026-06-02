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
    // `usage` may be nested (claude) or the object itself may carry the fields.
    let u = v.get("usage").unwrap_or(&v);
    let input = u.get("input_tokens").and_then(serde_json::Value::as_u64);
    let output = u.get("output_tokens").and_then(serde_json::Value::as_u64);
    // Require at least one token field to treat this as a usage line.
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
}
