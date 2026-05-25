//! Direct API surface for token totals consumed by the desktop Statusline
//! (W3.D.4) and the TUI cost table (W1.C.2).
//!
//! Aggregates the process-global [`TokenCounter`] over the active provider
//! roster. `cost_usd` is carried for the UI but stays `0.0` until a pricing
//! model lands — no pricing table exists yet and the current surfaces already
//! render it as a placeholder. Token counts are exact; cost is future work.

use std::sync::{Mutex, OnceLock};

use serde::{Deserialize, Serialize};

use crate::counter::{TokenCounter, TokenSnapshot};

/// The active provider roster (Pablo's hard rule). LEGACY providers
/// (`APOHARA_LEGACY_PROVIDERS=1`) are intentionally excluded.
const ACTIVE_PROVIDER_IDS: [&str; 3] = ["claude-code-cli", "codex-cli", "opencode-go"];

/// Per-provider totals rolled up across all of that provider's threads.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ProviderTotals {
    pub provider_id: String,
    pub tokens_in: u64,
    pub tokens_out: u64,
    /// USD cost. `0.0` until a pricing model is added; token counts are exact.
    pub cost_usd: f64,
}

/// Top-level totals plus the per-provider breakdown for the active roster.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TokenTotals {
    pub total_in: u64,
    pub total_out: u64,
    pub total_cost_usd: f64,
    pub per_provider: Vec<ProviderTotals>,
}

/// Process-global counter. The dispatch loop records absolute snapshots into
/// it (W4) and the Statusline/TUI poll [`current_totals`] off it.
fn global_counter() -> &'static Mutex<TokenCounter> {
    static COUNTER: OnceLock<Mutex<TokenCounter>> = OnceLock::new();
    COUNTER.get_or_init(|| Mutex::new(TokenCounter::new()))
}

/// Record an absolute token snapshot for `(provider_id, thread_id)` into the
/// process-global counter. Thin pass-through to
/// [`TokenCounter::record_absolute`] — absolute-not-delta semantics (§0.14)
/// are preserved, so replays/reconnects stay idempotent.
pub fn record_absolute(provider_id: &str, thread_id: &str, snap: TokenSnapshot) {
    global_counter()
        .lock()
        .expect("token counter mutex poisoned")
        .record_absolute(provider_id, thread_id, snap);
}

/// Aggregate one counter into roster totals. Pure — factored out so it can be
/// tested deterministically against a fresh counter, independent of the global.
fn aggregate(counter: &TokenCounter) -> TokenTotals {
    let per_provider: Vec<ProviderTotals> = ACTIVE_PROVIDER_IDS
        .iter()
        .map(|id| {
            let s = counter.total_for_provider(id);
            ProviderTotals {
                provider_id: (*id).to_string(),
                tokens_in: s.input,
                tokens_out: s.output,
                cost_usd: 0.0,
            }
        })
        .collect();
    TokenTotals {
        total_in: per_provider.iter().map(|p| p.tokens_in).sum(),
        total_out: per_provider.iter().map(|p| p.tokens_out).sum(),
        total_cost_usd: per_provider.iter().map(|p| p.cost_usd).sum(),
        per_provider,
    }
}

/// Current roster token totals from the process-global counter. Polled by the
/// desktop Statusline (W3.D.4) and consumed by the TUI cost table (W1.C.2).
pub fn current_totals() -> TokenTotals {
    aggregate(&global_counter().lock().expect("token counter mutex poisoned"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aggregate_empty_counter_is_zero_with_three_rows() {
        let totals = aggregate(&TokenCounter::new());
        assert_eq!(totals.per_provider.len(), 3);
        assert_eq!(totals.total_in, 0);
        assert_eq!(totals.total_out, 0);
        assert_eq!(totals.total_cost_usd, 0.0);
        let ids: Vec<&str> = totals
            .per_provider
            .iter()
            .map(|p| p.provider_id.as_str())
            .collect();
        assert_eq!(ids, vec!["claude-code-cli", "codex-cli", "opencode-go"]);
    }

    #[test]
    fn aggregate_sums_tokens_across_threads_of_a_provider() {
        let mut counter = TokenCounter::new();
        counter.record_absolute(
            "claude-code-cli",
            "t1",
            TokenSnapshot {
                input: 100,
                output: 50,
                cache_creation: 0,
                cache_read: 0,
            },
        );
        counter.record_absolute(
            "claude-code-cli",
            "t2",
            TokenSnapshot {
                input: 10,
                output: 5,
                cache_creation: 0,
                cache_read: 0,
            },
        );
        let totals = aggregate(&counter);
        let claude = totals
            .per_provider
            .iter()
            .find(|p| p.provider_id == "claude-code-cli")
            .unwrap();
        assert_eq!(claude.tokens_in, 110);
        assert_eq!(claude.tokens_out, 55);
        assert_eq!(totals.total_in, 110);
        assert_eq!(totals.total_out, 55);
    }

    #[test]
    fn current_totals_exposes_three_active_rows() {
        // Reads the process-global counter; assert structure only — other tests
        // may have recorded into the global, so we don't assert exact zero here.
        let totals = current_totals();
        assert_eq!(totals.per_provider.len(), 3);
        let ids: Vec<&str> = totals
            .per_provider
            .iter()
            .map(|p| p.provider_id.as_str())
            .collect();
        assert_eq!(ids, vec!["claude-code-cli", "codex-cli", "opencode-go"]);
    }
}
