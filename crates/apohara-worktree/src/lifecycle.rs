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
            // §3.1 — consult `delete_preflight` before any destructive
            // op. The old `git worktree remove --force` would silently
            // wipe uncommitted user work or unpushed commits. If the
            // worktree is anything other than Clean we route through
            // `preserve_on_fail` (creates a recovery branch + leaves
            // the directory) and return without touching disk.
            match crate::preflight::delete_preflight(task_id, repo_path).await {
                Ok(crate::preflight::PreflightReport::Clean) => {
                    // git worktree remove (no --force needed — preflight already
                    // confirmed the tree is clean and pushed)
                    let _ = Command::new("git")
                        .args([
                            "-C",
                            repo_path.to_str().unwrap(),
                            "worktree",
                            "remove",
                            target.path.to_str().unwrap(),
                        ])
                        .output()
                        .await?;
                    tokio::fs::remove_dir_all(&target.path).await.ok();
                }
                Ok(report) => {
                    tracing::warn!(
                        ?report,
                        "cleanup({:?}) refused — worktree has dirty files / unpushed commits / live agent; routing through preserve_on_fail",
                        reason,
                    );
                    // The recovery branch + tracing line preserve the user's
                    // work and emit an actionable diagnostic. Failure here
                    // is non-fatal — we still leave the worktree on disk.
                    let _ = preserve_on_fail(task_id, FailureReason::Cancelled, repo_path).await;
                }
                Err(err) => {
                    tracing::warn!(?err, "cleanup({:?}) preflight failed; leaving worktree in place", reason);
                }
            }
        }
        CleanupReason::Failed => {
            // NO-OP: preserve for inspection
            tracing::warn!("cleanup(Failed) for {} — preserving worktree at {:?}", task_id, target.path);
        }
    }
    Ok(())
}

#[derive(Debug, Clone)]
pub enum MergeResult {
    Success,
    Conflict { files: Vec<PathBuf> },
}

#[derive(Debug, Clone, Copy)]
pub enum FailureReason { MergeConflict, AgentFailed, Cancelled }

/// The single serialized integrator (US-F1.6). Every `merge` acquires this lock
/// and holds it for the ENTIRE `git merge`, so only one merge ever writes HEAD
/// at a time. This is the one place HEAD is mutated.
///
/// Past incident (load-bearing): two concurrent `git merge --no-ff` into the
/// same repo race on HEAD and the index → repository corruption. Funnelling all
/// integration through one async `Mutex` (guard held across the await) makes the
/// single-HEAD-writer invariant structural, not a convention. Mirrors the
/// `BINARY_LOCKS` pattern in `apohara-dispatch::cli_driver`.
static INTEGRATOR_LOCK: std::sync::LazyLock<tokio::sync::Mutex<()>> =
    std::sync::LazyLock::new(|| tokio::sync::Mutex::new(()));

