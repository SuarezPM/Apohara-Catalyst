//! Persistent mesh memory (US-F4.2, R15/R16).
//!
//! The F1.2 mailbox carries *transient* blade-to-blade messages (drained on
//! read). The mesh also accumulates *durable* context that must survive a
//! close/reopen so a NEW blade joining later can read what was decided and
//! handed off: design decisions, who-owns-what handoffs, agreed constraints.
//!
//! This is a flat sqlite store (no vec0 — recovery is by `run_id`, not
//! similarity), reusing `apohara-episodic`'s durability discipline (WAL +
//! busy_timeout) so a cross-process reader blocks rather than corrupts. It is
//! distinct from the [`crate::store::Episode`] store (whole past runs) — this
//! is the live mesh's working memory for ONE run.

use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};
use std::path::Path;

/// What kind of durable mesh fact an entry records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MeshEntryKind {
    /// A decision the mesh agreed on (architecture, approach, constraint).
    Decision,
    /// A handoff: one blade passing ownership/context to another.
    Handoff,
}

impl MeshEntryKind {
    fn as_str(self) -> &'static str {
        match self {
            MeshEntryKind::Decision => "decision",
            MeshEntryKind::Handoff => "handoff",
        }
    }
    fn from_str(s: &str) -> Result<Self> {
        match s {
            "decision" => Ok(MeshEntryKind::Decision),
            "handoff" => Ok(MeshEntryKind::Handoff),
            other => anyhow::bail!("unknown mesh entry kind: {other}"),
        }
    }
}

/// One durable mesh-memory entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct MeshEntry {
    /// Stable unique id (e.g. a uuid or `<run>-<seq>`).
    pub id: String,
    /// The run/objective this context belongs to — the recovery key.
    pub run_id: String,
    /// The blade that authored the entry.
    pub blade: String,
    pub kind: MeshEntryKind,
    /// The decision/handoff text.
    pub content: String,
    /// Unix epoch millis when recorded (recovery order).
    pub timestamp: i64,
}

/// Open (or create) the durable mesh-memory store at `path`. WAL +
/// busy_timeout mirror [`crate::store::open_episode_db`] so a concurrent
/// cross-process writer blocks (up to 5s) rather than corrupting.
pub fn open_mesh_memory_db(path: &Path) -> Result<Connection> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).context("create mesh memory db parent dir")?;
    }
    let conn = Connection::open(path).context("open mesh memory sqlite db")?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .context("set WAL journal_mode")?;
    conn.pragma_update(None, "busy_timeout", 5000)
        .context("set busy_timeout")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS mesh_memory (
            id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL,
            blade TEXT NOT NULL,
            kind TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS mesh_memory_run_idx ON mesh_memory(run_id, timestamp);",
    )
    .context("create mesh_memory schema")?;
    Ok(conn)
}

/// Record (or replace by id) one mesh entry.
pub fn record_mesh_entry(conn: &Connection, entry: &MeshEntry) -> Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO mesh_memory \
         (id, run_id, blade, kind, content, timestamp) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            entry.id,
            entry.run_id,
            entry.blade,
            entry.kind.as_str(),
            entry.content,
            entry.timestamp,
        ],
    )
    .context("insert mesh entry")?;
    Ok(())
}

/// Recover the full mesh context for `run_id`, oldest-first (the order a new
/// blade should read decisions/handoffs to reconstruct what happened).
pub fn recover_mesh_context(conn: &Connection, run_id: &str) -> Result<Vec<MeshEntry>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, run_id, blade, kind, content, timestamp \
             FROM mesh_memory WHERE run_id = ?1 ORDER BY timestamp ASC, id ASC",
        )
        .context("prepare recover_mesh_context")?;
    let rows = stmt
        .query_map(params![run_id], |row| {
            let kind_str: String = row.get(3)?;
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                kind_str,
                row.get::<_, String>(4)?,
                row.get::<_, i64>(5)?,
            ))
        })
        .context("query mesh context")?;

    let mut out = Vec::new();
    for r in rows {
        let (id, run, blade, kind_str, content, timestamp) = r.context("read mesh row")?;
        out.push(MeshEntry {
            id,
            run_id: run,
            blade,
            kind: MeshEntryKind::from_str(&kind_str)?,
            content,
            timestamp,
        });
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(id: &str, run: &str, blade: &str, kind: MeshEntryKind, content: &str, ts: i64) -> MeshEntry {
        MeshEntry {
            id: id.to_string(),
            run_id: run.to_string(),
            blade: blade.to_string(),
            kind,
            content: content.to_string(),
            timestamp: ts,
        }
    }

    /// THE F4.2 acceptance: persist mesh context, CLOSE the store, REOPEN with a
    /// fresh connection (= a new blade joining), and recover it.
    #[test]
    fn persist_restart_recover_by_new_blade() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("mesh.db");

        // Blade A records a decision + a handoff, then the store closes.
        {
            let conn = open_mesh_memory_db(&db).unwrap();
            record_mesh_entry(&conn, &entry("d1", "run-1", "claude", MeshEntryKind::Decision, "use trait-direction to break the cycle", 10)).unwrap();
            record_mesh_entry(&conn, &entry("h1", "run-1", "claude", MeshEntryKind::Handoff, "codex owns src/db.rs next", 20)).unwrap();
        } // conn dropped → connection closed

        // A NEW blade (fresh connection on the same path) recovers the context.
        let conn2 = open_mesh_memory_db(&db).unwrap();
        let recovered = recover_mesh_context(&conn2, "run-1").unwrap();
        assert_eq!(recovered.len(), 2, "both entries survive close+reopen");
        assert_eq!(recovered[0].id, "d1", "oldest-first ordering");
        assert_eq!(recovered[0].kind, MeshEntryKind::Decision);
        assert_eq!(recovered[1].kind, MeshEntryKind::Handoff);
        assert_eq!(recovered[1].content, "codex owns src/db.rs next");
    }

    #[test]
    fn recovery_is_scoped_to_run_id() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_mesh_memory_db(&dir.path().join("mesh.db")).unwrap();
        record_mesh_entry(&conn, &entry("a", "run-1", "claude", MeshEntryKind::Decision, "x", 1)).unwrap();
        record_mesh_entry(&conn, &entry("b", "run-2", "codex", MeshEntryKind::Decision, "y", 1)).unwrap();

        let r1 = recover_mesh_context(&conn, "run-1").unwrap();
        assert_eq!(r1.len(), 1);
        assert_eq!(r1[0].run_id, "run-1");
        // A run with no context recovers empty (not an error).
        assert!(recover_mesh_context(&conn, "run-404").unwrap().is_empty());
    }

    #[test]
    fn record_replaces_by_id() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_mesh_memory_db(&dir.path().join("mesh.db")).unwrap();
        record_mesh_entry(&conn, &entry("d1", "run-1", "claude", MeshEntryKind::Decision, "first", 1)).unwrap();
        record_mesh_entry(&conn, &entry("d1", "run-1", "claude", MeshEntryKind::Decision, "revised", 2)).unwrap();
        let r = recover_mesh_context(&conn, "run-1").unwrap();
        assert_eq!(r.len(), 1, "same id replaces");
        assert_eq!(r[0].content, "revised");
    }
}
