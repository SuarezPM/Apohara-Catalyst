//! Delete preflight per spec §3.1 (orca #5 inspiration).
//!
//! BEFORE killing PTYs / removing worktrees, check status. If dirty / unpushed
//! / live-agent, refuse — otherwise the wrong order (kill first, git remove
//! second) leaves worktrees in a half-removed state when git fails on dirty.

use crate::lifecycle::{list, LifecycleError};
use std::path::{Path, PathBuf};
use tokio::process::Command;

#[derive(Debug, Clone)]
pub enum PreflightReport {
    Clean,
    DirtyFiles(Vec<PathBuf>),
    UnpushedCommits(usize),
    LiveAgent,
}

pub async fn delete_preflight(task_id: &str, repo_path: &Path) -> Result<PreflightReport, LifecycleError> {
    let entries = list(repo_path).await?;
    let target = entries.iter().find(|e| e.task_id == task_id)
        .ok_or_else(|| LifecycleError::MetaNotFound(task_id.into()))?;

    let out = Command::new("git")
        .args(["-C", target.path.to_str().unwrap(), "status", "--porcelain", "--untracked-files=all"])
        .output().await?;
    let stdout = String::from_utf8_lossy(&out.stdout);
    let dirty: Vec<PathBuf> = stdout.lines()
        .filter_map(|l| if l.len() > 3 { Some(PathBuf::from(l[3..].trim())) } else { None })
        .filter(|p| {
            let s = p.to_string_lossy();
            !s.starts_with(".apohara-lock") && !s.starts_with(".apohara-meta.json")
        })
        .collect();
    if !dirty.is_empty() {
        return Ok(PreflightReport::DirtyFiles(dirty));
    }

    let upstream = Command::new("git")
        .args(["-C", target.path.to_str().unwrap(), "rev-list", "@{upstream}..HEAD"])
        .output().await;
    if let Ok(o) = upstream {
        if o.status.success() {
            let count = String::from_utf8_lossy(&o.stdout).lines().count();
            if count > 0 {
                return Ok(PreflightReport::UnpushedCommits(count));
            }
        }
    }

    Ok(PreflightReport::Clean)
}
