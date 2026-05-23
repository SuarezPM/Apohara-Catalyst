//! Connect/reconnect with exponential backoff + jitter (G6.A.4).
//!
//! Pure policy types so the retry loop is testable without sockets. The
//! daemon-side socket binding is owned by `apohara-transport` /
//! `apohara-daemon`; this module is reused by both client and daemon.

use thiserror::Error;
use std::time::Duration;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BackoffPolicy {
    pub initial_ms: u64,
    pub max_ms: u64,
    pub max_attempts: u32,
    pub jitter_pct: u32, // 0..=100
}

impl Default for BackoffPolicy {
    fn default() -> Self {
        // From spec: 100ms → 30s max, 3 attempts before fail-hard.
        Self {
            initial_ms: 100,
            max_ms: 30_000,
            max_attempts: 3,
            jitter_pct: 25,
        }
    }
}

impl BackoffPolicy {
    /// Compute backoff for `attempt` (1-indexed). Returns `None` once
    /// `attempt > max_attempts`. Deterministic in the jitter source so the
    /// loop is testable.
    pub fn delay_for(&self, attempt: u32, clock: &dyn RetryClock) -> Option<Duration> {
        if attempt == 0 || attempt > self.max_attempts {
            return None;
        }
        let exp = (attempt - 1).min(31);
        let base = self.initial_ms.saturating_mul(2u64.saturating_pow(exp));
        let capped = base.min(self.max_ms);
        if self.jitter_pct == 0 {
            return Some(Duration::from_millis(capped));
        }
        let jitter_window = capped.saturating_mul(self.jitter_pct as u64) / 100;
        let offset = clock.jitter_ms(jitter_window);
        // Apply jitter symmetrically: capped ± up-to jitter_window.
        let final_ms = if offset.is_negative() {
            capped.saturating_sub(offset.unsigned_abs() as u64)
        } else {
            capped.saturating_add(offset as u64)
        };
        Some(Duration::from_millis(final_ms))
    }
}

/// Abstraction over the jitter / sleep clock so tests can pin behavior.
pub trait RetryClock: Send + Sync {
    /// Return a signed jitter offset in `-window..=window` ms.
    fn jitter_ms(&self, window: u64) -> i64;
}

pub struct DeterministicClock {
    pub fixed_offset_ms: i64,
}

impl RetryClock for DeterministicClock {
    fn jitter_ms(&self, window: u64) -> i64 {
        // Clamp to the window so tests behave even with extreme inputs.
        self.fixed_offset_ms
            .clamp(-(window as i64), window as i64)
    }
}

#[derive(Debug, Error)]
pub enum ConnectError {
    #[error("max attempts ({0}) exhausted")]
    MaxAttemptsExhausted(u32),
    #[error("transport error: {0}")]
    Transport(String),
}

/// Run a connection attempt with backoff. `attempt_fn` is called once per
/// attempt and should return `Ok(())` on success. The loop sleeps according to
/// `policy.delay_for(attempt, clock)` between failures.
pub async fn connect_with_backoff<F, Fut>(
    policy: &BackoffPolicy,
    clock: &dyn RetryClock,
    mut attempt_fn: F,
) -> Result<u32, ConnectError>
where
    F: FnMut(u32) -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
{
    let mut attempt: u32 = 1;
    loop {
        match attempt_fn(attempt).await {
            Ok(()) => return Ok(attempt),
            Err(_) if attempt >= policy.max_attempts => {
                return Err(ConnectError::MaxAttemptsExhausted(policy.max_attempts));
            }
            Err(_) => {
                if let Some(delay) = policy.delay_for(attempt, clock) {
                    tokio::time::sleep(delay).await;
                }
                attempt += 1;
            }
        }
    }
}
