//! Apohara transport layer — wire-level protocols between daemon and clients.
//!
//! Length-prefixed framed JSON over Unix domain socket / named pipe is the
//! primary transport (G6.A.3). HTTP poll fallback (G6.A.7) and any future
//! transports plug in here.
//!
//! Envelope versioning is enforced so the daemon and clients can roll
//! independently.

pub mod envelope;
pub mod http_poll;
pub mod local_socket;

#[cfg(test)]
mod envelope_tests;
#[cfg(test)]
mod http_poll_tests;
#[cfg(test)]
mod local_socket_tests;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub use envelope::{Envelope, EnvelopeError, ENVELOPE_VERSION};
pub use http_poll::{apply_poll, PollEvent, PollRequest, PollResponse, PollState};
pub use local_socket::{read_frame, write_frame, LocalSocketError, MAX_FRAME_BYTES};