/// Integrate `task_id`'s branch into the repo's HEAD with `git merge --no-ff`.
///
/// Serialized through [`INTEGRATOR_LOCK`]: the guard is acquired before the
/// merge and held until this function returns, so concurrent callers queue
/// instead of racing on HEAD/index (the single-HEAD-writer invariant). On a
/// conflict we run `git merge --abort` BEFORE returning `Conflict` — a
/// half-merged repo (conflict markers + a wedged MERGE_HEAD) would corrupt the
/// NEXT node's integration, so HEAD must be left clean here.
pub async fn merge(task_id: &str, repo_path: &Path) -> Result<MergeResult, LifecycleError> {
    let entries = list(repo_path).await?;
    let target = entries.iter().find(|e| e.task_id == task_id).ok_or_else(|| LifecycleError::MetaNotFound(task_id.into()))?;
    let branch = &target.branch;

    // Hold the integrator guard for the whole merge: one HEAD writer at a time.
    let _guard = INTEGRATOR_LOCK.lock().await;

    // git merge --no-ff <branch> from the main repo cwd
    let out = Command::new("git").args(["-C", repo_path.to_str().unwrap(), "merge", "--no-ff", branch])
        .output().await?;
    if out.status.success() {
        return Ok(MergeResult::Success);
    }

    // Capture the conflicted files BEST-EFFORT (--diff-filter=U is empty once
    // the merge is aborted, so read it while the merge is live), then ALWAYS
    // abort. Neither step is `?`-gated: a half-merged repo (wedged MERGE_HEAD +
    // conflict markers) would corrupt the NEXT node's integration, so the abort
    // must stay on the critical path even if conflict detection failed to spawn.
    // Still under the integrator guard — no other merge can observe the
    // in-between state. `git merge --abort` is idempotent when nothing is
    // in progress.
    let files: Vec<PathBuf> = Command::new("git")
        .args(["-C", repo_path.to_str().unwrap(), "diff", "--name-only", "--diff-filter=U"])
        .output()
        .await
        .map(|s| {
            String::from_utf8_lossy(&s.stdout)
                .lines()
                .map(|l| PathBuf::from(l.trim()))
                .filter(|p| !p.as_os_str().is_empty())
                .collect()
        })
        .unwrap_or_default();

    let _ = Command::new("git")
        .args(["-C", repo_path.to_str().unwrap(), "merge", "--abort"])
        .output()
        .await;

    Ok(MergeResult::Conflict { files })
}

