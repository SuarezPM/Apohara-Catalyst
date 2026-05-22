//! Lineage per spec §3.1 (orca #6).

use crate::lifecycle::{list, LifecycleError, WorktreeMeta};
use std::path::Path;

pub async fn set_lineage(
    task_id: &str,
    parent_task_id: Option<&str>,
    lineage_root: Option<&str>,
    repo_path: &Path,
) -> Result<(), LifecycleError> {
    let entries = list(repo_path).await?;
    let target = entries.iter().find(|e| e.task_id == task_id)
        .ok_or_else(|| LifecycleError::MetaNotFound(task_id.into()))?;
    let meta_path = target.path.join(".apohara-meta.json");
    let raw = tokio::fs::read_to_string(&meta_path).await?;
    let mut meta: WorktreeMeta = serde_json::from_str(&raw)
        .map_err(|e| LifecycleError::Git(format!("meta parse: {}", e)))?;
    meta.parent_task_id = parent_task_id.map(|s| s.to_string());
    meta.lineage_root = lineage_root.map(|s| s.to_string());
    tokio::fs::write(&meta_path, serde_json::to_string_pretty(&meta).unwrap()).await?;
    Ok(())
}
