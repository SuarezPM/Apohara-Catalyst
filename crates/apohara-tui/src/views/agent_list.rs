//! AgentList view — shows active providers + per-thread token totals.
//!
//! The data source is a sync stub for now; G3.A.6 swaps it with
//! `apohara-dispatch::list_active_providers()` once that helper lands
//! upstream.

use crate::state::AppState;
use ratatui::{prelude::*, widgets::*};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentSnapshot {
    pub id: String,
    pub role: String,
    pub status: String,
    pub tokens_in: u64,
    pub tokens_out: u64,
}

pub fn format_agent_row(snap: &AgentSnapshot) -> String {
    format!(
        "{:16} {:8} {:8} in:{:>8} out:{:>8}",
        snap.id, snap.role, snap.status, snap.tokens_in, snap.tokens_out
    )
}

pub fn render(_state: &AppState, frame: &mut Frame) {
    let agents = fetch_active_agents();

    let items: Vec<ListItem> = agents
        .iter()
        .map(|a| ListItem::new(format_agent_row(a)))
        .collect();

    let list = List::new(items)
        .block(
            Block::default()
                .title("Active Agents")
                .borders(Borders::ALL),
        )
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED));

    frame.render_widget(list, frame.area());
}

/// Stub returning the three active roster providers (per CLAUDE.md). Real
/// wiring (G3.A.6) reads from `apohara-dispatch`; when that API does not
/// yet exist upstream, the stub keeps the UI honest.
fn fetch_active_agents() -> Vec<AgentSnapshot> {
    vec![
        AgentSnapshot {
            id: "claude-code-cli".into(),
            role: "coder".into(),
            status: "ready".into(),
            tokens_in: 0,
            tokens_out: 0,
        },
        AgentSnapshot {
            id: "codex-cli".into(),
            role: "reviewer".into(),
            status: "ready".into(),
            tokens_in: 0,
            tokens_out: 0,
        },
        AgentSnapshot {
            id: "opencode-go".into(),
            role: "tester".into(),
            status: "ready".into(),
            tokens_in: 0,
            tokens_out: 0,
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn format_agent_row_includes_id_role_and_status() {
        let snap = AgentSnapshot {
            id: "claude-1".into(),
            role: "coder".into(),
            status: "ready".into(),
            tokens_in: 12345,
            tokens_out: 6789,
        };
        let row = format_agent_row(&snap);
        assert!(row.contains("claude-1"));
        assert!(row.contains("coder"));
        assert!(row.contains("ready"));
        assert!(row.contains("12345"));
        assert!(row.contains("6789"));
    }

    #[test]
    fn fetch_active_agents_returns_three_active_roster_providers() {
        let agents = fetch_active_agents();
        assert_eq!(agents.len(), 3);
        let ids: Vec<&str> = agents.iter().map(|a| a.id.as_str()).collect();
        assert!(ids.contains(&"claude-code-cli"));
        assert!(ids.contains(&"codex-cli"));
        assert!(ids.contains(&"opencode-go"));
    }
}
