//! Lifecycle verbs per spec §3.1.

use crate::naming::random_slug;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use thiserror::Error;
use tokio::process::Command;

const META_FILE: &str = ".apohara-meta.json";
const LOCK_FILE: &str = ".apohara-lock";
const WORKTREE_BASE: &str = ".claude/worktrees";

#[derive(Debug, Error)]
pub enum LifecycleError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("git: {0}")]
    Git(String),
    #[error("naming: {0}")]
    Naming(#[from] crate::naming::NamingError),
    #[error("metadata not found for {0}")]
    MetaNotFound(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeMeta {
    pub task_id: String,
    pub created_at: String,
    pub branch: String,
    pub parent_task_id: Option<String>,
    pub lineage_root: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorktreeEntry {
    pub task_id: String,
    pub path: PathBuf,
    pub branch: String,
}

#[derive(Debug, Clone, Copy)]
pub enum CleanupReason { Completed, Failed, Cancelled }

pub async fn create(task_id: &str, repo_path: &Path) -> Result<PathBuf, LifecycleError> {
    let base = repo_path.join(WORKTREE_BASE);
    tokio::fs::create_dir_all(&base).await?;

    let slug = random_slug();
    let path = base.join(&slug);
    let branch = format!("apohara/{}", slug);

    // git worktree add -b <branch> <path>
    let out = Command::new("git").args(["-C", repo_path.to_str().unwrap(), "worktree", "add", "-b", &branch, path.to_str().unwrap()])
        .output().await?;
    if !out.status.success() {
        return Err(LifecycleError::Git(String::from_utf8_lossy(&out.stderr).into_owned()));
    }

    let meta = WorktreeMeta {
        task_id: task_id.into(),
        created_at: chrono::Utc::now().to_rfc3339(),
        branch,
        parent_task_id: None,
        lineage_root: None,
    };
    let meta_path = path.join(META_FILE);
    tokio::fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap()).await?;

    let lock_path = path.join(LOCK_FILE);
    tokio::fs::write(&lock_path, std::process::id().to_string()).await?;

    Ok(path)
}

pub async fn list(repo_path: &Path) -> Result<Vec<WorktreeEntry>, LifecycleError> {
    let base = repo_path.join(WORKTREE_BASE);
    let mut entries = Vec::new();
    let mut read = match tokio::fs::read_dir(&base).await {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(entries),
        Err(e) => return Err(e.into()),
    };
    while let Some(entry) = read.next_entry().await? {
        let path = entry.path();
        let meta_path = path.join(META_FILE);
        if !meta_path.exists() { continue; }
        let raw = tokio::fs::read_to_string(&meta_path).await?;
        let meta: WorktreeMeta = serde_json::from_str(&raw)
            .map_err(|e| LifecycleError::Git(format!("meta parse: {}", e)))?;
        entries.push(WorktreeEntry { task_id: meta.task_id, path, branch: meta.branch });
    }
    Ok(entries)
}

pub async fn cleanup(task_id: &str, reason: CleanupReason, repo_path: &Path) -> Result<(), LifecycleError> {
    let entries = list(repo_path).await?;
    let target = entries.iter().find(|e| e.task_id == task_id).ok_or_else(|| LifecycleError::MetaNotFound(task_id.into()))?;
    match reason {
        CleanupReason::Completed | CleanupReason::Cancelled => {
            // git worktree remove --force <path>
            let _ = Command::new("git").args(["-C", repo_path.to_str().unwrap(), "worktree", "remove", "--force", target.path.to_str().unwrap()])
                .output().await?;
            tokio::fs::remove_dir_all(&target.path).await.ok();
        }
        CleanupReason::Failed => {
            // NO-OP: preserve for inspection
            tracing::warn!("cleanup(Failed) for {} — preserving worktree at {:?}", task_id, target.path);
        }
    }
    Ok(())
}
