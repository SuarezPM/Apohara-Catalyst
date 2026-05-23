//! CostTable view — placeholder filled in G3.A.4.

use crate::state::AppState;
use ratatui::{prelude::*, widgets::*};

pub fn render(_state: &AppState, frame: &mut Frame) {
    let block = Block::default().title("Cost (G3.A.4)").borders(Borders::ALL);
    frame.render_widget(block, frame.area());
}
