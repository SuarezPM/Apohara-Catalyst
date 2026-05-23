//! CostTable view — per-provider cost accounting.
//!
//! USD formatting is `${:.2}` (two decimals). Source data is currently a
//! stub; G3.A.6 swaps it for `apohara-token-accounting::current_totals()`
//! once that helper lands upstream.

use crate::state::AppState;
use ratatui::{prelude::*, widgets::*};

#[derive(Debug, Clone, PartialEq)]
pub struct CostRow {
    pub provider: String,
    pub tokens_in: u64,
    pub tokens_out: u64,
    pub cost_usd: f64,
}

pub fn format_cost_row(provider: &str, tokens_in: u64, tokens_out: u64, cost_usd: f64) -> String {
    format!(
        "{:20} in:{:>8} out:{:>8} ${:.2}",
        provider, tokens_in, tokens_out, cost_usd
    )
}

pub fn render(_state: &AppState, frame: &mut Frame) {
    let rows = fetch_cost_rows();
    let items: Vec<ListItem> = rows
        .iter()
        .map(|r| ListItem::new(format_cost_row(&r.provider, r.tokens_in, r.tokens_out, r.cost_usd)))
        .collect();

    let list = List::new(items).block(
        Block::default()
            .title("Cost Accounting")
            .borders(Borders::ALL),
    );

    frame.render_widget(list, frame.area());
}

fn fetch_cost_rows() -> Vec<CostRow> {
    crate::data::cost_rows()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_cost_includes_usd_value() {
        let row = format_cost_row("claude-code-cli", 12345, 6789, 0.42);
        assert!(row.contains("claude-code-cli"));
        assert!(row.contains("$0.42"));
        assert!(row.contains("12345"));
        assert!(row.contains("6789"));
    }

    #[test]
    fn format_cost_rounds_to_two_decimals() {
        let row = format_cost_row("p", 0, 0, 1.23456);
        assert!(row.contains("$1.23"));
        assert!(!row.contains("$1.234"));
    }

    #[test]
    fn fetch_cost_rows_covers_active_roster() {
        let rows = fetch_cost_rows();
        assert_eq!(rows.len(), 3);
    }
}
