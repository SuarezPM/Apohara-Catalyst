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

pub use path::default_episode_db_path;
pub use store::{insert_episode, open_episode_db, query_episodes, Episode};

use anyhow::Result;

/// Capture one episode into the default home-anchored store
/// (`~/.apohara/episodes/episodes.db`). Opens the DB (triggering the
/// process-global vec0 registration) and inserts the episode.
///
/// Callers in the dispatch path should treat this as best-effort: log on
/// `Err`, never block or panic the run.
pub fn capture_episode(episode: &Episode) -> Result<()> {
    let conn = open_episode_db(&default_episode_db_path())?;
    insert_episode(&conn, episode)
}
