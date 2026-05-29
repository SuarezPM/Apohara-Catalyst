//! Direct API surface for the Rust mcp path (Sprint 23: ex-`tauri_bridge`).
//!
//! Pure async functions callable directly from the Dioxus desktop via
//! `use_future` — no Tauri, no IPC. The gate logic + inner async commands
//! remain testable from plain cargo.
//!
//! Flag: `APOHARA_RUST_MCP=1` defaults ON post-G1.D.2 flip. Export =0 to opt out (TS
//! legacy continues to handle MCP until Phase 1 cierre flips defaults
//! in G1.D.2).

use std::path::PathBuf;
use std::sync::Arc;

use crate::bootstrap::{
    bootstrap_mcp_servers, BootstrapHandle, BootstrapOpts, EndpointDescriptor,
};
use crate::injection::{inject_mcp_config, InjectionResult, ProviderId};
use crate::servers::indexer::StubIndexerClient;
use crate::servers::ledger::{LedgerBackend, LedgerEvent};
use crate::servers::runs::{ListFilter, RunRow, RunsBackend, TaskOutcome};
use crate::McpCanonical;

use async_trait::async_trait;

/// Pure gate predicate — testable without env mutation.
pub fn is_enabled(env_value: Option<&str>) -> bool {
    env_value != Some("0")
}

fn check_enabled() -> Result<(), String> {
    let env = std::env::var("APOHARA_RUST_MCP").ok();
    if !is_enabled(env.as_deref()) {
        return Err("APOHARA_RUST_MCP explicitly disabled (=0) — TS legacy path active".to_string());
    }
    Ok(())
}

/// Episode-backed `LedgerBackend`, replacing the previous `EmptyLedger`
/// pre-wire stub. Reads the durable cross-run episode store
/// (`apohara-episodic`) and maps each `Episode` onto a `LedgerEvent`.
///
/// # Lossy mapping (Decision 7A)
///
/// `LedgerBackend` is `run_id`-keyed and `LedgerEvent` is
/// `{id, from_handle, to_handle, type, payload, ts}`, while episodes are
/// goal/timestamp-keyed with no run_id. The mapping is therefore explicit and
/// lossy:
///   - `episode.id` → `event.id` (String hashed to a stable positive i64,
///     since `LedgerEvent.id` is i64)
///   - `episode.goal` + `episode.outcome` summary → `event.payload`
///   - `episode.timestamp` → `event.ts`
///   - `event.type` fixed to `"episode"`; `from_handle = to_handle = None`
///
/// `read_events` / `search_events` carry natural episode meaning and return
/// mapped episodes (most-recent-first; substring match over goal/payload).
///
/// `replay_run(run_id)` and `last_event(run_id, type)` are
/// **DEGENERATE-BY-DESIGN**: episodes have no run_id, so `replay_run` ignores
/// the partition and returns all episodes as a flat list, and `last_event`
/// returns the most-recent episode of the matching `type`. A run-keyed seam
/// (a dedicated episode MCP tool surface) is a deliberate follow-up
/// (ADR Follow-up; Decision 7B), not a v1 blocker.
struct EpisodicLedger {
    db_path: PathBuf,
}

impl EpisodicLedger {
    /// Cap on rows returned by the run-agnostic methods, mirroring the
    /// `LedgerBackend` search contract ("at most 100 matches").
    const MAX_ROWS: usize = 100;
    const EVENT_TYPE: &'static str = "episode";

    fn new(db_path: PathBuf) -> Self {
        Self { db_path }
    }

    /// Map an `Episode` onto a `LedgerEvent` (lossy — see type docs).
    fn to_event(ep: &apohara_episodic::Episode) -> LedgerEvent {
        let payload = if ep.outcome.is_empty() {
            ep.goal.clone()
        } else {
            format!("{} [{}]", ep.goal, ep.outcome)
        };
        LedgerEvent {
            id: episode_id_to_event_id(&ep.id),
            from_handle: None,
            to_handle: None,
            r#type: Self::EVENT_TYPE.to_string(),
            payload,
            ts: ep.timestamp,
        }
    }

}

/// Derive a stable, non-negative `i64` from an episode id string (FNV-1a).
/// Needed because `LedgerEvent.id` is `i64` while `Episode.id` is a `String`.
fn episode_id_to_event_id(id: &str) -> i64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for b in id.as_bytes() {
        hash ^= *b as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    (hash >> 1) as i64
}

