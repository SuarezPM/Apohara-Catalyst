//! Apohara ContextForge Primitives — SimHash + LSH + Queueing Theory.
//!
//! Ports the mathematical primitives from upstream ContextForge
//! (`apohara-context-forge/apohara_context_forge/{dedup/lsh_engine.py,
//! scheduling/queueing_controller.py}`) to native Rust.
//!
//! ## Modules
//!
//! * [`fingerprint`] — blake3 token hashing + whitespace / shingle tokenizers
//! * [`simhash`]     — Charikar 2002 64-bit SimHash over arbitrary tokenizers
//! * [`lsh`]         — banded LSH (b × r) + hamming-ladder match confidence
//! * [`queueing`]    — M/M/c utilization, Erlang-C, Little's Law admission gate
//!
//! All routines are pure functions with deterministic outputs. Async-aware
//! state machines (sliding-window arrival EMA, etc.) live in the
//! `queueing::Controller` type and never touch the global allocator outside
//! of an explicit `update()` call.

pub mod fingerprint;
