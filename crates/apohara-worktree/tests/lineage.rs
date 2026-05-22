use apohara_worktree::lifecycle::create;
use apohara_worktree::lineage::set_lineage;
use apohara_worktree::paths::per_worktree_user_data_dir;
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
async fn set_lineage_updates_meta_file() {
    let repo = tempdir().unwrap();
    init_git_repo(repo.path());
    let path = create("task-A", repo.path()).await.unwrap();
    set_lineage("task-A", Some("parent-task"), Some("objective-1"), repo.path()).await.unwrap();
    let raw = std::fs::read_to_string(path.join(".apohara-meta.json")).unwrap();
    assert!(raw.contains("parent-task"));
    assert!(raw.contains("objective-1"));
}

#[test]
fn per_worktree_user_data_dir_returns_isolated_path() {
    let dir = per_worktree_user_data_dir("task-1").unwrap();
    let dir2 = per_worktree_user_data_dir("task-2").unwrap();
    assert_ne!(dir, dir2);
    assert!(dir.exists());
}