#[async_trait]
impl LedgerBackend for EpisodicLedger {
    async fn read_events(
        &self,
        _run_id: Option<&str>,
        types: Option<&[String]>,
        offset: i64,
        limit: i64,
    ) -> Result<Vec<LedgerEvent>, String> {
        // run_id partition ignored (episodes have no run_id — documented).
        // `types` is honored as an OR filter against the fixed "episode" type.
        if let Some(t) = types {
            if !t.iter().any(|x| x == Self::EVENT_TYPE) {
                return Ok(vec![]);
            }
        }
        let conn = apohara_episodic::open_episode_db(&self.db_path).map_err(|e| e.to_string())?;
        let episodes = apohara_episodic::list_episodes(&conn, Self::MAX_ROWS)
            .map_err(|e| e.to_string())?;
        let events = episodes
            .iter()
            .skip(offset.max(0) as usize)
            .take(limit.max(0) as usize)
            .map(Self::to_event)
            .collect();
        Ok(events)
    }

    async fn replay_run(&self, _run_id: &str) -> Result<Vec<LedgerEvent>, String> {
        // DEGENERATE-BY-DESIGN: no run_id on episodes — return all, flat.
        let conn = apohara_episodic::open_episode_db(&self.db_path).map_err(|e| e.to_string())?;
        let episodes = apohara_episodic::list_episodes(&conn, Self::MAX_ROWS)
            .map_err(|e| e.to_string())?;
        Ok(episodes.iter().map(Self::to_event).collect())
    }

    async fn last_event(
        &self,
        _run_id: &str,
        type_filter: &str,
    ) -> Result<Option<LedgerEvent>, String> {
        // DEGENERATE-BY-DESIGN: most-recent episode of matching type.
        if type_filter != Self::EVENT_TYPE {
            return Ok(None);
        }
        let conn = apohara_episodic::open_episode_db(&self.db_path).map_err(|e| e.to_string())?;
        let episodes =
            apohara_episodic::list_episodes(&conn, 1).map_err(|e| e.to_string())?;
        Ok(episodes.first().map(Self::to_event))
    }

    async fn search_events(
        &self,
        _run_id: &str,
        substring: &str,
    ) -> Result<Vec<LedgerEvent>, String> {
        let conn = apohara_episodic::open_episode_db(&self.db_path).map_err(|e| e.to_string())?;
        let episodes = apohara_episodic::search_episodes(&conn, substring)
            .map_err(|e| e.to_string())?;
        Ok(episodes
            .iter()
            .take(Self::MAX_ROWS)
            .map(Self::to_event)
            .collect())
    }
}

struct EmptyRuns;
#[async_trait]
impl RunsBackend for EmptyRuns {
    async fn list_runs(&self, _: ListFilter) -> Result<Vec<RunRow>, String> {
        Ok(vec![])
    }
    async fn inspect_run(&self, _: &str) -> Result<(Option<RunRow>, i64), String> {
        Ok((None, 0))
    }
    async fn current_run(&self) -> Result<Option<RunRow>, String> {
        Ok(None)
    }
    async fn run_diff(&self, _: &str) -> Result<Vec<TaskOutcome>, String> {
        Ok(vec![])
    }
}

/// Inner async bootstrap reused by the desktop API surface and the
/// CLI binary (Phase 1 G1.D). Uses default paths under `~/.apohara/`.
pub async fn mcp_bootstrap_servers_inner() -> Result<EndpointDescriptor, String> {
    check_enabled()?;
    let opts = BootstrapOpts::new(
        Arc::new(EpisodicLedger::new(
            apohara_episodic::default_episode_db_path(),
        )),
        Arc::new(EmptyRuns),
        Arc::new(StubIndexerClient),
    );
    let handle = bootstrap_mcp_servers(opts)
        .await
        .map_err(|e| e.to_string())?;
    let descriptor = handle.endpoint.clone();
    // Persist handle reference is not required for the bridge —
    // the cli/desktop binary keeps a long-lived `BootstrapHandle`
    // when it wires its own backends. From the IPC's vantage point
    // we just return the descriptor (port + token) and let the
    // shell hold its own reference.
    leak_handle(handle);
    Ok(descriptor)
}

/// Keep the bootstrap handle alive for the lifetime of the desktop
/// process so the servers don't shut down when the IPC call returns.
/// This is intentionally a leak — the process is the lifetime.
fn leak_handle(handle: BootstrapHandle) {
    Box::leak(Box::new(handle));
}

