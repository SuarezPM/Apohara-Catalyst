//! Teammate idle tracker — pick deterministic available agent.
//! Ported from src/core/dispatch/teammate-idle.ts.

use std::collections::HashSet;

#[derive(Debug, Default)]
pub struct TeammateRoster {
    busy: HashSet<String>,
    registered: HashSet<String>,
}

impl TeammateRoster {
    pub fn new() -> Self {
        Self {
            busy: HashSet::new(),
            registered: HashSet::new(),
        }
    }
    pub fn register(&mut self, agent_id: &str) {
        self.registered.insert(agent_id.to_string());
    }
    pub fn mark_busy(&mut self, agent_id: &str) {
        self.busy.insert(agent_id.to_string());
    }
    pub fn release(&mut self, agent_id: &str) {
        self.busy.remove(agent_id);
    }
    pub fn pick_idle(&self) -> Option<String> {
        let mut idle: Vec<&String> = self
            .registered
            .iter()
            .filter(|a| !self.busy.contains(*a))
            .collect();
        idle.sort();
        idle.first().map(|s| s.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_registered_returns_none() {
        let r = TeammateRoster::new();
        assert_eq!(r.pick_idle(), None);
    }

    #[test]
    fn picks_lex_first_idle() {
        let mut r = TeammateRoster::new();
        r.register("zeta");
        r.register("alpha");
        r.register("beta");
        r.mark_busy("alpha");
        assert_eq!(r.pick_idle(), Some("beta".to_string()));
    }

    #[test]
    fn release_returns_agent_to_idle_pool() {
        let mut r = TeammateRoster::new();
        r.register("alpha");
        r.mark_busy("alpha");
        assert_eq!(r.pick_idle(), None);
        r.release("alpha");
        assert_eq!(r.pick_idle(), Some("alpha".to_string()));
    }
}
