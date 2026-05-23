//! WARM cache tier — SQLite in WAL mode for durable, cross-process persistence.
//!
//! Schema (single table):
//! ```sql
//! CREATE TABLE cache (
//!     key       BLOB PRIMARY KEY,
//!     content   BLOB NOT NULL,
//!     simhash   INTEGER NOT NULL,
//!     timestamp INTEGER NOT NULL
//! )
//! ```
//!
//! Pragmas: `journal_mode=WAL`, `synchronous=NORMAL`. WAL gives us the
//! same crash safety as full sync at a fraction of the fsync cost.
//! `INSERT OR REPLACE` is used so a re-store overwrites cleanly without
//! a separate upsert path.
//!
//! `:memory:` is supported for unit tests (`WarmCache::open_in_memory()`).

use crate::hot::CachedResponse;
use crate::key::CacheKey;
use anyhow::{Context, Result};
use rusqlite::{params, Connection};
use std::path::Path;
use std::sync::Mutex;

pub struct WarmCache {
    conn: Mutex<Connection>,
}

impl WarmCache {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let conn = Connection::open(path).context("open sqlite")?;
        Self::configure(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Convenience for unit tests — opens an in-memory DB. WAL is not
    /// applicable to `:memory:`, so we skip the pragma there.
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory().context("open sqlite :memory:")?;
        // synchronous=NORMAL is fine for memory; skip WAL.
        conn.pragma_update(None, "synchronous", "NORMAL")
            .context("synchronous pragma")?;
        Self::create_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    fn configure(conn: &Connection) -> Result<()> {
        conn.pragma_update(None, "journal_mode", "WAL")
            .context("WAL pragma")?;
        conn.pragma_update(None, "synchronous", "NORMAL")
            .context("synchronous pragma")?;
        Self::create_schema(conn)
    }

    fn create_schema(conn: &Connection) -> Result<()> {
        conn.execute(
            "CREATE TABLE IF NOT EXISTS cache (
                key       BLOB PRIMARY KEY,
                content   BLOB NOT NULL,
                simhash   INTEGER NOT NULL,
                timestamp INTEGER NOT NULL
            )",
            [],
        )
        .context("create cache table")?;
        Ok(())
    }

    pub fn put(&self, key: &CacheKey, response: &CachedResponse) -> Result<()> {
        let conn = self.conn.lock().expect("warm cache mutex poisoned");
        conn.execute(
            "INSERT OR REPLACE INTO cache (key, content, simhash, timestamp) \
             VALUES (?, ?, ?, ?)",
            params![
                &key[..],
                &response.content,
                response.simhash as i64,
                response.timestamp as i64,
            ],
        )
        .context("insert cache row")?;
        Ok(())
    }

    pub fn get(&self, key: &CacheKey) -> Result<Option<CachedResponse>> {
        let conn = self.conn.lock().expect("warm cache mutex poisoned");
        let mut stmt = conn
            .prepare("SELECT content, simhash, timestamp FROM cache WHERE key = ?")
            .context("prepare select")?;
        let mut rows = stmt.query(params![&key[..]]).context("query")?;
        if let Some(row) = rows.next().context("next row")? {
            let content: Vec<u8> = row.get(0)?;
            let simhash: i64 = row.get(1)?;
            let timestamp: i64 = row.get(2)?;
            Ok(Some(CachedResponse {
                content,
                simhash: simhash as u64,
                timestamp: timestamp as u64,
            }))
        } else {
            Ok(None)
        }
    }

    pub fn len(&self) -> Result<u64> {
        let conn = self.conn.lock().expect("warm cache mutex poisoned");
        let n: i64 = conn
            .query_row("SELECT COUNT(*) FROM cache", [], |r| r.get(0))
            .context("count rows")?;
        Ok(n as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn dummy_key(seed: u8) -> CacheKey {
        let mut k = [0u8; 32];
        k[0] = seed;
        k
    }

    #[test]
    fn warm_put_then_get_round_trips_in_memory() {
        let cache = WarmCache::open_in_memory().expect("open :memory:");
        let key = dummy_key(42);
        let resp = CachedResponse {
            content: b"hello-warm".to_vec(),
            simhash: 0xCAFE_BABE,
            timestamp: 100,
        };
        cache.put(&key, &resp).expect("put");
        let got = cache.get(&key).expect("get").expect("hit");
        assert_eq!(got.content, b"hello-warm");
        assert_eq!(got.simhash, 0xCAFE_BABE);
        assert_eq!(got.timestamp, 100);
    }

    #[test]
    fn warm_miss_returns_none() {
        let cache = WarmCache::open_in_memory().unwrap();
        assert!(cache.get(&dummy_key(7)).unwrap().is_none());
    }

    #[test]
    fn warm_insert_or_replace_overwrites() {
        let cache = WarmCache::open_in_memory().unwrap();
        let key = dummy_key(3);
        cache
            .put(
                &key,
                &CachedResponse {
                    content: b"v1".to_vec(),
                    simhash: 1,
                    timestamp: 1,
                },
            )
            .unwrap();
        cache
            .put(
                &key,
                &CachedResponse {
                    content: b"v2".to_vec(),
                    simhash: 2,
                    timestamp: 2,
                },
            )
            .unwrap();
        let got = cache.get(&key).unwrap().unwrap();
        assert_eq!(got.content, b"v2");
        assert_eq!(cache.len().unwrap(), 1, "PK collision -> one row only");
    }

    #[test]
    fn warm_persists_across_open_with_tempdir() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("persist.db");
        let key = dummy_key(7);

        {
            let cache = WarmCache::open(&db_path).unwrap();
            cache
                .put(
                    &key,
                    &CachedResponse {
                        content: b"persist".to_vec(),
                        simhash: 1,
                        timestamp: 1,
                    },
                )
                .unwrap();
        }
        {
            let cache = WarmCache::open(&db_path).unwrap();
            let got = cache.get(&key).unwrap().unwrap();
            assert_eq!(got.content, b"persist");
        }
    }

    #[test]
    fn warm_open_creates_wal_journal() {
        let dir = TempDir::new().unwrap();
        let db_path = dir.path().join("wal.db");
        let cache = WarmCache::open(&db_path).unwrap();
        // Touch the DB so WAL files materialise.
        cache
            .put(
                &dummy_key(1),
                &CachedResponse {
                    content: b"x".to_vec(),
                    simhash: 0,
                    timestamp: 0,
                },
            )
            .unwrap();
        // sqlite creates <db>-wal once WAL is engaged + writes flow.
        let wal_path = db_path.with_extension("db-wal");
        assert!(
            wal_path.exists(),
            "expected WAL sidecar at {}",
            wal_path.display()
        );
    }
}
