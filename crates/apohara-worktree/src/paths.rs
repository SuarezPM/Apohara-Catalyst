//! Per-worktree userData directory per spec §7.5.3.

use std::path::PathBuf;
use crate::lifecycle::LifecycleError;

pub fn per_worktree_user_data_dir(task_id: &str) -> Result<PathBuf, LifecycleError> {
    let base = dirs::data_dir()
        .ok_or_else(|| LifecycleError::Git("no data dir".into()))?
        .join("apohara").join("worktrees").join(task_id);
    std::fs::create_dir_all(&base)?;
    Ok(base)
}
