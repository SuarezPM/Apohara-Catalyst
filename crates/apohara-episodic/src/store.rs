//! Episode schema + sqlite-vec backed store.
//!
//! An [`Episode`] is one past dispatch run distilled to its cross-run-useful
//! facts: the goal, which providers ran, the winning diff summary, the gate
//! verdicts, and the outcome. The store is durable (`~/.apohara/episodes/`),
//! distinct from the new-per-run `orchestration.db`.
//!
//! Recall is **feature-similarity recall** (blake3 feature-hashing, reusing
//! `apohara_indexer::embeddings::feature_hash_embed`) — keyword-ish over short
//! goal strings, NOT semantic. Zero tokens, zero model.
//!
//! # Process-global registration side effect
//!
//! [`open_episode_db`] calls [`apohara_indexer::ensure_vec_extension_registered`]
//! before opening any connection. That installs the vec0 extension via
//! `sqlite3_auto_extension`, a **process-global** registration guarded by a
//! `OnceLock` (idempotent). We own this trigger explicitly because the desktop
//! dispatch path has no guaranteed prior `apohara_indexer::open_db` call — in a
//! fresh process the `episodes_vec` virtual-table CREATE would otherwise fail.

use anyhow::{Context, Result};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;

use apohara_indexer::EMBED_DIM;

/// One past dispatch episode, the cross-run memory unit.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Episode {
    /// Stable unique id for the episode (e.g. a run/task id).
    pub id: String,
    /// The objective text the run was dispatched against. This is the field
    /// embedded into `episodes_vec` for feature-similarity recall.
    pub goal: String,
    /// Unix epoch milliseconds when the episode was captured.
    pub timestamp: i64,
    /// Provider ids that participated in the run.
    pub providers: Vec<String>,
    /// Short summary of the winning diff (e.g. the winning provider + files).
    pub winning_diff_summary: String,
    /// Per-candidate gate verdict strings (e.g. "passed" / "failed").
    pub gate_verdicts: Vec<String>,
    /// Free-text outcome label (e.g. "applied", "rejected", "no-change").
    pub outcome: String,
}

/// Open (or create) the durable episode store at `path`.
///
/// Triggers the process-global vec0 registration FIRST (see module docs), then
/// opens the connection in WAL mode with a 5s `busy_timeout` (so cross-session
/// writers block rather than corrupt), and creates the `episodes` table plus the
/// `episodes_vec` vec0 virtual table over the goal embedding (`EMBED_DIM`).
pub fn open_episode_db(path: &Path) -> Result<Connection> {
    // MUST run before any Connection::open — the desktop dispatch path has no
    // guaranteed prior indexer open_db, so a fresh process would otherwise fail
    // the vec0 virtual-table CREATE below.
    apohara_indexer::ensure_vec_extension_registered();

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("create episode db parent dir")?;
    }

    let conn = Connection::open(path).context("open episode sqlite db")?;
    // WAL: readers don't block the single per-run writer. busy_timeout: a
    // concurrent cross-session writer blocks up to 5s instead of erroring.
    conn.pragma_update(None, "journal_mode", "WAL")
        .context("set WAL journal_mode")?;
    conn.pragma_update(None, "busy_timeout", 5000)
        .context("set busy_timeout")?;

    conn.execute_batch(&format!(
        "CREATE TABLE IF NOT EXISTS episodes (
            id TEXT PRIMARY KEY,
            goal TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            providers TEXT NOT NULL,
            winning_diff_summary TEXT NOT NULL,
            gate_verdicts TEXT NOT NULL,
            outcome TEXT NOT NULL
         );
         CREATE VIRTUAL TABLE IF NOT EXISTS episodes_vec USING vec0(
            embedding float[{EMBED_DIM}]
         );"
    ))
    .context("create schema (episodes + episodes_vec)")?;

    Ok(conn)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serial_test::serial;

    /// Load-bearing test: open the episode DB in a FRESH process with NO prior
    /// `apohara_indexer::open_db` call and assert the `episodes_vec` vec0 table
    /// creates. This is the case that fails if vec0 registration is assumed
    /// rather than owned (scenario-2b mitigation). `serial` so it can't share a
    /// process with a test that already registered the extension via open_db.
    #[test]
    #[serial(episodic_fresh_process)]
    fn schema_creates_vec_table_in_fresh_process() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("episodes.db");
        let conn = open_episode_db(&db).expect("open_episode_db must register vec0 + create schema");

        // If episodes_vec did not create, this query against the vec0 table errors.
        let count: i64 = conn
            .query_row("SELECT count(*) FROM episodes_vec", [], |r| r.get(0))
            .expect("episodes_vec must exist (vec0 extension registered)");
        assert_eq!(count, 0, "fresh episodes_vec is empty");

        let ep_count: i64 = conn
            .query_row("SELECT count(*) FROM episodes", [], |r| r.get(0))
            .expect("episodes table must exist");
        assert_eq!(ep_count, 0);
    }

    #[test]
    #[serial(episodic_fresh_process)]
    fn schema_open_is_idempotent() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("episodes.db");
        let _c1 = open_episode_db(&db).unwrap();
        // Re-opening the same path must not error (CREATE ... IF NOT EXISTS).
        let _c2 = open_episode_db(&db).unwrap();
    }

    #[test]
    #[serial(episodic_fresh_process)]
    fn schema_sets_wal_and_busy_timeout_pragmas() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("episodes.db");
        let conn = open_episode_db(&db).unwrap();

        let journal_mode: String = conn
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(journal_mode.to_lowercase(), "wal", "WAL must be active");

        let busy_timeout: i64 = conn
            .query_row("PRAGMA busy_timeout", [], |r| r.get(0))
            .unwrap();
        assert_eq!(busy_timeout, 5000, "busy_timeout must be 5000ms");
    }
}
