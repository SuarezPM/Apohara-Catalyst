//! Careful mode — skip dispatch if Freeze/Careful active.
//! Ported from src/core/dispatch/careful-mode.ts.

#[derive(Debug, Default)]
pub struct CarefulMode {
    active: bool,
}

impl CarefulMode {
    pub fn new() -> Self {
        Self { active: false }
    }
    pub fn set_active(&mut self, active: bool) {
        self.active = active;
    }
    pub fn should_skip_dispatch(&self) -> bool {
        self.active
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_is_inactive() {
        let m = CarefulMode::new();
        assert!(!m.should_skip_dispatch());
    }

    #[test]
    fn active_skips_dispatch() {
        let mut m = CarefulMode::new();
        m.set_active(true);
        assert!(m.should_skip_dispatch());
    }

    #[test]
    fn toggle_off_resumes_dispatch() {
        let mut m = CarefulMode::new();
        m.set_active(true);
        m.set_active(false);
        assert!(!m.should_skip_dispatch());
    }
}
