//! ConfigWizard view — placeholder filled in G3.A.5.

use crate::state::AppState;
use ratatui::{prelude::*, widgets::*};

pub fn render(_state: &AppState, frame: &mut Frame) {
    let block = Block::default().title("Wizard (G3.A.5)").borders(Borders::ALL);
    frame.render_widget(block, frame.area());
}
