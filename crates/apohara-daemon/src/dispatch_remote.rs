//! Remote task dispatch — daemon side. Routes a task to a connected worker
//! (`apohara worker` over SSH) by:
//!
//! 1. Looking up the live session in the worker registry.
//! 2. Serialising the task as a JSON envelope.
//! 3. Writing the envelope to the SSH channel attached to that worker.
//!
//! The actual russh channel is plumbed in G6.C.7; this module exposes the
//! deterministic, channel-independent business logic so it is testable
//! without a real SSH peer. Tests use an in-memory `TestChannel`.
//!
//! Dependency note: G6.A.5 (WS hub) is parallel; we don't depend on its
//! internals — this dispatcher is invoked by the dispatcher router, which
//! is unified later when both groups land.

use apohara_remote_worker::WorkerLocation;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum DispatchRemoteError {
    #[error("no live worker session for id {0}")]
    NoSession(String),
    #[error("channel write: {0}")]
    ChannelWrite(String),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("location not supported for remote dispatch: {0:?}")]
    UnsupportedLocation(WorkerLocation),
}

/// On-wire envelope. The worker's protocol decoder matches on `type` to route
/// to the run loop. `dispatch_at_unix_ms` is recorded for audit-correlation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum WorkerFrame {
    Dispatch {
        task_id: String,
        payload: serde_json::Value,
        dispatch_at_unix_ms: i64,
    },
    Heartbeat {
        at_unix_ms: i64,
    },
}

/// Abstraction over the underlying SSH channel so we can unit-test without
/// a real russh server. Production wiring (G6.C.7) implements this trait on
/// a russh channel handle.
pub trait WorkerChannel: Send + Sync {
    fn write_frame(&self, bytes: &[u8]) -> Result<(), String>;
}

/// In-memory channel for tests / local-mode workers.
#[derive(Debug, Default)]
pub struct InMemoryChannel {
    pub sent: Mutex<Vec<Vec<u8>>>,
}

impl WorkerChannel for InMemoryChannel {
    fn write_frame(&self, bytes: &[u8]) -> Result<(), String> {
        self.sent.lock().unwrap().push(bytes.to_vec());
        Ok(())
    }
}

#[derive(Clone)]
pub struct WorkerSession {
    pub session_id: String,
    pub location: WorkerLocation,
    pub channel: Arc<dyn WorkerChannel>,
}

impl std::fmt::Debug for WorkerSession {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkerSession")
            .field("session_id", &self.session_id)
            .field("location", &self.location)
            .finish_non_exhaustive()
    }
}

/// In-memory registry of live worker sessions. Production daemon owns one
/// of these guarded by the same lock that mediates the local-socket handlers.
#[derive(Default)]
pub struct WorkerRegistry {
    inner: Mutex<HashMap<String, WorkerSession>>,
}

impl WorkerRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn register(&self, session: WorkerSession) {
        self.inner.lock().unwrap().insert(session.session_id.clone(), session);
    }

    pub fn unregister(&self, session_id: &str) -> Option<WorkerSession> {
        self.inner.lock().unwrap().remove(session_id)
    }

    pub fn get(&self, session_id: &str) -> Option<WorkerSession> {
        self.inner.lock().unwrap().get(session_id).cloned()
    }

    pub fn len(&self) -> usize {
        self.inner.lock().unwrap().len()
    }

    pub fn is_empty(&self) -> bool {
        self.inner.lock().unwrap().is_empty()
    }

    /// All session ids — used by recovery (G6.C.8).
    pub fn session_ids(&self) -> Vec<String> {
        self.inner.lock().unwrap().keys().cloned().collect()
    }
}

/// Dispatch a task to a remote worker by session id. Returns the serialized
/// envelope (also written to the channel) so callers can correlate.
pub fn dispatch_to_session(
    registry: &WorkerRegistry,
    session_id: &str,
    task_id: &str,
    payload: serde_json::Value,
    now_unix_ms: i64,
) -> Result<Vec<u8>, DispatchRemoteError> {
    let session = registry
        .get(session_id)
        .ok_or_else(|| DispatchRemoteError::NoSession(session_id.to_string()))?;

    if !matches!(session.location, WorkerLocation::Local | WorkerLocation::Ssh { .. }) {
        return Err(DispatchRemoteError::UnsupportedLocation(session.location.clone()));
    }

    let frame = WorkerFrame::Dispatch {
        task_id: task_id.to_string(),
        payload,
        dispatch_at_unix_ms: now_unix_ms,
    };
    let mut bytes = serde_json::to_vec(&frame)?;
    bytes.push(b'\n');
    session
        .channel
        .write_frame(&bytes)
        .map_err(DispatchRemoteError::ChannelWrite)?;
    Ok(bytes)
}

