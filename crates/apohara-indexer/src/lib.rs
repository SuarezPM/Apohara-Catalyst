// TODO(sprint-8): consume projectToSearchRows output via the sqlite-vec swap.
// G5.F.1's `projectToSearchRows` (src/core/projector/transcript-transformer.ts)
// already emits the FTS5-shaped denormalized rows (`text` + `tags`) the indexer
// wants. The current redb + Nomic BERT pipeline below predates that projection
// and re-derives its own shape during ingest. Sprint 8 replaces this whole
// ingest path with sqlite-vec consuming the projector's output directly so the
// parse cost is paid once at the ledger boundary instead of twice. Plan:
// `docs/superpowers/plans/2026-05-22-apohara-v1.md` Stage 8 (acknowledged-
// temporal — do NOT refactor this crate ahead of the swap; the projector
// integration point lives on the TS side, not in lib.rs).
pub mod parser;
pub mod embeddings;
pub mod index;
pub mod db;
pub mod indexer;
pub mod dependency;
pub mod server;

pub use parser::{parse_file, Language, FunctionSignature};
pub use db::{Db, NodeMetadata, MemoryType};
pub use indexer::{Indexer, SearchResult};
pub use dependency::DependencyGraph;
pub use server::{Server, DEFAULT_SOCKET_PATH, run_server};
