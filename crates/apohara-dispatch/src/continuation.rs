//! Continuation tracker — decides re-use context vs fresh spawn.
//! Ported from src/core/dispatch/continuation.ts.

use std::collections::HashSet;

#[derive(Debug, Default)]
pub struct ContinuationTracker {
    continuations: HashSet<String>,
}

impl ContinuationTracker {
    pub fn new() -> Self {
        Self {
            continuations: HashSet::new(),
        }
    }
    pub fn mark(&mut self, task_id: &str) {
        self.continuations.insert(task_id.to_string());
    }
    pub fn should_reuse(&self, task_id: &str) -> bool {
        self.continuations.contains(task_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unmarked_task_does_not_reuse() {
        let t = ContinuationTracker::new();
        assert!(!t.should_reuse("t1"));
    }

    #[test]
    fn marked_task_reuses() {
        let mut t = ContinuationTracker::new();
        t.mark("t1");
        assert!(t.should_reuse("t1"));
    }
}
