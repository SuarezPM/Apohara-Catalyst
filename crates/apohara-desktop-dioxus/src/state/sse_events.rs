//! Recent SSE / hook event tape — replaces the implicit log behind
//! `packages/desktop/src/store/listeners/{sseListener,hookListeners}.ts`.
//!
//! The TS side fed projector patches straight into the projected state
//! and threw the raw envelope away. The Dioxus side keeps a small ring
//! buffer of recent events so debug surfaces (event humanizer, hook log,
//! statusline tooltips) can render the tail without subscribing to the
//! source streams individually.
//!
//! Capacity is bounded (`SSE_RING_CAPACITY`) so a long-running run can't
//! grow this signal without bound.

use dioxus::prelude::*;
use std::collections::VecDeque;

/// Maximum number of events kept in the ring buffer. Oldest entries are
/// dropped to make room.
pub const SSE_RING_CAPACITY: usize = 256;

/// One frame off the SSE / hook event tape. The `kind` is the named-event
/// line (`state-init`, `state-patch`, `permission-request`, …). The
/// `payload` is the raw JSON string — consumers parse on demand because
/// the per-kind schema lives next to the consumer, not next to this store.
#[derive(Debug, Clone, PartialEq)]
pub struct SseEvent {
    pub kind: String,
    pub payload: String,
    pub ts: u64,
}

/// Root signal: capacity-bounded ring of recent events. Newest at the
/// back, oldest at the front — matches `push_back` / `pop_front` order.
pub static SSE_EVENTS: GlobalSignal<VecDeque<SseEvent>> =
    Signal::global(|| VecDeque::with_capacity(SSE_RING_CAPACITY));

/// Append an event. If the ring is full, drop the oldest entry first.
pub fn push_event(event: SseEvent) {
    let mut buf = SSE_EVENTS.write();
    if buf.len() == SSE_RING_CAPACITY {
        buf.pop_front();
    }
    buf.push_back(event);
}

/// Wipe the ring (used by hard reconnects).
pub fn clear_events() {
    SSE_EVENTS.write().clear();
}

/// Snapshot of the current tape, newest last. Cloned so callers don't
/// hold the signal lock.
pub fn recent_events() -> Vec<SseEvent> {
    SSE_EVENTS.read().iter().cloned().collect()
}
