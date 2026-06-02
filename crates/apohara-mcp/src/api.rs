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

use tokio::sync::OnceCell;

use crate::bootstrap::{
    bootstrap_mcp_servers, BootstrapHandle, BootstrapOpts, EndpointDescriptor,
};
use crate::hooks_injection::{hook_assets, inject_hooks_config, resolve_paths as resolve_hook_paths};
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

/// Process-global memo of the bootstrap result. The first successful
/// bootstrap binds the loopback servers and leaks the handle (process =
/// lifetime); every subsequent call returns the SAME descriptor without
/// re-binding ports or leaking a second handle. `OnceCell` only stores on
/// `Ok`, so a failed bootstrap (or the gate being disabled) leaves the cell
/// empty and a later call may retry.
static BOOTSTRAP_ONCE: OnceCell<EndpointDescriptor> = OnceCell::const_new();

/// Inner async bootstrap reused by the desktop API surface and the
/// CLI binary (Phase 1 G1.D). Uses default paths under `~/.apohara/`.
///
/// Idempotent: a second call returns the cached `EndpointDescriptor`
/// (same token / ports / `started_at`) instead of spinning up a second
/// set of servers. The desktop may call this on every mount safely.
pub async fn mcp_bootstrap_servers_inner() -> Result<EndpointDescriptor, String> {
    // Gate stays the first thing checked so the disabled flag still errors
    // before we ever touch the memo (and before binding any ports).
    check_enabled()?;
    BOOTSTRAP_ONCE
        .get_or_try_init(|| async {
            // US-F2.0a — root the concrete mesh backend at the repo (cwd →
            // `<repo>/.apohara/{claims,tasks,mailbox}`) so the LIVE mesh bus and
            // the dispatch loop (US-F1.4, same `<repo>/.apohara/claims`
            // convention) share the SAME on-disk stores. Falls back to "." if
            // cwd is unavailable — symmetric with the dispatch loop's own
            // `current_dir().unwrap_or_else(|_| ".".into())`.
            let repo = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
            // US-S3 — attach a mesh audit sink so blade `send_message` calls
            // (handled in THIS server process) emit a `MessageSent` record into
            // `<repo>/.apohara/audit`. Best-effort: a sink that can't open
            // degrades to no MessageSent trail, never blocks the bus.
            let mut mesh_backend = crate::servers::mesh_store::FsMeshBackend::new(&repo);
            match apohara_audit::AuditSink::new(repo.join(".apohara").join("audit"), "mesh-mcp").await {
                Ok(sink) => mesh_backend = mesh_backend.with_audit(sink),
                Err(e) => tracing::warn!("mesh audit sink unavailable (non-fatal): {e}; MessageSent not recorded"),
            }
            let opts = BootstrapOpts::new(
                Arc::new(EpisodicLedger::new(
                    apohara_episodic::default_episode_db_path(),
                )),
                Arc::new(EmptyRuns),
                Arc::new(StubIndexerClient),
                Arc::new(mesh_backend),
            );
            let handle = bootstrap_mcp_servers(opts)
                .await
                .map_err(|e| e.to_string())?;
            let descriptor = handle.endpoint.clone();
            // Persist handle reference is not required for the bridge —
            // the cli/desktop binary keeps a long-lived `BootstrapHandle`
            // when it wires its own backends. From the IPC's vantage point
            // we just return the descriptor (port + token) and let the
            // shell hold its own reference. Runs exactly once, inside the
            // init closure, so no second handle ever leaks.
            leak_handle(handle);
            Ok::<EndpointDescriptor, String>(descriptor)
        })
        .await
        .cloned()
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

/// Stage 2.6 — end-to-end agent-hooks setup for a provider, mirroring the
/// MCP injection surface above. Two steps, both gated by `APOHARA_RUST_MCP`:
///   1. install the hook script under `~/.<provider>/hooks/` (idempotent +
///      atomic + chmod 0755 via `apohara_hooks::install_hook`), then
///   2. register it in the provider's settings (`inject_hooks_config`,
///      idempotent + atomic + .bak).
///
/// Run this at the same point provider MCP config is prepared. Only
/// `claude-code-cli` is supported: `codex-cli` (no upstream contract) and
/// `opencode-go` (hooks are JS/TS plugins, not a settings block) are refused
/// before touching disk, symmetric with `inject_hooks_config`. The provider →
/// (script-name, script-body, paths) mapping lives once in
/// `hooks_injection::hook_assets` / `resolve_paths`.
///
/// `config_home` defaults to `$HOME`; callers (and tests) may override it to
/// avoid touching the real `~/.claude`.
pub async fn hooks_setup_for_provider_inner(
    provider_id: ProviderId,
    config_home: Option<PathBuf>,
) -> Result<crate::hooks_injection::HookInjectionResult, String> {
    check_enabled()?;
    let home = match config_home {
        Some(h) => h,
        None => dirs::home_dir().ok_or_else(|| "HOME not set".to_string())?,
    };

    // Refuse unsupported providers before touching disk — single source of
    // truth on which providers are wirable + their script body.
    let assets = hook_assets(provider_id)
        .ok_or_else(|| format!("{} hooks injection unsupported", provider_id.as_str()))?;

    // 1. Install the script the settings file will point at.
    let (_settings, script_path) = resolve_hook_paths(provider_id, &home);
    apohara_hooks::install_hook(&script_path, assets.script_body).map_err(|e| e.to_string())?;

    // 2. Register the (now-installed) script in the provider settings.
    inject_hooks_config(provider_id, &home)
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

    /// A second bootstrap must reuse the first descriptor — same token, same
    /// server ports, same `started_at`. A real 2nd bootstrap would bind fresh
    /// ephemeral ports (port 0 → kernel-assigned), so equal ports prove the
    /// memo short-circuited instead of re-binding. `EndpointDescriptor` has no
    /// `PartialEq`, so compare the load-bearing fields field-by-field.
    #[tokio::test]
    #[serial_test::serial(apohara_rust_mcp_flag)]
    async fn bootstrap_is_idempotent_same_descriptor() {
        std::env::set_var("APOHARA_RUST_MCP", "1");
        let first = mcp_bootstrap_servers_inner().await.unwrap();
        let second = mcp_bootstrap_servers_inner().await.unwrap();
        std::env::remove_var("APOHARA_RUST_MCP");

        assert_eq!(first.token, second.token, "token must be stable");
        assert_eq!(
            first.started_at, second.started_at,
            "started_at must be stable (no re-bootstrap)"
        );
        type Servers = crate::bootstrap::EndpointServers;
        let port = |s: &Servers, pick: fn(&Servers) -> &Option<crate::bootstrap::EndpointPort>| {
            pick(s).as_ref().map(|p| p.port)
        };
        assert_eq!(
            port(&first.servers, |s| &s.ledger),
            port(&second.servers, |s| &s.ledger),
            "ledger port must be identical (not re-bound)"
        );
        assert_eq!(
            port(&first.servers, |s| &s.runs),
            port(&second.servers, |s| &s.runs),
            "runs port must be identical"
        );
        assert_eq!(
            port(&first.servers, |s| &s.indexer),
            port(&second.servers, |s| &s.indexer),
            "indexer port must be identical"
        );
        assert_eq!(
            port(&first.servers, |s| &s.settings),
            port(&second.servers, |s| &s.settings),
            "settings port must be identical"
        );
        assert_eq!(
            port(&first.servers, |s| &s.mesh),
            port(&second.servers, |s| &s.mesh),
            "mesh port must be identical (not re-bound)"
        );
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
    async fn hooks_setup_installs_script_and_registers_config() {
        // config_home points at a TempDir — NEVER the real ~/.claude.
        let home = tempfile::TempDir::new().unwrap();
        std::env::set_var("APOHARA_RUST_MCP", "1");
        let res = hooks_setup_for_provider_inner(
            ProviderId::ClaudeCodeCli,
            Some(home.path().to_path_buf()),
        )
        .await;
        std::env::remove_var("APOHARA_RUST_MCP");
        let out = res.unwrap();

        // Script landed on disk + is executable.
        let script = home.path().join(".claude/hooks/apohara-claude-hook.sh");
        assert!(script.exists(), "hook script must be installed");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&script).unwrap().permissions().mode();
            assert_eq!(mode & 0o111, 0o111, "script must be executable");
        }

        // Settings file registers the script.
        assert_eq!(out.config_path, home.path().join(".claude/settings.json"));
        let raw = std::fs::read_to_string(&out.config_path).unwrap();
        assert!(raw.contains("apohara-claude-hook.sh"));
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_mcp_flag)]
    async fn hooks_setup_refuses_codex() {
        let home = tempfile::TempDir::new().unwrap();
        std::env::set_var("APOHARA_RUST_MCP", "1");
        let err = hooks_setup_for_provider_inner(
            ProviderId::CodexCli,
            Some(home.path().to_path_buf()),
        )
        .await
        .unwrap_err();
        std::env::remove_var("APOHARA_RUST_MCP");
        assert!(err.contains("codex"), "got: {err}");
        // Nothing should have been written.
        assert!(!home.path().join(".codex").exists());
    }

    #[tokio::test]
    #[serial_test::serial(apohara_rust_mcp_flag)]
    async fn hooks_setup_errors_when_flag_disabled() {
        let home = tempfile::TempDir::new().unwrap();
        std::env::set_var("APOHARA_RUST_MCP", "0");
        let err = hooks_setup_for_provider_inner(
            ProviderId::ClaudeCodeCli,
            Some(home.path().to_path_buf()),
        )
        .await
        .unwrap_err();
        std::env::remove_var("APOHARA_RUST_MCP");
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
                mesh: Some(crate::bootstrap::EndpointPort { port: 9 }),
            },
            started_at: 42,
        };
        let json = serde_json::to_string(&d).unwrap();
        let back: EndpointDescriptor = serde_json::from_str(&json).unwrap();
        assert_eq!(back.token, "deadbeef");
        assert_eq!(back.started_at, 42);
        assert_eq!(back.servers.ledger.as_ref().unwrap().port, 1);
        assert_eq!(back.servers.mesh.as_ref().unwrap().port, 9);
    }
}
