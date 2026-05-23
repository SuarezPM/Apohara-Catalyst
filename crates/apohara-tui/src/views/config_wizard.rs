//! ConfigWizard view — 4-step state machine.
//!
//! Steps: welcome -> providers -> permissions -> review. Pure data; the
//! wizard does not yet persist (S20 G3.A.6 wires `apohara-secrets`).

use crate::state::AppState;
use ratatui::{prelude::*, widgets::*};

pub const STEPS: &[&str] = &["welcome", "providers", "permissions", "review"];

#[derive(Debug, Clone)]
pub struct WizardState {
    step_idx: usize,
}

impl WizardState {
    pub fn new() -> Self {
        Self { step_idx: 0 }
    }

    pub fn current_step(&self) -> &'static str {
        STEPS[self.step_idx]
    }

    pub fn step_index(&self) -> usize {
        self.step_idx
    }

    pub fn next(&mut self) {
        if self.step_idx + 1 < STEPS.len() {
            self.step_idx += 1;
        }
    }

    pub fn prev(&mut self) {
        if self.step_idx > 0 {
            self.step_idx -= 1;
        }
    }
}

impl Default for WizardState {
    fn default() -> Self {
        Self::new()
    }
}

pub fn render(state: &AppState, frame: &mut Frame) {
    let p = Paragraph::new(format!(
        "Wizard step: {} ({} / {})\n\n(n)ext / (p)rev / Esc back",
        state.wizard.current_step(),
        state.wizard.step_index() + 1,
        STEPS.len()
    ))
    .block(
        Block::default()
            .title("Config Wizard")
            .borders(Borders::ALL),
    );
    frame.render_widget(p, frame.area());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wizard_progresses_through_steps() {
        let mut w = WizardState::new();
        assert_eq!(w.current_step(), "welcome");
        w.next();
        assert_eq!(w.current_step(), "providers");
        w.next();
        assert_eq!(w.current_step(), "permissions");
        w.next();
        assert_eq!(w.current_step(), "review");
    }

    #[test]
    fn wizard_clamps_forward_at_last_step() {
        let mut w = WizardState::new();
        for _ in 0..10 {
            w.next();
        }
        assert_eq!(w.current_step(), "review");
    }

    #[test]
    fn wizard_clamps_backward_at_first_step() {
        let mut w = WizardState::new();
        w.prev();
        w.prev();
        assert_eq!(w.current_step(), "welcome");
    }

    #[test]
    fn wizard_prev_moves_backwards() {
        let mut w = WizardState::new();
        w.next();
        w.next();
        assert_eq!(w.current_step(), "permissions");
        w.prev();
        assert_eq!(w.current_step(), "providers");
    }
}
