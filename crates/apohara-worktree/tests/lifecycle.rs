use apohara_worktree::lifecycle::{create, list, cleanup, CleanupReason, WorktreeEntry};
use std::process::Command;
use tempfile::tempdir;

fn init_git_repo(dir: &std::path::Path) {
    Command::new("git").args(["init", "--initial-branch=main"]).current_dir(dir).output().unwrap();
    Command::new("git").args(["config", "user.email", "t@t"]).current_dir(dir).output().unwrap();
    Command::new("git").args(["config", "user.name", "t"]).current_dir(dir).output().unwrap();
    std::fs::write(dir.join("README.md"), "init\n").unwrap();
    Command::new("git").args(["add", "."]).current_dir(dir).output().unwrap();
    Command::new("git").args(["commit", "-m", "init"]).current_dir(dir).output().unwrap();
}

#[tokio::test]
async fn create_worktree_returns_path_under_base() {
    let repo = tempdir().unwrap();
    init_git_repo(repo.path());
    let path = create("task-1", repo.path()).await.unwrap();
    assert!(path.starts_with(repo.path().join(".claude/worktrees")));
    assert!(path.exists());
}

#[tokio::test]
async fn list_returns_created_worktrees() {
    let repo = tempdir().unwrap();
    init_git_repo(repo.path());
    create("task-A", repo.path()).await.unwrap();
    create("task-B", repo.path()).await.unwrap();
    let entries: Vec<WorktreeEntry> = list(repo.path()).await.unwrap();
    assert_eq!(entries.len(), 2);
    let task_ids: std::collections::HashSet<String> = entries.iter().map(|e| e.task_id.clone()).collect();
    assert!(task_ids.contains("task-A"));
    assert!(task_ids.contains("task-B"));
}

#[tokio::test]
async fn cleanup_completed_removes_worktree_directory() {
    let repo = tempdir().unwrap();
    init_git_repo(repo.path());
    let path = create("task-1", repo.path()).await.unwrap();
    cleanup("task-1", CleanupReason::Completed, repo.path()).await.unwrap();
    assert!(!path.exists());
}

#[tokio::test]
async fn cleanup_failed_is_noop_preserves_directory() {
    let repo = tempdir().unwrap();
    init_git_repo(repo.path());
    let path = create("task-1", repo.path()).await.unwrap();
    cleanup("task-1", CleanupReason::Failed, repo.path()).await.unwrap();
    assert!(path.exists(), "Failed cleanup must preserve worktree for inspection");
}
