//! Apohara code indexer: sqlite-vec storage + blake3 feature-hashing embeddings.
//!
//! Sprint 8 replaced the previous in-process Nomic BERT + redb stack
//! (`docs/superpowers/plans/2026-05-22-apohara-v1.md` Stage 8). The MVP
//! surface is intentionally narrow: `open_db` initializes the DB, `insert_chunk`
//! adds a chunk + its embedding, `knn_query` finds nearest neighbors.
//!
//! The tree-sitter chunking + binary daemon entry point (`main.rs`) and the
//! TS-side projector glue land in subsequent G8.A.* tasks; this lib does NOT
//! re-export them yet.

pub mod embeddings;
pub mod parser;
pub mod storage;

pub use storage::{insert_chunk, knn_query, open_db, IndexedChunk, KnnHit, EMBED_DIM};
