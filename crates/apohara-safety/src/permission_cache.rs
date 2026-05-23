//! Session-scoped permission cache — ports `src/core/safety/permissionCache.ts`.
//!
//! When the user approves a permission with scope="session", the pattern lives
//! here until the session ends (or until `clear()` is called explicitly).
//! scope="always" patterns go to the settings file instead (handled by the
//! caller). scope="once" patterns never touch this cache.

use std::collections::{HashMap, HashSet};

#[derive(Debug, Default)]
pub struct PermissionCache {
    cache: HashMap<String, HashSet<String>>,
}

impl PermissionCache {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn add(&mut self, session_id: &str, pattern: &str) {
        self.cache
            .entry(session_id.to_string())
            .or_default()
            .insert(pattern.to_string());
    }

    pub fn has(&self, session_id: &str, pattern: &str) -> bool {
        self.cache
            .get(session_id)
            .map(|s| s.contains(pattern))
            .unwrap_or(false)
    }

    pub fn list(&self, session_id: &str) -> Vec<String> {
        self.cache
            .get(session_id)
            .map(|s| s.iter().cloned().collect())
            .unwrap_or_default()
    }

    pub fn clear(&mut self, session_id: &str) {
        self.cache.remove(session_id);
    }
}
