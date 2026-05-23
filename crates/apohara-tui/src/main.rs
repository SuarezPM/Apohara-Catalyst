//! Apohara TUI — ratatui-based terminal UI.
//!
//! Replaces `packages/tui/` (TS Ink) deleted in Phase 2 G2.D.4.
//! Parity-of-intent: Dashboard + AgentList + CostTable + minimal config
//! wizard. Wiring to live data via `apohara-dispatch` and
//! `apohara-token-accounting`.

use anyhow::Result;
use crossterm::{
    event::{self, DisableMouseCapture, EnableMouseCapture, Event, KeyCode},
    execute,
    terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen},
};
use ratatui::{prelude::*, widgets::*};
use std::io;

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
    loop {
        terminal.draw(|f| {
            let block = Block::default().title("Apohara TUI").borders(Borders::ALL);
            f.render_widget(block, f.area());
        })?;

        if let Event::Key(key) = event::read()? {
            if key.code == KeyCode::Char('q') {
                return Ok(());
            }
        }
    }
}
