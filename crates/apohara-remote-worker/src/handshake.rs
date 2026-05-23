//! Worker handshake protocol — capability negotiation between worker (client)
//! and apohara daemon (server) over a freshly-opened SSH channel.
//!
//! Flow:
//!
//! 1. Worker sends `HandshakeRequest { apohara_version, supported_protocols,
//!    max_concurrent_tasks }`.
//! 2. Server picks the highest mutually-supported protocol, mints a session id,
//!    and replies with `HandshakeResponse { session_id, negotiated_protocol,
//!    server_apohara_version }`.
//! 3. Either side may reply with `HandshakeError` if version / protocol
//!    intersection fails — the channel is then closed.
//!
//! The protocol is JSON-over-newline-delimited. Each side writes one line
//! and reads one line. The session id is a UUIDv4.

use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

/// Protocols the apohara stack knows how to speak. Newer entries first so the
/// negotiation prefers the latest mutually-supported one.
pub const SUPPORTED_PROTOCOLS: &[&str] = &["apohara-worker/1"];

/// Minimum apohara version a server will accept. Bumped when wire breaks.
pub const SERVER_MIN_CLIENT_VERSION: &str = "1.0.0-dev";

#[derive(Debug, Error)]
pub enum HandshakeError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
    #[error("no protocol overlap: client={client:?}, server={server:?}")]
    NoOverlap { client: Vec<String>, server: Vec<String> },
    #[error("version mismatch: client={client}, server_min={server_min}")]
    VersionMismatch { client: String, server_min: String },
    #[error("invalid max_concurrent_tasks: {0} (must be >=1)")]
    InvalidMaxTasks(u32),
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HandshakeRequest {
    pub apohara_version: String,
    pub supported_protocols: Vec<String>,
    pub max_concurrent_tasks: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct HandshakeResponse {
    pub session_id: String,
    pub negotiated_protocol: String,
    pub server_apohara_version: String,
}

impl HandshakeRequest {
    pub fn new(version: impl Into<String>, max_concurrent_tasks: u32) -> Self {
        Self {
            apohara_version: version.into(),
            supported_protocols: SUPPORTED_PROTOCOLS.iter().map(|s| s.to_string()).collect(),
            max_concurrent_tasks,
        }
    }
}

/// Server-side: decide whether to accept a HandshakeRequest. Pure function so
/// the actual russh channel handler stays a thin wrapper.
pub fn negotiate(
    req: &HandshakeRequest,
    server_version: &str,
    server_supported: &[&str],
) -> Result<HandshakeResponse, HandshakeError> {
    if !version_at_least(&req.apohara_version, SERVER_MIN_CLIENT_VERSION) {
        return Err(HandshakeError::VersionMismatch {
            client: req.apohara_version.clone(),
            server_min: SERVER_MIN_CLIENT_VERSION.into(),
        });
    }
    if req.max_concurrent_tasks == 0 {
        return Err(HandshakeError::InvalidMaxTasks(req.max_concurrent_tasks));
    }
    // Pick the FIRST overlap in the order the server lists — server's order is
    // its preference (newest first).
    let pick = server_supported
        .iter()
        .find(|s| req.supported_protocols.iter().any(|c| c == *s))
        .ok_or_else(|| HandshakeError::NoOverlap {
            client: req.supported_protocols.clone(),
            server: server_supported.iter().map(|s| s.to_string()).collect(),
        })?;
    Ok(HandshakeResponse {
        session_id: Uuid::new_v4().to_string(),
        negotiated_protocol: (*pick).to_string(),
        server_apohara_version: server_version.to_string(),
    })
}

/// Lexicographic dotted-version compare, treating any unparseable suffix as
/// equal. Sufficient for "1.0.0-dev" vs "1.0.0-dev". Returns `lhs >= rhs`.
fn version_at_least(lhs: &str, rhs: &str) -> bool {
    let l = parse_version_tuple(lhs);
    let r = parse_version_tuple(rhs);
    l >= r
}

fn parse_version_tuple(v: &str) -> (u32, u32, u32) {
    let core = v.split('-').next().unwrap_or(v);
    let mut parts = core.split('.').map(|p| p.parse::<u32>().unwrap_or(0));
    (
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
        parts.next().unwrap_or(0),
    )
}

/// Encode a request/response to a single newline-terminated JSON line. The
/// channel guarantees framing only at the message level via the trailing `\n`.
pub fn encode<T: Serialize>(value: &T) -> Result<Vec<u8>, HandshakeError> {
    let mut out = serde_json::to_vec(value)?;
    out.push(b'\n');
    Ok(out)
}

/// Decode one JSON line. Caller is responsible for buffering bytes until a
/// newline arrives.
pub fn decode<T: for<'de> Deserialize<'de>>(line: &[u8]) -> Result<T, HandshakeError> {
    // Tolerate a trailing newline.
    let trimmed = if line.last() == Some(&b'\n') {
        &line[..line.len() - 1]
    } else {
        line
    };
    Ok(serde_json::from_slice(trimmed)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_carries_full_protocol_set() {
        let r = HandshakeRequest::new("1.0.0-dev", 4);
        assert_eq!(r.apohara_version, "1.0.0-dev");
        assert_eq!(r.max_concurrent_tasks, 4);
        assert!(r.supported_protocols.contains(&"apohara-worker/1".to_string()));
    }

    #[test]
    fn negotiate_happy_path_picks_protocol_and_mints_session() {
        let req = HandshakeRequest::new("1.0.0-dev", 2);
        let resp = negotiate(&req, "1.0.0-dev", SUPPORTED_PROTOCOLS).unwrap();
        assert_eq!(resp.negotiated_protocol, "apohara-worker/1");
        assert_eq!(resp.server_apohara_version, "1.0.0-dev");
        // session id is a UUID
        Uuid::parse_str(&resp.session_id).expect("session_id must be a UUID");
    }

    #[test]
    fn negotiate_rejects_zero_max_tasks() {
        let req = HandshakeRequest::new("1.0.0-dev", 0);
        let err = negotiate(&req, "1.0.0-dev", SUPPORTED_PROTOCOLS).unwrap_err();
        assert!(matches!(err, HandshakeError::InvalidMaxTasks(0)));
    }

    #[test]
    fn negotiate_rejects_no_overlap() {
        let mut req = HandshakeRequest::new("1.0.0-dev", 1);
        req.supported_protocols = vec!["apohara-worker/99".into()];
        let err = negotiate(&req, "1.0.0-dev", SUPPORTED_PROTOCOLS).unwrap_err();
        assert!(matches!(err, HandshakeError::NoOverlap { .. }));
    }

    #[test]
    fn negotiate_rejects_client_too_old() {
        let req = HandshakeRequest::new("0.9.0", 1);
        let err = negotiate(&req, "1.0.0-dev", SUPPORTED_PROTOCOLS).unwrap_err();
        assert!(matches!(err, HandshakeError::VersionMismatch { .. }));
    }

    #[test]
    fn negotiate_prefers_server_order() {
        // Two protocols, with the server preferring v2.
        let server_pref = &["apohara-worker/2", "apohara-worker/1"][..];
        let mut req = HandshakeRequest::new("1.0.0-dev", 1);
        req.supported_protocols = vec!["apohara-worker/1".into(), "apohara-worker/2".into()];
        let r = negotiate(&req, "1.0.0-dev", server_pref).unwrap();
        assert_eq!(r.negotiated_protocol, "apohara-worker/2");
    }

    #[test]
    fn encode_then_decode_round_trip() {
        let req = HandshakeRequest::new("1.0.0-dev", 3);
        let bytes = encode(&req).unwrap();
        assert_eq!(*bytes.last().unwrap(), b'\n');
        let back: HandshakeRequest = decode(&bytes).unwrap();
        assert_eq!(back, req);
    }

    #[test]
    fn decode_tolerates_missing_trailing_newline() {
        let req = HandshakeRequest::new("1.0.0-dev", 1);
        let bytes = serde_json::to_vec(&req).unwrap();
        let back: HandshakeRequest = decode(&bytes).unwrap();
        assert_eq!(back, req);
    }

    #[test]
    fn version_compare_handles_suffix() {
        assert!(version_at_least("1.0.0-dev", "1.0.0-dev"));
        assert!(version_at_least("1.1.0", "1.0.0"));
        assert!(!version_at_least("0.9.9", "1.0.0"));
    }
}