pub async fn preserve_on_fail(task_id: &str, reason: FailureReason, repo_path: &Path) -> Result<String, LifecycleError> {
    let entries = list(repo_path).await?;
    let target = entries.iter().find(|e| e.task_id == task_id).ok_or_else(|| LifecycleError::MetaNotFound(task_id.into()))?;
    let ts = chrono::Utc::now().timestamp();
    let reason_slug = match reason {
        FailureReason::MergeConflict => "merge_conflict",
        FailureReason::AgentFailed => "agent_failed",
        FailureReason::Cancelled => "cancelled",
    };
    let failed_branch = format!("apohara/task-{}-failed-{}", task_id, ts);

    // git branch -f <failed_branch> HEAD (inside the worktree)
    Command::new("git").args(["-C", target.path.to_str().unwrap(), "branch", "-f", &failed_branch])
        .output().await?;
    tracing::warn!("preserved worktree for {} (reason={}) at branch={}", task_id, reason_slug, failed_branch);
    Ok(failed_branch)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command as StdCommand;
    use tempfile::tempdir;

    /// Run a git subcommand in `dir` (sync — these are test fixtures, not the
    /// product path). Panics on spawn failure so a broken fixture is loud.
    fn git(dir: &Path, args: &[&str]) -> std::process::Output {
        StdCommand::new("git").arg("-C").arg(dir).args(args).output().expect("git")
    }

    /// `git -C <dir> <args>` and return trimmed stdout.
    fn git_stdout(dir: &Path, args: &[&str]) -> String {
        String::from_utf8_lossy(&git(dir, args).stdout).trim().to_string()
    }

    /// Init a repo with one base commit. The `.gitignore` matches production:
    /// `.claude/worktrees/` (where `create` checks out worktrees — otherwise it
    /// shows as `?? .claude/` in the main repo's status) plus the per-worktree
    /// marker files (`.apohara-meta.json`/`.apohara-lock`) so that `git add -A`
    /// inside a worktree stages only real work, not worktree-local noise (see
    /// `preflight.rs`, which filters the same markers).
    fn init_repo(dir: &Path) {
        git(dir, &["init", "--initial-branch=main"]);
        git(dir, &["config", "user.email", "t@t"]);
        git(dir, &["config", "user.name", "t"]);
        std::fs::write(
            dir.join(".gitignore"),
            ".claude/worktrees/\n.apohara-meta.json\n.apohara-lock\n",
        )
        .unwrap();
        std::fs::write(dir.join("base.txt"), "base\n").unwrap();
        git(dir, &["add", "."]);
        git(dir, &["commit", "-m", "init"]);
    }

    #[tokio::test]
    async fn two_worktrees_integrate_sequentially_without_corrupting_head() {
        let repo_dir = tempdir().unwrap();
        let repo = repo_dir.path();
        init_repo(repo);

        // Two worktrees, each committing a DISJOINT file on its own branch.
        let wt_a = create("task-a", repo).await.unwrap();
        std::fs::write(wt_a.join("a.txt"), "from-a\n").unwrap();
        git(&wt_a, &["add", "-A"]);
        git(&wt_a, &["commit", "-m", "work a"]);

        let wt_b = create("task-b", repo).await.unwrap();
        std::fs::write(wt_b.join("b.txt"), "from-b\n").unwrap();
        git(&wt_b, &["add", "-A"]);
        git(&wt_b, &["commit", "-m", "work b"]);

        // The serialized integrator merges both, one HEAD writer at a time.
        let r_a = merge("task-a", repo).await.unwrap();
        let r_b = merge("task-b", repo).await.unwrap();
        assert!(matches!(r_a, MergeResult::Success), "task-a should integrate: {r_a:?}");
        assert!(matches!(r_b, MergeResult::Success), "task-b should integrate: {r_b:?}");

        // HEAD now contains BOTH files (the mesh).
        assert!(repo.join("a.txt").exists(), "a.txt missing from HEAD");
        assert!(repo.join("b.txt").exists(), "b.txt missing from HEAD");

        // Working tree is clean — no half-merged residue.
        assert!(
            git_stdout(repo, &["status", "--porcelain"]).is_empty(),
            "repo should be clean after sequential integration"
        );

        // No object-store corruption.
        let fsck = git(repo, &["fsck", "--full"]);
        assert!(fsck.status.success(), "git fsck failed: {}", String::from_utf8_lossy(&fsck.stderr));
    }

    #[tokio::test]
    async fn conflicting_merge_aborts_and_leaves_head_clean() {
        let repo_dir = tempdir().unwrap();
        let repo = repo_dir.path();
        init_repo(repo);

        // Seed a shared file on main so both worktrees edit the SAME line.
        std::fs::write(repo.join("shared.txt"), "original\n").unwrap();
        git(repo, &["add", "-A"]);
        git(repo, &["commit", "-m", "add shared"]);

        let wt_a = create("task-a", repo).await.unwrap();
        std::fs::write(wt_a.join("shared.txt"), "from-a\n").unwrap();
        git(&wt_a, &["add", "-A"]);
        git(&wt_a, &["commit", "-m", "edit shared a"]);

        let wt_b = create("task-b", repo).await.unwrap();
        std::fs::write(wt_b.join("shared.txt"), "from-b\n").unwrap();
        git(&wt_b, &["add", "-A"]);
        git(&wt_b, &["commit", "-m", "edit shared b"]);

        // First integrates cleanly; second conflicts on the shared line.
        let r_a = merge("task-a", repo).await.unwrap();
        assert!(matches!(r_a, MergeResult::Success), "first merge should succeed: {r_a:?}");

        let r_b = merge("task-b", repo).await.unwrap();
        match &r_b {
            MergeResult::Conflict { files } => {
                assert!(
                    files.iter().any(|f| f.ends_with("shared.txt")),
                    "conflict set should name shared.txt: {files:?}"
                );
            }
            other => panic!("second merge should conflict, got {other:?}"),
        }

        // The abort left HEAD/index CLEAN so the NEXT integration isn't corrupted.
        assert!(
            git_stdout(repo, &["status", "--porcelain"]).is_empty(),
            "repo should be clean after the conflict abort"
        );
        // MERGE_HEAD must be gone (no wedged in-progress merge).
        assert!(!repo.join(".git").join("MERGE_HEAD").exists(), "MERGE_HEAD should be cleared by --abort");
    }
}