/// Inner async injector reused by the desktop API surface and the CLI
/// binary. The desktop UI calls this after `mcp_bootstrap_servers`
/// returns to write each provider's native config.
pub async fn mcp_inject_config_inner(
    provider_id: ProviderId,
    canonical: McpCanonical,
    workspace_path: String,
) -> Result<InjectionResult, String> {
    check_enabled()?;
    inject_mcp_config(provider_id, &canonical, &PathBuf::from(&workspace_path))
        .await
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn is_enabled_default_on_only_zero_disables() {
        assert!(!is_enabled(Some("0")));
        assert!(is_enabled(Some("1")));
        assert!(is_enabled(Some("true")));
        assert!(is_enabled(None));
        assert!(is_enabled(Some("")));
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_mcp_flag)]
    async fn bootstrap_errors_when_flag_unset() {
        std::env::set_var("APOHARA_RUST_MCP", "0");
        let err = mcp_bootstrap_servers_inner().await.unwrap_err();
        assert!(err.contains("explicitly disabled"), "got: {err}");
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_mcp_flag)]
    async fn inject_errors_when_flag_unset() {
        std::env::set_var("APOHARA_RUST_MCP", "0");
        let err = mcp_inject_config_inner(
            ProviderId::ClaudeCodeCli,
            McpCanonical { servers: vec![] },
            "/tmp".to_string(),
        )
        .await
        .unwrap_err();
        assert!(err.contains("explicitly disabled"), "got: {err}");
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_mcp_flag)]
    async fn inject_succeeds_when_flag_set() {
        let tmp = tempfile::TempDir::new().unwrap();
        std::env::set_var("APOHARA_RUST_MCP", "1");
        let res = mcp_inject_config_inner(
            ProviderId::ClaudeCodeCli,
            McpCanonical { servers: vec![] },
            tmp.path().display().to_string(),
        )
        .await;
        std::env::remove_var("APOHARA_RUST_MCP");
        let out = res.unwrap();
        assert_eq!(out.provider_id, ProviderId::ClaudeCodeCli);
        assert!(out.config_path.ends_with(".claude/mcp.json"));
    }

    fn seed_episode_store(path: &std::path::Path, id: &str, goal: &str, ts: i64) {
        let conn = apohara_episodic::open_episode_db(path).unwrap();
        apohara_episodic::insert_episode(
            &conn,
            &apohara_episodic::Episode {
                id: id.to_string(),
                goal: goal.to_string(),
                timestamp: ts,
                providers: vec!["claude-code-cli".to_string()],
                winning_diff_summary: "winner".to_string(),
                gate_verdicts: vec!["passed".to_string()],
                outcome: "winner-selected".to_string(),
            },
        )
        .unwrap();
    }

    /// Guards against re-creating the EmptyLedger empty-return smell: a
    /// self-seeded store must produce NON-EMPTY read_events/search_events.
    #[tokio::test]
    #[serial_test::serial(episodic_fresh_process)]
    async fn episodic_ledger_returns_seeded_episodes() {
        let tmp = tempfile::TempDir::new().unwrap();
        let db = tmp.path().join("episodes.db");
        seed_episode_store(&db, "run-1", "fix login bug", 100);
        seed_episode_store(&db, "run-2", "add cache layer", 200);

        let ledger = EpisodicLedger::new(db);

        // read_events (run_id partition ignored) — most-recent-first, non-empty.
        let events = ledger.read_events(None, None, 0, 100).await.unwrap();
        assert_eq!(events.len(), 2, "read_events must NOT be empty");
        assert_eq!(events[0].r#type, "episode");
        assert!(events[0].payload.contains("add cache layer"), "newest first");
        assert!(events[0].payload.contains("winner-selected"), "outcome in payload");

        // search_events substring match over goal/payload — non-empty.
        let matches = ledger.search_events("r1", "login").await.unwrap();
        assert_eq!(matches.len(), 1, "search_events must NOT be empty");
        assert!(matches[0].payload.contains("fix login bug"));

        // Degenerate-by-design fallbacks still behave as documented.
        let replay = ledger.replay_run("ignored").await.unwrap();
        assert_eq!(replay.len(), 2, "replay_run returns all episodes flat");
        let last = ledger.last_event("ignored", "episode").await.unwrap();
        assert!(last.is_some(), "last_event returns most-recent episode");
        assert_eq!(last.unwrap().ts, 200);
        let none = ledger.last_event("ignored", "other-type").await.unwrap();
        assert!(none.is_none(), "non-episode type yields None");
    }

    #[test]
    fn episode_id_to_event_id_is_stable_and_non_negative() {
        let a = episode_id_to_event_id("run-1");
        let b = episode_id_to_event_id("run-1");
        let c = episode_id_to_event_id("run-2");
        assert_eq!(a, b, "deterministic");
        assert_ne!(a, c, "distinct ids differ");
        assert!(a >= 0 && c >= 0, "event ids non-negative");
    }

    #[test]
    fn endpoint_descriptor_roundtrip_serde() {
        let d = EndpointDescriptor {
            token: "deadbeef".into(),
            servers: crate::bootstrap::EndpointServers {
                ledger: Some(crate::bootstrap::EndpointPort { port: 1 }),
                runs: None,
                indexer: None,
                settings: None,
            },
            started_at: 42,
        };
        let json = serde_json::to_string(&d).unwrap();
        let back: EndpointDescriptor = serde_json::from_str(&json).unwrap();
        assert_eq!(back.token, "deadbeef");
        assert_eq!(back.started_at, 42);
        assert_eq!(back.servers.ledger.as_ref().unwrap().port, 1);
    }
}
