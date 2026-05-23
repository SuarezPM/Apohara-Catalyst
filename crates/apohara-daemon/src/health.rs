//! Daemon healthcheck snapshot (G6.A.11).
//!
//! Pure data type + helpers — the HTTP endpoint is wired by the transport
//! crate / hooks-server-style axum stack later. Kept module-local so the
//! transport layer can serialize the snapshot directly.

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HealthSnapshot {
    pub alive: bool,
    pub profile: String,
    pub uptime_ms: u64,
    pub connections: u64,
    pub version: String,
}

/// Shared health state used by the daemon to expose `/health`. Cheap to clone.
#[derive(Debug, Clone)]
pub struct HealthState {
    started_at: Instant,
    connections: Arc<AtomicU64>,
    profile: String,
    version: String,
}

impl HealthState {
    pub fn new(profile: impl Into<String>, version: impl Into<String>) -> Self {
        Self {
            started_at: Instant::now(),
            connections: Arc::new(AtomicU64::new(0)),
            profile: profile.into(),
            version: version.into(),
        }
    }

    pub fn snapshot(&self) -> HealthSnapshot {
        HealthSnapshot {
            alive: true,
            profile: self.profile.clone(),
            uptime_ms: self.started_at.elapsed().as_millis() as u64,
            connections: self.connections.load(Ordering::Relaxed),
            version: self.version.clone(),
        }
    }

    pub fn inc_connection(&self) {
        self.connections.fetch_add(1, Ordering::Relaxed);
    }

    pub fn dec_connection(&self) {
        // saturating_sub via compare loop avoids underflow if someone
        // double-decrements.
        let mut current = self.connections.load(Ordering::Relaxed);
        loop {
            if current == 0 {
                break;
            }
            match self.connections.compare_exchange(
                current,
                current - 1,
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(actual) => current = actual,
            }
        }
    }
}
