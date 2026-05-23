//! Apohara TUI — ratatui-based terminal UI.
//!
//! Replaces `packages/tui/` (TS Ink) deleted in Phase 2 G2.D.4.
//! Parity-of-intent: Dashboard + AgentList + CostTable + minimal config
//! wizard. Wiring to live data via `apohara-dispatch` and
//! `apohara-token-accounting`.

mod state;
mod views;

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::prelude::*;
use std::io;

use state::{AppState, View};
use views::{agent_list, config_wizard, cost_table, dashboard};

fn main() -> Result<()> {
    tracing_subscriber::fmt::init();

    enable_raw_mode()?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen, EnableMouseCapture)?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;

    let res = run_app(&mut terminal);

    disable_raw_mode()?;
    execute!(
        terminal.backend_mut(),
        LeaveAlternateScreen,
        DisableMouseCapture
    )?;
    terminal.show_cursor()?;

    res
}

fn run_app<B: Backend>(terminal: &mut Terminal<B>) -> Result<()> {
    let mut state = AppState::new();
    while state.running {
        terminal.draw(|f| match state.current_view {
            View::Dashboard => dashboard::render(&state, f),
            View::AgentList => agent_list::render(&state, f),
            View::CostTable => cost_table::render(&state, f),
            View::ConfigWizard => config_wizard::render(&state, f),
        })?;

        if let Event::Key(key) = event::read()? {
            match key.code {
                KeyCode::Char('q') => state.quit(),
                KeyCode::Char('a') => state.go(View::AgentList),
                KeyCode::Char('c') => state.go(View::CostTable),
                KeyCode::Char('w') => state.go(View::ConfigWizard),
                KeyCode::Esc => state.go(View::Dashboard),
                _ => {}
            }
        }
    }
    Ok(())
}
