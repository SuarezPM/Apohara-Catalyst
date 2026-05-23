//! In-process broadcast channel that fans normalized hook events out to
//! subscribers (UI bridge, ledger appender, future Coordinator loop).
//!
//! Per spec §3.5: events validated in [`crate::event::handle_event`] flow
//! through this channel. `send` failing with no subscribers is benign — we
//! treat it as a warn-level diagnostic, never an error.

use tokio::sync::broadcast;

#[derive(Clone)]
pub struct Broadcaster<T: Clone> {
    tx: broadcast::Sender<T>,
}

impl<T: Clone> Broadcaster<T> {
    /// Create a broadcaster with the given queue capacity (lagging
    /// subscribers receive `RecvError::Lagged` once they fall behind).
    pub fn new(capacity: usize) -> Self {
        let (tx, _rx) = broadcast::channel(capacity);
        Self { tx }
    }

    /// Subscribe — returns a fresh receiver that only sees events sent
    /// after `subscribe` is called.
    pub fn subscribe(&self) -> broadcast::Receiver<T> {
        self.tx.subscribe()
    }

    /// Send an event to all active subscribers. Returns `Err(SendError)`
    /// when there are no subscribers — callers should treat that as a
    /// benign warn, not a hard failure.
    pub fn send(&self, value: T) -> Result<usize, broadcast::error::SendError<T>> {
        self.tx.send(value)
    }
}
