use apohara_worktree::cleanup::{adopt_orphan, prune_stale};
use apohara_worktree::lifecycle::create;
use std::process::Command;
use std::time::Duration;
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
async fn adopt_orphan_returns_false_for_fresh_lock() {
    let repo = tempdir().unwrap();
    init_git_repo(repo.path());
    let path = create("task-1", repo.path()).await.unwrap();
    let adopted = adopt_orphan(&path).await.unwrap();
    assert!(!adopted);
}

#[tokio::test]
async fn prune_stale_removes_old_worktrees() {
    let repo = tempdir().unwrap();
    init_git_repo(repo.path());
    let path = create("task-1", repo.path()).await.unwrap();

    let old = std::time::SystemTime::UNIX_EPOCH + Duration::from_secs(1_000_000);
    filetime::set_file_mtime(&path, filetime::FileTime::from_system_time(old)).unwrap();
    filetime::set_file_mtime(path.join(".apohara-lock"), filetime::FileTime::from_system_time(old)).unwrap();

    let pruned = prune_stale(repo.path(), Duration::from_secs(60)).await.unwrap();
    assert_eq!(pruned, 1);
    assert!(!path.exists());
}