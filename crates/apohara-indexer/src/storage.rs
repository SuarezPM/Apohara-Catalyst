//! sqlite-vec backed storage for code chunks + their embeddings.
//!
//! Replaces the previous Nomic BERT + redb stack (G8.A.1 dependency swap,
//! G8.A.3 implementation). Storage = sqlite-vec virtual table. Embeddings =
//! blake3 feature-hashing (see `embeddings.rs`).
//!
//! ## sqlite-vec loading
//!
//! `sqlite-vec` 0.1.9 ships only the FFI symbol `sqlite3_vec_init`. The
//! supported integration with `rusqlite` is to register it as an
//! auto-extension BEFORE opening any connection (see the upstream test
//! `sqlite-vec::tests::test_rusqlite_auto_extension`). We register once
//! per process via `OnceLock`.

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::OnceLock;

use crate::embeddings::feature_hash_embed;

/// Embedding dimension. Picked at 384 — wide enough for low collision rates on
/// the typical code-chunk vocabulary (a few thousand unique identifiers per
/// repo) while keeping vec0 row size at 384 * 4 = 1.5 KiB per chunk.
pub const EMBED_DIM: usize = 384;

/// One unit of indexable content: a code chunk emitted by the upstream
/// chunker (tree-sitter on the Rust side, projector rows on the TS side
/// — wired in G8.A.4 / G8.A.7).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexedChunk {
    pub id: String,
    pub file_path: String,
    pub start_line: u32,
    pub end_line: u32,
    pub body: String,
}

/// A single KNN result. `distance` is the L2 distance reported by vec0
/// (lower = closer). Callers should treat it as opaque — only its ordering
/// across hits is meaningful.
#[derive(Debug, Clone)]
pub struct KnnHit {
    pub chunk_id: String,
    pub distance: f32,
}

/// Register sqlite-vec as an auto-extension. Safe to call repeatedly: SQLite
/// dedupes auto-extension registrations by function pointer. We still guard
/// behind `OnceLock` to avoid the FFI roundtrip on every `open_db` call.
fn ensure_vec_extension_registered() {
    static REGISTERED: OnceLock<()> = OnceLock::new();
    REGISTERED.get_or_init(|| {
        // SAFETY: `sqlite3_vec_init` is the C entry point exported by the
        // sqlite-vec extension. We transmute its `extern "C" fn()` signature
        // to the SQLite extension entrypoint signature
        // (`unsafe extern "C" fn(*mut sqlite3, *mut *mut c_char, *const sqlite3_api_routines) -> i32`)
        // because sqlite-vec exposes the symbol without the extension
        // metadata wrapper. This matches the documented usage pattern in
        // the upstream `sqlite-vec` crate (see its `tests::test_rusqlite_auto_extension`).
        unsafe {
            rusqlite::ffi::sqlite3_auto_extension(Some(std::mem::transmute::<
                *const (),
                unsafe extern "C" fn(
                    *mut rusqlite::ffi::sqlite3,
                    *mut *mut std::os::raw::c_char,
                    *const rusqlite::ffi::sqlite3_api_routines,
                ) -> std::os::raw::c_int,
            >(
                sqlite_vec::sqlite3_vec_init as *const ()
            )));
        }
    });
}

/// Open (or create) the sqlite-vec backed database at `path`, ensuring the
/// extension is registered and the schema (chunks + chunks_vec) exists.
pub fn open_db(path: &Path) -> Result<Connection> {
    ensure_vec_extension_registered();
    let conn = Connection::open(path).context("open sqlite db")?;
    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            file_path TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            body TEXT NOT NULL
         );
         CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(
            embedding float[{}]
         );",
        EMBED_DIM
    ))
    .context("create schema (chunks + chunks_vec)")?;
    Ok(conn)
}

/// Insert (or replace) a chunk and its embedding. Embedding is computed inline
/// from `chunk.body` via `feature_hash_embed`. The chunks_vec rowid is bound
/// to the chunks rowid so the JOIN in `knn_query` is constant-time.
pub fn insert_chunk(conn: &Connection, chunk: &IndexedChunk) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO chunks (id, file_path, start_line, end_line, body) \
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            chunk.id,
            chunk.file_path,
            chunk.start_line,
            chunk.end_line,
            chunk.body
        ],
    )
    .context("insert chunk row")?;

    let embed = feature_hash_embed(&chunk.body, EMBED_DIM);
    let bytes: Vec<u8> = embed.iter().flat_map(|f| f.to_le_bytes()).collect();
    conn.execute(
        "INSERT OR REPLACE INTO chunks_vec (rowid, embedding) \
         VALUES ((SELECT rowid FROM chunks WHERE id = ?1), ?2)",
        params![chunk.id, bytes],
    )
    .context("insert chunk embedding")?;
    Ok(())
}

/// K-nearest-neighbor search. Embeds `query` with the same feature-hashing
/// pipeline and asks vec0 for the closest `k` chunks. Returns `KnnHit`s in
/// ascending distance order.
pub fn knn_query(conn: &Connection, query: &str, k: usize) -> Result<Vec<KnnHit>> {
    let embed = feature_hash_embed(query, EMBED_DIM);
    let bytes: Vec<u8> = embed.iter().flat_map(|f| f.to_le_bytes()).collect();
    let mut stmt = conn
        .prepare(
            "SELECT chunks.id, chunks_vec.distance \
             FROM chunks_vec \
             INNER JOIN chunks ON chunks.rowid = chunks_vec.rowid \
             WHERE embedding MATCH ?1 AND k = ?2 \
             ORDER BY distance",
        )
        .context("prepare knn statement")?;
    let rows = stmt
        .query_map(params![bytes, k as i64], |row| {
            Ok(KnnHit {
                chunk_id: row.get(0)?,
                distance: row.get(1)?,
            })
        })
        .context("execute knn query")?;
    let mut hits = Vec::new();
    for r in rows {
        hits.push(r.context("read knn row")?);
    }
    Ok(hits)
}
