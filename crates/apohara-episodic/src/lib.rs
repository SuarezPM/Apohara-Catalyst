//! Apohara episodic memory: a local, cross-run store of past dispatch episodes
//! (goal, providers, winning diff summary, gate verdicts, outcome).
//!
//! Reuses `apohara-indexer`'s sqlite-vec storage + blake3 `feature_hash_embed`
//! primitives (same `EMBED_DIM`), so recall is **feature-similarity recall** —
//! keyword-ish over short goal strings, NOT semantic. Zero tokens, zero model,
//! local only.
//!
//! The store lives at `~/.apohara/episodes/episodes.db` (durable, distinct from
//! the new-per-run `orchestration.db`). See `path` for the resolution and
//! `store` for the schema + insert/query/recall surface.

pub mod path;
pub mod store;

pub use path::default_episode_db_path;
pub use store::{
    insert_episode, list_episodes, open_episode_db, query_episodes, search_episodes, Episode,
};

use anyhow::Result;

/// Capture one episode into the default home-anchored store
/// (`~/.apohara/episodes/episodes.db`). Opens the DB (triggering the
/// process-global vec0 registration) and inserts the episode.
///
/// Callers in the dispatch path should treat this as best-effort: log on
/// `Err`, never block or panic the run.
pub fn capture_episode(episode: &Episode) -> Result<()> {
    let conn = open_episode_db(&default_episode_db_path())?;
    insert_episode(&conn, episode)
}

/// Feature-similarity recall of the top-`k` past episodes most similar to
/// `goal`, from the default home-anchored store. This is **feature-similarity
/// recall**, NOT semantic — keyword-ish over short goal strings (see `store`).
/// Zero tokens, zero model. An empty `Vec` is the natural answer for a fresh
/// store; callers should treat errors as best-effort (recall is advisory).
pub fn recall_for_goal(goal: &str, k: usize) -> Result<Vec<Episode>> {
    let conn = open_episode_db(&default_episode_db_path())?;
    query_episodes(&conn, goal, k)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Roundtrip: insert an episode via the store, then recall it by goal.
    /// Uses an explicit store handle (not the home path) so the test is
    /// hermetic; the home-path wrappers above are thin and covered by their
    /// underlying `store` tests.
    #[test]
    #[serial_test::serial(episodic_fresh_process)]
    fn recall_roundtrips_a_captured_goal() {
        let dir = tempfile::tempdir().unwrap();
        let conn = open_episode_db(&dir.path().join("episodes.db")).unwrap();
        let ep = Episode {
            id: "r1".to_string(),
            goal: "refactor the parser module".to_string(),
            timestamp: 1,
            providers: vec!["claude-code-cli".to_string()],
            winning_diff_summary: "claude-code-cli changed 2 file(s)".to_string(),
            gate_verdicts: vec!["passed".to_string()],
            outcome: "winner-selected".to_string(),
        };
        insert_episode(&conn, &ep).unwrap();
        let recalled = query_episodes(&conn, "refactor the parser module", 5).unwrap();
        assert_eq!(recalled.len(), 1);
        assert_eq!(recalled[0], ep, "recall must return the captured episode");
    }
}
