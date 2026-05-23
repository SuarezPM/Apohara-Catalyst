//! In-process WebSocket-like pub/sub hub used by the daemon (G6.A.5).
//!
//! `Hub` owns a map of channels → broadcast senders. Publishers send
//! `HubMessage` values stamped with a caller-provided `message_id`; the hub
//! filters duplicates by id (sliding window of N most recent ids per channel).
//!
//! Stampede control (G6.A.6) is layered on top via `StampedePolicy` — caps
//! the number of concurrent subscribers per channel.
//!
//! The hub is generic-free: payloads are JSON to keep the daemon ↔ client
//! boundary serialization-stable.

pub mod stampede;

#[cfg(test)]
mod stampede_tests;
#[cfg(test)]
mod hub_tests;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::collections::VecDeque;
use std::sync::Arc;
use thiserror::Error;
use tokio::sync::{broadcast, Mutex, OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

pub use stampede::StampedePolicy;

/// One message broadcast over a channel.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HubMessage {
    pub channel: String,
    pub message_id: Uuid,
    pub payload: serde_json::Value,
}

#[derive(Debug, Error)]
pub enum HubError {
    #[error("subscriber cap reached for channel {0}")]
    StampedeCapReached(String),
    #[error("send error: {0}")]
    Send(String),
}

/// Per-channel sender + sliding dedupe window.
struct ChannelState {
    tx: broadcast::Sender<HubMessage>,
    recent_ids: VecDeque<Uuid>,
    semaphore: Arc<Semaphore>,
}

#[derive(Clone)]
pub struct Hub {
    inner: Arc<HubInner>,
}

struct HubInner {
    channels: Mutex<HashMap<String, ChannelState>>,
    capacity: usize,
    dedupe_window: usize,
    stampede: StampedePolicy,
}

impl Hub {
    pub fn new() -> Self {
        Self::with_policy(StampedePolicy::default())
    }

    pub fn with_policy(policy: StampedePolicy) -> Self {
        Self {
            inner: Arc::new(HubInner {
                channels: Mutex::new(HashMap::new()),
                capacity: 256,
                dedupe_window: 128,
                stampede: policy,
            }),
        }
    }

    pub async fn subscribe(
        &self,
        channel: &str,
    ) -> Result<HubSubscription, HubError> {
        let mut g = self.inner.channels.lock().await;
        let state = g
            .entry(channel.to_string())
            .or_insert_with(|| ChannelState {
                tx: broadcast::channel(self.inner.capacity).0,
                recent_ids: VecDeque::with_capacity(self.inner.dedupe_window),
                semaphore: Arc::new(Semaphore::new(self.inner.stampede.max_subscribers_per_event)),
            });
        let permit = match state.semaphore.clone().try_acquire_owned() {
            Ok(p) => p,
            Err(_) => return Err(HubError::StampedeCapReached(channel.to_string())),
        };
        let rx = state.tx.subscribe();
        Ok(HubSubscription { rx, _permit: permit })
    }

    /// Publish a message; deduplicates by `message_id` within the recent
    /// window. Returns `Ok(true)` if delivered, `Ok(false)` if dropped as
    /// duplicate, error on send failure.
    pub async fn publish(&self, msg: HubMessage) -> Result<bool, HubError> {
        let mut g = self.inner.channels.lock().await;
        let state = g
            .entry(msg.channel.clone())
            .or_insert_with(|| ChannelState {
                tx: broadcast::channel(self.inner.capacity).0,
                recent_ids: VecDeque::with_capacity(self.inner.dedupe_window),
                semaphore: Arc::new(Semaphore::new(self.inner.stampede.max_subscribers_per_event)),
            });
        if state.recent_ids.contains(&msg.message_id) {
            return Ok(false);
        }
        state.recent_ids.push_back(msg.message_id);
        while state.recent_ids.len() > self.inner.dedupe_window {
            state.recent_ids.pop_front();
        }
        // broadcast::Sender::send only errors when there are no receivers;
        // that's still a successful publish from the hub's POV.
        let _ = state.tx.send(msg);
        Ok(true)
    }

    /// Snapshot the subscriber count for `channel`. Useful for diagnostics
    /// and tests.
    pub async fn subscriber_count(&self, channel: &str) -> usize {
        let g = self.inner.channels.lock().await;
        g.get(channel).map(|s| s.tx.receiver_count()).unwrap_or(0)
    }
}

impl Default for Hub {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug)]
pub struct HubSubscription {
    pub rx: broadcast::Receiver<HubMessage>,
    _permit: OwnedSemaphorePermit,
}

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
