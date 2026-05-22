//! Adopt orphan + prune stale per spec §3.1.

use crate::lifecycle::{list, LifecycleError};
use std::path::Path;
use std::time::{Duration, SystemTime};

const ADOPT_LOCK_AGE: Duration = Duration::from_secs(5 * 60);
const PRUNE_LOCK_GRACE: Duration = Duration::from_secs(60);

pub async fn adopt_orphan(path: &Path) -> Result<bool, LifecycleError> {
    let lock_path = path.join(".apohara-lock");
    let lock_age = lock_age_since_modified(&lock_path).unwrap_or(Duration::MAX);
    if lock_age < ADOPT_LOCK_AGE {
        return Ok(false);  // fresh lock — another process owns it
    }
    tokio::fs::write(&lock_path, std::process::id().to_string()).await?;
    Ok(true)
}

pub async fn prune_stale(repo_path: &Path, older_than: Duration) -> Result<usize, LifecycleError> {
    let entries = list(repo_path).await?;
    let mut pruned = 0;
    for entry in entries {
        let dir_age = dir_age_since_modified(&entry.path).unwrap_or(Duration::ZERO);
        if dir_age < older_than { continue; }
        let lock_age = lock_age_since_modified(&entry.path.join(".apohara-lock")).unwrap_or(Duration::MAX);
        if lock_age < PRUNE_LOCK_GRACE { continue; }
        tokio::fs::remove_dir_all(&entry.path).await.ok();
        pruned += 1;
    }
    Ok(pruned)
}

fn lock_age_since_modified(path: &Path) -> Option<Duration> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?;
    SystemTime::now().duration_since(mtime).ok()
}

fn dir_age_since_modified(path: &Path) -> Option<Duration> {
    let meta = std::fs::metadata(path).ok()?;
    let mtime = meta.modified().ok()?;
    SystemTime::now().duration_since(mtime).ok()
}
