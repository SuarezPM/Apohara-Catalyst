//! Episode DB path resolution.
//!
//! The episode store is a durable, cross-run database — it must NOT be
//! anchored to `current_dir()`, because dispatch runs each provider in its own
//! git worktree (`dispatch_loop.rs`), which would fork the store per worktree.
//! Anchor it to `~/.apohara/episodes/episodes.db` instead, mirroring the
//! `~/.apohara/` path convention in `apohara-mcp`'s `bootstrap.rs`.

use std::path::PathBuf;

/// Default location of the cross-run episode store:
/// `~/.apohara/episodes/episodes.db`. Falls back to a `.`-relative path only
/// when the home directory cannot be resolved (mirrors `bootstrap.rs`).
pub fn default_episode_db_path() -> PathBuf {
    let mut p = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    p.push(".apohara");
    p.push("episodes");
    p.push("episodes.db");
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_is_home_anchored() {
        let p = default_episode_db_path();
        let home = dirs::home_dir().expect("home dir resolvable in test env");
        assert!(
            p.starts_with(&home),
            "episode db path must be under the home dir: {p:?} not under {home:?}"
        );
        assert!(p.ends_with("episodes/episodes.db"), "got {p:?}");
    }

    #[test]
    fn path_is_cwd_independent() {
        // Resolving from two different working directories must yield the same
        // absolute path — the store is a single durable file, never per-cwd.
        let before = default_episode_db_path();
        let tmp = tempfile::tempdir().unwrap();
        let original = std::env::current_dir().unwrap();
        std::env::set_current_dir(tmp.path()).unwrap();
        let after = default_episode_db_path();
        std::env::set_current_dir(original).unwrap();
        assert_eq!(before, after, "path must not depend on current_dir()");
    }
}