/// Convenience: mint a session id (uuid v4) — kept here so callers don't pull
/// in `uuid` directly.
pub fn new_session_id() -> String {
    Uuid::new_v4().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use apohara_remote_worker::WorkerLocation;

    fn session_with_channel(loc: WorkerLocation) -> (WorkerSession, Arc<InMemoryChannel>) {
        let ch = Arc::new(InMemoryChannel::default());
        let s = WorkerSession {
            session_id: new_session_id(),
            location: loc,
            channel: ch.clone(),
        };
        (s, ch)
    }

    #[test]
    fn dispatch_writes_frame_to_channel() {
        let reg = WorkerRegistry::new();
        let (session, ch) = session_with_channel(
            WorkerLocation::ssh("127.0.0.1", 22, "ci").unwrap()
        );
        let sid = session.session_id.clone();
        reg.register(session);
        let payload = serde_json::json!({ "cmd": "build", "args": ["release"] });
        let bytes = dispatch_to_session(&reg, &sid, "task-1", payload.clone(), 1_700_000_000_000)
            .expect("dispatch ok");
        assert_eq!(*bytes.last().unwrap(), b'\n');
        let sent = ch.sent.lock().unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0], bytes);

        let decoded: WorkerFrame = serde_json::from_slice(&bytes[..bytes.len() - 1]).unwrap();
        match decoded {
            WorkerFrame::Dispatch { task_id, payload: p, dispatch_at_unix_ms } => {
                assert_eq!(task_id, "task-1");
                assert_eq!(p, payload);
                assert_eq!(dispatch_at_unix_ms, 1_700_000_000_000);
            }
            other => panic!("unexpected frame: {other:?}"),
        }
    }

    #[test]
    fn dispatch_to_unknown_session_errors() {
        let reg = WorkerRegistry::new();
        let err = dispatch_to_session(
            &reg, "missing", "task-1", serde_json::json!({}), 0,
        )
        .unwrap_err();
        assert!(matches!(err, DispatchRemoteError::NoSession(_)));
    }

    #[test]
    fn dispatch_refuses_unsupported_location() {
        let reg = WorkerRegistry::new();
        let (mut session, _ch) = session_with_channel(WorkerLocation::Local);
        // Cheat: directly mutate to docker (which is not dispatchable in v1).
        session.location = WorkerLocation::docker("img:1").unwrap();
        let sid = session.session_id.clone();
        reg.register(session);
        let err = dispatch_to_session(&reg, &sid, "t", serde_json::json!({}), 0).unwrap_err();
        assert!(matches!(err, DispatchRemoteError::UnsupportedLocation(_)));
    }

    #[test]
    fn registry_register_and_unregister() {
        let reg = WorkerRegistry::new();
        assert!(reg.is_empty());
        let (s, _) = session_with_channel(WorkerLocation::Local);
        let sid = s.session_id.clone();
        reg.register(s);
        assert_eq!(reg.len(), 1);
        assert!(reg.get(&sid).is_some());
        assert!(reg.unregister(&sid).is_some());
        assert!(reg.is_empty());
        assert!(reg.unregister(&sid).is_none());
    }

    #[test]
    fn session_ids_returns_all() {
        let reg = WorkerRegistry::new();
        let (s1, _) = session_with_channel(WorkerLocation::Local);
        let (s2, _) = session_with_channel(WorkerLocation::Local);
        let id1 = s1.session_id.clone();
        let id2 = s2.session_id.clone();
        reg.register(s1);
        reg.register(s2);
        let mut ids = reg.session_ids();
        ids.sort();
        let mut want = vec![id1, id2];
        want.sort();
        assert_eq!(ids, want);
    }

    #[test]
    fn heartbeat_frame_serialises_with_tag() {
        let f = WorkerFrame::Heartbeat { at_unix_ms: 42 };
        let s = serde_json::to_string(&f).unwrap();
        assert!(s.contains(r#""type":"heartbeat""#));
        assert!(s.contains(r#""at_unix_ms":42"#));
    }
}
