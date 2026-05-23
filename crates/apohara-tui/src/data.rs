//! Data adapters between TUI views and Apohara core crates.
//!
//! Each function here is the seam where view rendering meets the
//! Rust-native dispatch/token-accounting layer. The plan
//! (`docs/superpowers/plans/2026-05-23-apohara-catalyst-rust-phase-3-contextforge.md`
//! G3.A.6) calls for wiring `apohara_dispatch::list_active_providers()`
//! and `apohara_token_accounting::current_totals()`; neither helper
//! exists upstream yet, so this module hosts the parity stubs and a
//! TODO-back-add issue note. When the upstream helpers land, replace the
//! body of each adapter — the view side is already consuming them.
//!
//! TODO(catalyst-tracker): file issues against `apohara-dispatch` and
//! `apohara-token-accounting` to add the cross-cutting accessors the TUI
//! and other surfaces will share. Until then this module is the single
//! place to update once those helpers land.

use crate::views::agent_list::AgentSnapshot;
use crate::views::cost_table::CostRow;
use apohara_token_accounting::TokenCounter;

/// Currently-active providers in the roster. Mirrors the active list in
/// CLAUDE.md (`claude-code-cli`, `codex-cli`, `opencode-go`).
///
/// Future wiring: read from `apohara_dispatch::list_active_providers()`.
pub fn active_agents() -> Vec<AgentSnapshot> {
    let counter = TokenCounter::new();
    ["claude-code-cli", "codex-cli", "opencode-go"]
        .iter()
        .zip(["coder", "reviewer", "tester"])
        .map(|(id, role)| {
            let snap = counter.total_for_provider(id);
            AgentSnapshot {
                id: (*id).to_string(),
                role: role.to_string(),
                status: "ready".to_string(),
                tokens_in: snap.input,
                tokens_out: snap.output,
            }
        })
        .collect()
}

/// Per-provider cost rows. Future wiring: read from
/// `apohara_token_accounting::current_totals()` once it exposes
/// per-provider USD totals.
pub fn cost_rows() -> Vec<CostRow> {
    let counter = TokenCounter::new();
    ["claude-code-cli", "codex-cli", "opencode-go"]
        .iter()
        .map(|id| {
            let snap = counter.total_for_provider(id);
            CostRow {
                provider: (*id).to_string(),
                tokens_in: snap.input,
                tokens_out: snap.output,
                cost_usd: 0.0,
            }
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
        let agents = active_agents();
        for a in agents {
            assert_eq!(a.tokens_in, 0);
            assert_eq!(a.tokens_out, 0);
        }
    }
}
