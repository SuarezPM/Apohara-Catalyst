//! Data adapters between TUI views and Apohara core crates.
//!
//! Each function here is the seam where view rendering meets the Rust-native
//! dispatch/token-accounting layer: `active_agents` reads the live provider
//! roster from `apohara_dispatch::api::list_active_providers()` and overlays
//! per-provider token totals from
//! `apohara_token_accounting::api::current_totals()`; `cost_rows` reads the
//! same token totals for the cost table.

use crate::views::agent_list::AgentSnapshot;
use crate::views::cost_table::CostRow;
use apohara_dispatch::api::list_active_providers;
use apohara_token_accounting::api::current_totals;

/// Display role per active provider. The roster carries no role of its own, so
/// this is a stable display label keyed by provider id.
fn display_role(provider_id: &str) -> &'static str {
    match provider_id {
        "claude-code-cli" => "coder",
        "codex-cli" => "reviewer",
        "opencode-go" => "tester",
        _ => "agent",
    }
}

/// Currently-active providers in the roster, with availability resolved from
/// `PATH` (via `list_active_providers`) and token totals from the
/// process-global accounting counter.
pub fn active_agents() -> Vec<AgentSnapshot> {
    let totals = current_totals();
    list_active_providers()
        .into_iter()
        .map(|p| {
            let tokens = totals.per_provider.iter().find(|t| t.provider_id == p.id);
            AgentSnapshot {
                role: display_role(&p.id).to_string(),
                status: if p.available { "ready" } else { "unavailable" }.to_string(),
                tokens_in: tokens.map(|t| t.tokens_in).unwrap_or(0),
                tokens_out: tokens.map(|t| t.tokens_out).unwrap_or(0),
                id: p.id,
            }
        })
        .collect()
}

/// Per-provider cost rows from `current_totals()`. `cost_usd` is `0.0` until a
/// pricing model lands (see `apohara_token_accounting::api`).
pub fn cost_rows() -> Vec<CostRow> {
    current_totals()
        .per_provider
        .into_iter()
        .map(|t| CostRow {
            provider: t.provider_id,
            tokens_in: t.tokens_in,
            tokens_out: t.tokens_out,
            cost_usd: t.cost_usd,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_agents_covers_three_active_roster_providers() {
        let agents = active_agents();
        assert_eq!(agents.len(), 3);
        let ids: Vec<&str> = agents.iter().map(|a| a.id.as_str()).collect();
        assert!(ids.contains(&"claude-code-cli"));
        assert!(ids.contains(&"codex-cli"));
        assert!(ids.contains(&"opencode-go"));
    }

    #[test]
    fn cost_rows_match_active_roster() {
        let rows = cost_rows();
        assert_eq!(rows.len(), 3);
    }

    #[test]
    fn empty_counter_yields_zero_tokens() {
        // current_totals() reads the process-global counter, which no other
        // test in this binary records into, so totals are zero here.
        let agents = active_agents();
        for a in agents {
            assert_eq!(a.tokens_in, 0);
            assert_eq!(a.tokens_out, 0);
        }
    }
}
