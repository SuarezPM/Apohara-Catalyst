//! Apohara episodic memory: a local, cross-run store of past dispatch episodes
//! (goal, providers, winning diff summary, gate verdicts, outcome).
//!
//! Reuses `apohara-indexer`'s sqlite-vec storage + blake3 `feature_hash_embed`
//! primitives (same `EMBED_DIM`), so recall is **feature-similarity recall** —
//! keyword-ish over short goal strings, NOT semantic. Zero tokens, zero model,
//! local only.
//!
//! The store lives at `~/.apohara/episodes/episodes.db` (durable, distinct from
//! the new-per-run `orchestration.db`). See `path` for the resolution and
//! `store` for the schema + insert/query/recall surface.

pub mod path;
pub mod store;
