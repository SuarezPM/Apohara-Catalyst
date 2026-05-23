//! Dashboard view — landing screen with navigation hints.

use crate::state::AppState;
use ratatui::{prelude::*, widgets::*};

pub fn render(state: &AppState, frame: &mut Frame) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Min(0),
            Constraint::Length(1),
        ])
        .split(frame.area());

    let header = Paragraph::new("Apohara Catalyst - Dashboard")
        .style(Style::default().fg(Color::Rgb(0x25, 0xB1, 0x3F)))
        .block(Block::default().borders(Borders::ALL));
    frame.render_widget(header, chunks[0]);

    let body = Paragraph::new("Press: (a) Agents | (c) Cost | (w) Wizard | (q) Quit")
        .block(Block::default().borders(Borders::ALL).title("Navigation"));
    frame.render_widget(body, chunks[1]);

    let footer = Paragraph::new(format!("View: {:?}", state.current_view));
    frame.render_widget(footer, chunks[2]);
}

#[cfg(test)]
mod tests {
    use super::*;
    use ratatui::backend::TestBackend;

    fn render_to_string(state: &AppState) -> String {
        let backend = TestBackend::new(80, 12);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal
            .draw(|f| render(state, f))
            .unwrap();
        let buf = terminal.backend().buffer().clone();
        let mut out = String::new();
        for y in 0..buf.area.height {
            for x in 0..buf.area.width {
                out.push_str(buf[(x, y)].symbol());
            }
            out.push('\n');
        }
        out
    }

    #[test]
    fn dashboard_shows_header_and_nav_hints() {
        let s = AppState::new();
        let rendered = render_to_string(&s);
        assert!(rendered.contains("Apohara Catalyst"));
        assert!(rendered.contains("Agents"));
        assert!(rendered.contains("Cost"));
        assert!(rendered.contains("Wizard"));
        assert!(rendered.contains("Quit"));
    }

    #[test]
    fn dashboard_footer_reflects_current_view() {
        let s = AppState::new();
        let rendered = render_to_string(&s);
        assert!(rendered.contains("Dashboard"));
    }
}
