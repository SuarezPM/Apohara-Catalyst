//! TUI state machine.
//!
//! Bounded enum of views + an [`AppState`] that owns navigation. Quit is
//! a flag so the main loop can drain rendering before tearing down the
//! terminal. Pure data, no I/O — keeps unit tests trivial.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum View {
    Dashboard,
    AgentList,
    CostTable,
    ConfigWizard,
}

#[derive(Debug)]
pub struct AppState {
    pub current_view: View,
    pub running: bool,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            current_view: View::Dashboard,
            running: true,
        }
    }

    pub fn go(&mut self, view: View) {
        self.current_view = view;
    }

    pub fn quit(&mut self) {
        self.running = false;
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_state_starts_at_dashboard() {
        let s = AppState::new();
        assert_eq!(s.current_view, View::Dashboard);
        assert!(s.running);
    }

    #[test]
    fn app_state_navigates_to_agent_list() {
        let mut s = AppState::new();
        s.go(View::AgentList);
        assert_eq!(s.current_view, View::AgentList);
    }

    #[test]
    fn app_state_navigates_to_cost_table() {
        let mut s = AppState::new();
        s.go(View::CostTable);
        assert_eq!(s.current_view, View::CostTable);
    }

    #[test]
    fn app_state_quit_clears_running() {
        let mut s = AppState::new();
        s.quit();
        assert!(!s.running);
    }
}
