# apohara-indexer — Agent Guide

Tree-sitter chunking + sqlite-vec storage + blake3 feature-hashing embeddings —
the codebase indexer. Embeds source files, stores embeddings in a SQLite file,
serves nearest-neighbour search to ContextForge.

Post-Sprint-8 swap (G8.A.3) replaced the previous in-process transformer
model with deterministic feature-hashing, and retired the previous embedded
key-value backend in favour of SQLite.

## Testing

`cargo test -p apohara-indexer` runs the full suite (lib + integration) in
parallel. The embedder loads no model and uses ~0 RAM, so the historical
"one test binary at a time" rule is gone.

```bash
cargo test -p apohara-indexer                            # everything
cargo test -p apohara-indexer --lib                      # unit tests
cargo test -p apohara-indexer --test sqlite_vec_storage  # contract
cargo test -p apohara-indexer --test persistence_reopen  # reopen survives
```

(Spec §10 R1's old serialization rule no longer applies — it was tied to the
transformer model this sprint deleted.)

## Pattern

```rust
use apohara_indexer::{Indexer, IndexerConfig};

let idx = Indexer::open(IndexerConfig::default()).await?;
idx.add_file("src/lib.rs", &code_bytes).await?;
let hits = idx.search("auth flow", /* k= */ 5).await?;
```

## What this crate is NOT

- Not the search UI surface (that's the native Dioxus desktop crate, `crates/apohara-desktop-dioxus`).
- Not the ContextForge client (that's `src/core/contextforge-client.ts`).
- Not a general embedding service — it's purpose-built for source code.

## Storage

- **sqlite-vec** virtual table: `chunks_vec USING vec0(embedding float[384])`.
- Companion table `chunks` holds chunk metadata + the original source body.
- Single SQLite file under `~/.apohara/` (caller provides the exact path).
- Backed by `rusqlite` + the `sqlite-vec` extension loaded at open time.

## Embeddings

Deterministic, in-process, ~0 RAM via blake3 feature-hashing
(`src/embeddings.rs::feature_hash_embed`).

- 384 dimensions (`EMBED_DIM`).
- Tokenization: split on non-alphanumeric chars, lowercase, signed
  feature-hash into buckets, L2-normalize.
- Quality vs transformer: ~30% lower recall@5 on semantic code-search
  benchmarks. The trade-off bought: no model load, no RAM footprint,
  reproducible results across machines and CI runs.

## CLI

- `apohara-indexer index <db_path> <file>...` — index files.
- `apohara-indexer query <db_path> <text>` — KNN top-5, output `id\tdistance`.

## v1.1+ ideas

If recall@5 measurably blocks UX, swap in `fastembed-rs` (small transformer,
~25MB, in-process). Before reintroducing a model:

- Document the RAM footprint in this file.
- Re-evaluate parallel-test safety — if total per-process memory passes
  ~100MB, restore the old "one test binary at a time" pattern and update
  `cargo test` instructions accordingly.
