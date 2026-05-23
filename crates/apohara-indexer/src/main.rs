//! Binary entry point for the apohara-indexer daemon.
//!
//! Sprint 8 swap (G8.A.3) deleted the redb/Nomic-BERT-backed `server` module
//! that this binary used to wire up. G8.A.4 will rewrite this entry point on
//! top of the new sqlite-vec storage + JSON-RPC contract. Until then, the
//! daemon emits a clear error so anyone running `cargo run -p apohara-indexer`
//! mid-sprint knows what's going on (rather than getting a stale binary or
//! a confusing `unresolved import`).

use anyhow::{bail, Result};

fn main() -> Result<()> {
    bail!(
        "apohara-indexer daemon is being rebuilt on sqlite-vec — see G8.A.4 \
         in docs/superpowers/plans/2026-05-22-apohara-v1.md (Sprint 8). The \
         storage layer (apohara_indexer::{{open_db, insert_chunk, knn_query}}) \
         is already available as a library."
    );
}