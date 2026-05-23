//! HTTP poll fallback (G6.A.7).
//!
//! Clients that can't keep a socket open (proxies, sandboxes, certain CI
//! runners) GET `/poll?since=<event-id>` and receive every event after the
//! cursor. This module owns the in-memory queue + cursor logic; the daemon
//! exposes it via axum.

use serde::{Deserialize, Serialize};
use std::collections::VecDeque;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PollEvent {
    pub id: u64,
    pub kind: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PollRequest {
    /// Event id the client has already seen. Zero means "give me everything".
    pub since: u64,
    /// Max events to return; daemon enforces upper bound.
    #[serde(default)]
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct PollResponse {
    pub events: Vec<PollEvent>,
    /// Highest event id returned (or echo of `since` if none).
    pub cursor: u64,
}

/// Server-side queue. Caller-owned; daemon stores one per profile.
pub struct PollState {
    next_id: u64,
    buffer: VecDeque<PollEvent>,
    max_buffer: usize,
    default_limit: usize,
    max_limit: usize,
}

impl PollState {
    pub fn new(max_buffer: usize, default_limit: usize, max_limit: usize) -> Self {
        Self {
            next_id: 1,
            buffer: VecDeque::new(),
            max_buffer,
            default_limit: default_limit.max(1),
            max_limit: max_limit.max(default_limit.max(1)),
        }
    }

    pub fn default_settings() -> Self {
        Self::new(1024, 64, 512)
    }

    /// Append an event; returns the assigned id.
    pub fn push(&mut self, kind: impl Into<String>, payload: serde_json::Value) -> u64 {
        let id = self.next_id;
        self.next_id = self.next_id.saturating_add(1);
        self.buffer.push_back(PollEvent {
            id,
            kind: kind.into(),
            payload,
        });
        while self.buffer.len() > self.max_buffer {
            self.buffer.pop_front();
        }
        id
    }

    pub fn latest_id(&self) -> u64 {
        self.buffer.back().map(|e| e.id).unwrap_or(0)
    }
}

/// Compute the poll response for a request. Pure function so the daemon's
/// HTTP handler is a thin wrapper.
pub fn apply_poll(state: &PollState, req: &PollRequest) -> PollResponse {
    let limit = req
        .limit
        .unwrap_or(state.default_limit)
        .min(state.max_limit)
        .max(1);
    let mut events = Vec::new();
    for ev in state.buffer.iter() {
        if ev.id > req.since {
            events.push(ev.clone());
            if events.len() >= limit {
                break;
            }
        }
    }
    let cursor = events
        .last()
        .map(|e| e.id)
        .unwrap_or_else(|| req.since.max(state.latest_id()));
    PollResponse { events, cursor }
}
