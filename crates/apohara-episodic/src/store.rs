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
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

use apohara_indexer::embeddings::feature_hash_embed;
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

/// Insert (or replace) an episode and its goal embedding. `providers` and
/// `gate_verdicts` are stored as JSON text; the goal is feature-hash embedded
/// into `episodes_vec`. The vec rowid is bound to the episodes rowid so the
/// JOIN in `query_episodes` is constant-time (mirrors `insert_chunk`).
pub fn insert_episode(conn: &Connection, episode: &Episode) -> Result<()> {
    let providers_json =
        serde_json::to_string(&episode.providers).context("serialize providers")?;
    let verdicts_json =
        serde_json::to_string(&episode.gate_verdicts).context("serialize gate_verdicts")?;

    conn.execute(
        "INSERT OR REPLACE INTO episodes \
         (id, goal, timestamp, providers, winning_diff_summary, gate_verdicts, outcome) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            episode.id,
            episode.goal,
            episode.timestamp,
            providers_json,
            episode.winning_diff_summary,
            verdicts_json,
            episode.outcome,
        ],
    )
    .context("insert episode row")?;

    let embed = feature_hash_embed(&episode.goal, EMBED_DIM);
    let bytes: Vec<u8> = embed.iter().flat_map(|f| f.to_le_bytes()).collect();
    conn.execute(
        "INSERT OR REPLACE INTO episodes_vec (rowid, embedding) \
         VALUES ((SELECT rowid FROM episodes WHERE id = ?1), ?2)",
        params![episode.id, bytes],
    )
    .context("insert episode embedding")?;
    Ok(())
}

/// Feature-similarity recall: embed `goal` with the same feature-hashing
/// pipeline and ask vec0 for the `k` nearest past episodes, ascending distance.
/// Mirrors `apohara_indexer::knn_query`'s JOIN. NOT semantic — keyword-ish over
/// short goal strings (see module docs).
pub fn query_episodes(conn: &Connection, goal: &str, k: usize) -> Result<Vec<Episode>> {
    let embed = feature_hash_embed(goal, EMBED_DIM);
    let bytes: Vec<u8> = embed.iter().flat_map(|f| f.to_le_bytes()).collect();
    let mut stmt = conn
        .prepare(
            "SELECT episodes.id, episodes.goal, episodes.timestamp, episodes.providers, \
                    episodes.winning_diff_summary, episodes.gate_verdicts, episodes.outcome \
             FROM episodes_vec \
             INNER JOIN episodes ON episodes.rowid = episodes_vec.rowid \
             WHERE embedding MATCH ?1 AND k = ?2 \
             ORDER BY distance",
        )
        .context("prepare episode knn statement")?;
    let rows = stmt
        .query_map(params![bytes, k as i64], |row| {
            let providers_json: String = row.get(3)?;
            let verdicts_json: String = row.get(5)?;
            Ok((
                Episode {
                    id: row.get(0)?,
                    goal: row.get(1)?,
                    timestamp: row.get(2)?,
                    providers: Vec::new(),
                    winning_diff_summary: row.get(4)?,
                    gate_verdicts: Vec::new(),
                    outcome: row.get(6)?,
                },
                providers_json,
                verdicts_json,
            ))
        })
        .context("execute episode knn query")?;
    let mut out = Vec::new();
    for r in rows {
        let (mut ep, providers_json, verdicts_json) = r.context("read episode row")?;
        ep.providers = serde_json::from_str(&providers_json).context("deserialize providers")?;
        ep.gate_verdicts =
            serde_json::from_str(&verdicts_json).context("deserialize gate_verdicts")?;
        out.push(ep);
    }
    Ok(out)
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

    fn ep(id: &str, goal: &str) -> Episode {
        Episode {
            id: id.to_string(),
            goal: goal.to_string(),
            timestamp: 1000,
            providers: vec!["claude-code-cli".to_string()],
            winning_diff_summary: "summary".to_string(),
            gate_verdicts: vec!["passed".to_string()],
            outcome: "applied".to_string(),
        }
    }

    #[test]
    #[serial(episodic_fresh_process)]
    fn store_insert_and_query_roundtrips_all_fields() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_episode_db(&dir.path().join("episodes.db")).unwrap();
        let original = Episode {
            id: "e1".to_string(),
            goal: "add timeout parameter to fetchData".to_string(),
            timestamp: 42,
            providers: vec!["claude-code-cli".to_string(), "codex-cli".to_string()],
            winning_diff_summary: "claude-code-cli changed 3 files".to_string(),
            gate_verdicts: vec!["passed".to_string(), "failed".to_string()],
            outcome: "applied".to_string(),
        };
        insert_episode(&conn, &original).unwrap();
        let hits = query_episodes(&conn, "add timeout parameter to fetchData", 1).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0], original, "all fields must roundtrip via the store");
    }

    #[test]
    #[serial(episodic_fresh_process)]
    fn store_query_orders_by_feature_similarity() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_episode_db(&dir.path().join("episodes.db")).unwrap();

        // Query shares progressively fewer tokens with near < mid < far:
        //   query: "fix login authentication bug"
        //   near : "fix login authentication bug" (4 shared)
        //   mid  : "fix login screen layout"      (2 shared: fix, login)
        //   far  : "deploy production database"   (0 shared)
        insert_episode(&conn, &ep("near", "fix login authentication bug")).unwrap();
        insert_episode(&conn, &ep("mid", "fix login screen layout")).unwrap();
        insert_episode(&conn, &ep("far", "deploy production database")).unwrap();

        let hits = query_episodes(&conn, "fix login authentication bug", 3).unwrap();
        assert_eq!(hits.len(), 3, "all three episodes retrievable");
        // Distance ORDERING, not just retrieval: nearest-by-shared-tokens first,
        // disjoint last. Catches feature-hash degeneracy on short goals.
        assert_eq!(hits[0].id, "near", "exact-match goal must rank first");
        assert_eq!(hits[2].id, "far", "disjoint goal must rank last");
    }
}
