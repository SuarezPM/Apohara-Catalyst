//! Chunked task-result streaming.
//!
//! The worker emits results back to the daemon as a sequence of
//! `ResultChunk` frames written one-per-line over the SSH channel:
//!
//! 1. Exactly one `Header { task_id }` first.
//! 2. Zero or more `Data { seq, payload_b64 }` with `seq` starting at `0` and
//!    incrementing by 1 each time.
//! 3. Exactly one `Trailer { total_chunks, status }` ends the stream.
//!
//! The daemon's `ResultAssembler` validates ordering and reconstructs the
//! original byte buffer. We use base64 for the payload so the JSON envelope
//! stays printable and the protocol is line-framed; the choice is
//! deliberate — every parser in the chain is well-trodden.

use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Base64 alphabet for chunk payloads (standard + padding).
const B64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Default chunk size on the wire. 32 KiB keeps each line well below
/// any sane SSH channel-window threshold while still amortizing framing.
pub const DEFAULT_CHUNK_BYTES: usize = 32 * 1024;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum ChunkError {
    #[error("serde: {0}")]
    Serde(String),
    #[error("out-of-order chunk: expected seq {expected}, got {got}")]
    OutOfOrder { expected: u32, got: u32 },
    #[error("missing trailer (eof never received)")]
    MissingTrailer,
    #[error("trailer received without a header")]
    NoHeader,
    #[error("duplicate header")]
    DuplicateHeader,
    #[error("base64 decode failed at chunk {0}")]
    BadBase64(u32),
    #[error("trailer total_chunks mismatch: header_emitted={emitted}, trailer={trailer}")]
    ChunkCountMismatch { emitted: u32, trailer: u32 },
    #[error("data chunk after trailer")]
    DataAfterTrailer,
}

