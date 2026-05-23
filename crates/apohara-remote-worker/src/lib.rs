//! apohara-remote-worker — client-side worker that connects to the apohara
//! SSH server, negotiates a session, and runs dispatched tasks (G6.C).
//!
//! Real handshake / streaming lands in subsequent sub-tasks; this crate
//! exists from G6.C.1 so the workspace builds.

pub mod handshake;
pub mod location;
pub mod stream;

pub use handshake::{
    decode as handshake_decode, encode as handshake_encode, negotiate, HandshakeError,
    HandshakeRequest, HandshakeResponse, SERVER_MIN_CLIENT_VERSION, SUPPORTED_PROTOCOLS,
};
pub use location::{LocationError, WorkerLocation};
pub use stream::{
    chunk_payload, AssembledResult, ChunkError, ResultAssembler, ResultChunk, DEFAULT_CHUNK_BYTES,
};
