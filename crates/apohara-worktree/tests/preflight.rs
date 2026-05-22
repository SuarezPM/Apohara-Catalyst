use apohara_worktree::lifecycle::create;
use apohara_worktree::preflight::{delete_preflight, PreflightReport};
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
async fn preflight_clean_for_unmodified_worktree() {
    let repo = tempdir().unwrap();
    init_git_repo(repo.path());
    create("task-1", repo.path()).await.unwrap();
    let report = delete_preflight("task-1", repo.path()).await.unwrap();
    match report { PreflightReport::Clean => (), other => panic!("expected Clean, got {:?}", other), }
}

#[tokio::test]
async fn preflight_dirty_for_uncommitted_changes() {
    let repo = tempdir().unwrap();
    init_git_repo(repo.path());
    let path = create("task-1", repo.path()).await.unwrap();
    std::fs::write(path.join("dirty.txt"), "uncommitted\n").unwrap();
    let report = delete_preflight("task-1", repo.path()).await.unwrap();
    match report {
        PreflightReport::DirtyFiles(files) => assert!(!files.is_empty()),
        other => panic!("expected DirtyFiles, got {:?}", other),
    }
}