impl From<serde_json::Error> for ChunkError {
    fn from(e: serde_json::Error) -> Self {
        ChunkError::Serde(e.to_string())
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum ResultChunk {
    Header {
        task_id: String,
    },
    Data {
        seq: u32,
        payload_b64: String,
    },
    Trailer {
        total_chunks: u32,
        /// "success" | "failure" | "cancelled" — opaque string so the daemon
        /// can route without coupling to enum churn.
        status: String,
    },
}

impl ResultChunk {
    pub fn encode_line(&self) -> Result<Vec<u8>, ChunkError> {
        let mut v = serde_json::to_vec(self)?;
        v.push(b'\n');
        Ok(v)
    }

    pub fn decode_line(line: &[u8]) -> Result<Self, ChunkError> {
        let trimmed = if line.last() == Some(&b'\n') {
            &line[..line.len() - 1]
        } else {
            line
        };
        Ok(serde_json::from_slice(trimmed)?)
    }
}

/// Split a payload into header + data + trailer chunks.
pub fn chunk_payload(
    task_id: &str,
    payload: &[u8],
    status: &str,
    chunk_bytes: usize,
) -> Vec<ResultChunk> {
    let mut out: Vec<ResultChunk> = Vec::new();
    out.push(ResultChunk::Header { task_id: task_id.to_string() });
    if payload.is_empty() {
        out.push(ResultChunk::Trailer { total_chunks: 0, status: status.to_string() });
        return out;
    }
    let mut seq: u32 = 0;
    let size = chunk_bytes.max(1);
    for window in payload.chunks(size) {
        out.push(ResultChunk::Data {
            seq,
            payload_b64: b64_encode(window),
        });
        seq += 1;
    }
    out.push(ResultChunk::Trailer { total_chunks: seq, status: status.to_string() });
    out
}

#[derive(Debug, Default)]
pub struct ResultAssembler {
    pub task_id: Option<String>,
    pub data: Vec<u8>,
    pub next_seq: u32,
    pub trailer_seen: bool,
    pub status: Option<String>,
}

impl ResultAssembler {
    pub fn new() -> Self {
        Self::default()
    }

    /// Feed one decoded chunk. Returns `Ok(true)` when the trailer arrives,
    /// `Ok(false)` for any earlier frame.
    pub fn feed(&mut self, chunk: ResultChunk) -> Result<bool, ChunkError> {
        if self.trailer_seen {
            return Err(ChunkError::DataAfterTrailer);
        }
        match chunk {
            ResultChunk::Header { task_id } => {
                if self.task_id.is_some() {
                    return Err(ChunkError::DuplicateHeader);
                }
                self.task_id = Some(task_id);
                Ok(false)
            }
            ResultChunk::Data { seq, payload_b64 } => {
                if self.task_id.is_none() {
                    return Err(ChunkError::NoHeader);
                }
                if seq != self.next_seq {
                    return Err(ChunkError::OutOfOrder { expected: self.next_seq, got: seq });
                }
                let decoded = b64_decode(&payload_b64).map_err(|_| ChunkError::BadBase64(seq))?;
                self.data.extend_from_slice(&decoded);
                self.next_seq += 1;
                Ok(false)
            }
            ResultChunk::Trailer { total_chunks, status } => {
                if self.task_id.is_none() {
                    return Err(ChunkError::NoHeader);
                }
                if total_chunks != self.next_seq {
                    return Err(ChunkError::ChunkCountMismatch {
                        emitted: self.next_seq,
                        trailer: total_chunks,
                    });
                }
                self.status = Some(status);
                self.trailer_seen = true;
                Ok(true)
            }
        }
    }

    pub fn finalize(self) -> Result<AssembledResult, ChunkError> {
        if !self.trailer_seen {
            return Err(ChunkError::MissingTrailer);
        }
        Ok(AssembledResult {
            task_id: self.task_id.unwrap_or_default(),
            payload: self.data,
            status: self.status.unwrap_or_default(),
        })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssembledResult {
    pub task_id: String,
    pub payload: Vec<u8>,
    pub status: String,
}

// --- Minimal base64 (avoid an extra dep; bytes don't need streaming).

fn b64_encode(input: &[u8]) -> String {
    let mut out = String::with_capacity((input.len() + 2) / 3 * 4);
    let chunks = input.chunks_exact(3);
    let remainder = chunks.remainder();
    for c in chunks {
        let n = ((c[0] as u32) << 16) | ((c[1] as u32) << 8) | (c[2] as u32);
        out.push(B64_ALPHABET[(n >> 18 & 0x3F) as usize] as char);
        out.push(B64_ALPHABET[(n >> 12 & 0x3F) as usize] as char);
        out.push(B64_ALPHABET[(n >> 6 & 0x3F) as usize] as char);
        out.push(B64_ALPHABET[(n & 0x3F) as usize] as char);
    }
    match remainder.len() {
        1 => {
            let n = (remainder[0] as u32) << 16;
            out.push(B64_ALPHABET[(n >> 18 & 0x3F) as usize] as char);
            out.push(B64_ALPHABET[(n >> 12 & 0x3F) as usize] as char);
            out.push('=');
            out.push('=');
        }
        2 => {
            let n = ((remainder[0] as u32) << 16) | ((remainder[1] as u32) << 8);
            out.push(B64_ALPHABET[(n >> 18 & 0x3F) as usize] as char);
            out.push(B64_ALPHABET[(n >> 12 & 0x3F) as usize] as char);
            out.push(B64_ALPHABET[(n >> 6 & 0x3F) as usize] as char);
            out.push('=');
        }
        _ => {}
    }
    out
}

fn b64_decode(s: &str) -> Result<Vec<u8>, ()> {
    fn idx(c: u8) -> Result<u32, ()> {
        match c {
            b'A'..=b'Z' => Ok((c - b'A') as u32),
            b'a'..=b'z' => Ok((c - b'a' + 26) as u32),
            b'0'..=b'9' => Ok((c - b'0' + 52) as u32),
            b'+' => Ok(62),
            b'/' => Ok(63),
            _ => Err(()),
        }
    }
    let bytes = s.as_bytes();
    if bytes.len() % 4 != 0 {
        return Err(());
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    for quartet in bytes.chunks_exact(4) {
        let pad0 = quartet[2] == b'=';
        let pad1 = quartet[3] == b'=';
        let n0 = idx(quartet[0])?;
        let n1 = idx(quartet[1])?;
        let n2 = if pad0 { 0 } else { idx(quartet[2])? };
        let n3 = if pad1 { 0 } else { idx(quartet[3])? };
        let combined = (n0 << 18) | (n1 << 12) | (n2 << 6) | n3;
        out.push((combined >> 16 & 0xFF) as u8);
        if !pad0 {
            out.push((combined >> 8 & 0xFF) as u8);
        }
        if !pad1 {
            out.push((combined & 0xFF) as u8);
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn b64_round_trip_empty_and_short() {
        for input in [&b""[..], b"f", b"fo", b"foo", b"foobar"] {
            let enc = b64_encode(input);
            let dec = b64_decode(&enc).unwrap();
            assert_eq!(dec, input.to_vec(), "round trip {:?}", input);
        }
    }

    #[test]
    fn b64_known_vectors() {
        assert_eq!(b64_encode(b"Man"), "TWFu");
        assert_eq!(b64_encode(b"Ma"), "TWE=");
        assert_eq!(b64_encode(b"M"), "TQ==");
        assert_eq!(b64_decode("TWFu").unwrap(), b"Man");
    }

    #[test]
    fn chunk_payload_emits_header_then_data_then_trailer() {
        let frames = chunk_payload("t1", b"hello world", "success", 4);
        // 3 data chunks (4,4,3 bytes) + header + trailer = 5
        assert_eq!(frames.len(), 5);
        assert!(matches!(frames[0], ResultChunk::Header { .. }));
        assert!(matches!(frames[4], ResultChunk::Trailer { total_chunks: 3, .. }));
        // seqs are 0,1,2
        let seqs: Vec<u32> = frames[1..4].iter().filter_map(|f| match f {
            ResultChunk::Data { seq, .. } => Some(*seq),
            _ => None,
        }).collect();
        assert_eq!(seqs, vec![0, 1, 2]);
    }

    #[test]
    fn chunk_payload_empty_yields_header_trailer_only() {
        let frames = chunk_payload("t1", b"", "success", 32);
        assert_eq!(frames.len(), 2);
        assert!(matches!(frames[0], ResultChunk::Header { .. }));
        assert!(matches!(frames[1], ResultChunk::Trailer { total_chunks: 0, .. }));
    }

    #[test]
    fn assembler_happy_path() {
        let mut asm = ResultAssembler::new();
        let frames = chunk_payload("t1", b"Hello, Apohara!", "success", 5);
        let mut finished = false;
        for f in frames {
            finished |= asm.feed(f).unwrap();
        }
        assert!(finished);
        let r = asm.finalize().unwrap();
        assert_eq!(r.task_id, "t1");
        assert_eq!(r.payload, b"Hello, Apohara!".to_vec());
        assert_eq!(r.status, "success");
    }

    #[test]
    fn assembler_rejects_out_of_order_data() {
        let mut asm = ResultAssembler::new();
        asm.feed(ResultChunk::Header { task_id: "t1".into() }).unwrap();
        // Skip seq=0, send seq=1.
        let err = asm.feed(ResultChunk::Data { seq: 1, payload_b64: b64_encode(b"x") })
            .unwrap_err();
        assert!(matches!(err, ChunkError::OutOfOrder { expected: 0, got: 1 }));
    }

    #[test]
    fn assembler_rejects_data_before_header() {
        let mut asm = ResultAssembler::new();
        let err = asm.feed(ResultChunk::Data { seq: 0, payload_b64: b64_encode(b"x") })
            .unwrap_err();
        assert!(matches!(err, ChunkError::NoHeader));
    }

    #[test]
    fn assembler_rejects_duplicate_header() {
        let mut asm = ResultAssembler::new();
        asm.feed(ResultChunk::Header { task_id: "a".into() }).unwrap();
        let err = asm.feed(ResultChunk::Header { task_id: "b".into() }).unwrap_err();
        assert!(matches!(err, ChunkError::DuplicateHeader));
    }

    #[test]
    fn assembler_rejects_data_after_trailer() {
        let mut asm = ResultAssembler::new();
        asm.feed(ResultChunk::Header { task_id: "t".into() }).unwrap();
        asm.feed(ResultChunk::Trailer { total_chunks: 0, status: "ok".into() }).unwrap();
        let err = asm.feed(ResultChunk::Data { seq: 0, payload_b64: b64_encode(b"x") })
            .unwrap_err();
        assert!(matches!(err, ChunkError::DataAfterTrailer));
    }

    #[test]
    fn assembler_rejects_chunk_count_mismatch() {
        let mut asm = ResultAssembler::new();
        asm.feed(ResultChunk::Header { task_id: "t".into() }).unwrap();
        asm.feed(ResultChunk::Data { seq: 0, payload_b64: b64_encode(b"x") }).unwrap();
        let err = asm.feed(ResultChunk::Trailer { total_chunks: 5, status: "ok".into() })
            .unwrap_err();
        assert!(matches!(err, ChunkError::ChunkCountMismatch { emitted: 1, trailer: 5 }));
    }

    #[test]
    fn assembler_finalize_without_trailer_errors() {
        let mut asm = ResultAssembler::new();
        asm.feed(ResultChunk::Header { task_id: "t".into() }).unwrap();
        let err = asm.finalize().unwrap_err();
        assert!(matches!(err, ChunkError::MissingTrailer));
    }

    #[test]
    fn line_encode_then_decode_round_trip() {
        let f = ResultChunk::Trailer { total_chunks: 7, status: "success".into() };
        let line = f.encode_line().unwrap();
        assert_eq!(*line.last().unwrap(), b'\n');
        let back = ResultChunk::decode_line(&line).unwrap();
        assert_eq!(back, f);
    }

    #[test]
    fn full_pipeline_via_lines() {
        // Produce → encode-to-lines → decode-from-lines → assemble.
        let payload = b"the quick brown fox jumps over the lazy dog".to_vec();
        let frames = chunk_payload("t1", &payload, "success", 7);
        let mut buf: Vec<u8> = Vec::new();
        for f in &frames {
            buf.extend_from_slice(&f.encode_line().unwrap());
        }
        let mut asm = ResultAssembler::new();
        for line in buf.split(|b| *b == b'\n').filter(|l| !l.is_empty()) {
            let f = ResultChunk::decode_line(line).unwrap();
            asm.feed(f).unwrap();
        }
        let r = asm.finalize().unwrap();
        assert_eq!(r.payload, payload);
        assert_eq!(r.status, "success");
    }
}
