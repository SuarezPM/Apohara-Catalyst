# apohara-indexer — Agent Guide

Tree-sitter + redb + Nomic BERT — the codebase indexer. Embeds source files,
stores embeddings in redb, serves nearest-neighbour search to ContextForge.

## CRITICAL OOM hazard

The Nomic BERT model is ~400MB. `cargo test` spawns the lib + every
integration binary in parallel and OOMs the machine. **NEVER** run bare
`cargo test` or `cargo test -p apohara-indexer`.

Run ONE binary at a time:

```bash
cargo test -p apohara-indexer --lib
cargo test -p apohara-indexer --test memory_integration
cargo test -p apohara-indexer --test indexer_persistence
```

For mock mode in CI / dev:

```bash
APOHARA_MOCK_EMBEDDINGS=1 cargo test -p apohara-indexer --lib
```

(Spec §10 R1 made this a hard rule after Pablo's machine swapped trying to
hold three model copies in RAM.)

## Pattern

```rust
use apohara_indexer::{Indexer, IndexerConfig};

let idx = Indexer::open(IndexerConfig::default()).await?;
idx.add_file("src/lib.rs", &code_bytes).await?;
let hits = idx.search("auth flow", /* k= */ 5).await?;
```

## What this crate is NOT

- Not the search UI surface (that's `packages/desktop/src/components/Search/`).
- Not the ContextForge client (that's `src/core/contextforge-client.ts`).
- Not a general embedding service — it's purpose-built for source code.

## Storage

redb at `~/.apohara/index.redb`. Schema versioned; migrations on `open` are
forward-only. Backups live next to the file as `index.redb.bak.<ts>`.
