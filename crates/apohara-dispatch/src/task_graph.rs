//! Filesystem Shared Task List as a DAG with dependency-gated
//! claimability and a self-contained stale-claim reaper (US-F1.1).
//!
//! This sits one layer above [`crate::claim`]: the claim store answers
//! "may *this* slot be claimed right now?" race-free; the task graph adds
//! "*which* slots are even eligible?" by enforcing a dependency DAG. A node
//! is claimable only once every dependency it names is **done** (a signal
//! distinct from `Released` — see [`TaskGraph::mark_done`]).
//!
//! The reaper ([`reap_stale_claims`]) carries its OWN liveness detection —
//! token-TTL, heartbeat staleness, and a dead-PID probe — so it never
//! depends on the Coordinator. Liveness is injected (`is_alive`) so tests
//! stay deterministic and the production probe ([`default_pid_alive`])
//! stays dependency-free.
//!
//! Persistence follows the repo-wide atomic-write discipline (§0.8): the
//! single `graph.json` is written via `NamedTempFile` + `persist()` (tmp +
//! rename), reusing the exact pattern in [`crate::claim::ClaimStore`].

use crate::claim::{ClaimError, ClaimStore};
use crate::state::is_claimable;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Write;
use std::path::PathBuf;

/// A single node in the task DAG. `deps` names the ids that must be
/// [`TaskGraph::mark_done`] before this node becomes claimable.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct TaskNode {
    pub id: String,
    pub title: String,
    pub deps: Vec<String>,
}

/// On-disk shape of the whole graph: the node set plus the ids that have
/// completed. Kept flat so the file is a trivial round-trip.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
struct GraphData {
    nodes: Vec<TaskNode>,
    done: Vec<String>,
}

/// Errors distinct from the claim layer's I/O/serde failures.
#[derive(Debug, thiserror::Error)]
pub enum GraphError {
    #[error("io: {0}")]
    Io(#[from] std::io::Error),
    #[error("serde: {0}")]
    Serde(#[from] serde_json::Error),
    /// A claim-store operation surfaced while computing claimability.
    #[error("claim: {0}")]
    Claim(#[from] ClaimError),
    /// Adding `node` would introduce a cycle — a DAG must stay acyclic.
    #[error("adding node {node} would create a dependency cycle")]
    Cycle { node: String },
}

/// Filesystem-backed task DAG. Like [`ClaimStore`] it is just a path, so
/// heterogeneous call sites can each hold their own pointing at the same
/// `root`. The authoritative state lives in `<root>/graph.json`; every
/// mutator does a load-modify-save under that single file.
#[derive(Debug, Clone)]
pub struct TaskGraph {
    root: PathBuf,
}

impl TaskGraph {
    /// Open (and lazily create) a task graph rooted at `root`.
    ///
    /// Convention: pass `<workspace>/.apohara/tasks`. The directory is
    /// created on demand on the first save, so this never touches disk.
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    fn graph_path(&self) -> PathBuf {
        self.root.join("graph.json")
    }

    /// Read the persisted graph, or an empty graph if it was never saved.
    fn load(&self) -> Result<GraphData, GraphError> {
        match std::fs::read(self.graph_path()) {
            Ok(bytes) => Ok(serde_json::from_slice(&bytes)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(GraphData::default()),
            Err(e) => Err(e.into()),
        }
    }

    /// Atomic persist (§0.8): write to a temp file in the same directory,
    /// then `persist()` (rename) over the target. Mirrors
    /// [`ClaimStore::persist`] so the whole crate uses one write pattern.
    fn save(&self, data: &GraphData) -> Result<(), GraphError> {
        std::fs::create_dir_all(&self.root)?;
        let body = serde_json::to_vec_pretty(data)?;
        let mut tmp = tempfile::NamedTempFile::new_in(&self.root)?;
        tmp.write_all(&body)?;
        tmp.flush()?;
        tmp.persist(self.graph_path())
            .map_err(|e| GraphError::Io(e.error))?;
        Ok(())
    }

    /// Append `node` to the DAG, rejecting it if it would introduce a
    /// cycle. The acyclicity check (Kahn's algorithm over the prospective
    /// node set) considers only edges among nodes that actually exist, so a
    /// forward reference to a not-yet-added dependency is allowed (it simply
    /// stays ungated until that node lands and is done).
    pub fn add_node(&self, node: TaskNode) -> Result<(), GraphError> {
        let mut data = self.load()?;
        if let Some(existing) = data.nodes.iter_mut().find(|n| n.id == node.id) {
            // Re-adding an id replaces it; validate the replacement set.
            *existing = node.clone();
        } else {
            data.nodes.push(node.clone());
        }
        if has_cycle(&data.nodes) {
            return Err(GraphError::Cycle { node: node.id });
        }
        self.save(&data)
    }

    /// Record `id` as completed. This — not a `Released` claim — is the
    /// dependency-resolution signal: a node can be released (claim freed)
    /// without being done, so completion is tracked explicitly here.
    /// Idempotent and tolerant of unknown ids.
    pub fn mark_done(&self, id: &str) -> Result<(), GraphError> {
        let mut data = self.load()?;
        if !data.done.iter().any(|d| d == id) {
            data.done.push(id.to_string());
        }
        self.save(&data)
    }

    /// Whether `id` has been [`Self::mark_done`].
    pub fn is_done(&self, id: &str) -> Result<bool, GraphError> {
        Ok(self.load()?.done.iter().any(|d| d == id))
    }

    /// Every node currently in the DAG, in insertion order (the persisted
    /// order — `add_node` appends, so the first-added node is first).
    ///
    /// Read-only view of the node set (id/title/deps), distinct from
    /// [`Self::claimable`] which returns only the *eligible* ids: callers that
    /// must render the WHOLE graph (the US-F0.2 `get_tasks` mesh tool) need the
    /// full nodes, joining the live lifecycle state from the [`ClaimStore`]
    /// themselves. A never-saved graph yields an empty Vec (`load` maps a
    /// missing file to the default).
    pub fn nodes(&self) -> Result<Vec<TaskNode>, GraphError> {
        Ok(self.load()?.nodes)
    }

    /// Compute the deterministically-ordered (by id) set of claimable node
    /// ids. A node `n` is claimable iff:
    ///   1. `n` is not already done,
    ///   2. every `d` in `n.deps` is done, and
    ///   3. the claim store shows no record for `n` OR its state is
    ///      [`is_claimable`] (`Unclaimed`/`Released`).
    ///
    /// (3) defers to the US-F0.0 advisory-lock state so this never races a
    /// live claimer; the gate here is purely the dependency layer on top.
    pub fn claimable(&self, claim_store: &ClaimStore) -> Result<Vec<String>, GraphError> {
        let data = self.load()?;
        let done: HashSet<&str> = data.done.iter().map(String::as_str).collect();

        let mut out = Vec::new();
        for node in &data.nodes {
            if done.contains(node.id.as_str()) {
                continue;
            }
            if !node.deps.iter().all(|d| done.contains(d.as_str())) {
                continue;
            }
            let slot_open = match claim_store.load(&node.id)? {
                None => true,
                Some(record) => is_claimable(record.state),
            };
            if slot_open {
                out.push(node.id.clone());
            }
        }
        out.sort();
        Ok(out)
    }
}

/// Detect a cycle in the dependency graph via Kahn's algorithm.
///
/// Edges run dependency → dependent (a dep must be processed before the
/// node that needs it). Only edges among the supplied `nodes` count;
/// references to absent ids are ignored (forward references are legal). If
/// Kahn cannot drain every node, the residue is a cycle.
fn has_cycle(nodes: &[TaskNode]) -> bool {
    let ids: HashSet<&str> = nodes.iter().map(|n| n.id.as_str()).collect();

    // In-degree = number of (existing) dependencies each node still waits on.
    let mut indegree: std::collections::HashMap<&str, usize> = nodes
        .iter()
        .map(|n| {
            // Dedup deps before counting: a dep listed twice must not inflate
            // in-degree (the drain loop decrements once per resolved node), or
            // `deps: ["A","A"]` would wedge and false-positive a cycle.
            let deg = n
                .deps
                .iter()
                .map(String::as_str)
                .filter(|d| ids.contains(d))
                .collect::<HashSet<&str>>()
                .len();
            (n.id.as_str(), deg)
        })
        .collect();

    let mut queue: Vec<&str> = indegree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();

    let mut resolved = 0usize;
    while let Some(id) = queue.pop() {
        resolved += 1;
        // Releasing `id` decrements every node that depends on it.
        for node in nodes {
            if node.deps.iter().any(|d| d == id) {
                if let Some(deg) = indegree.get_mut(node.id.as_str()) {
                    *deg -= 1;
                    if *deg == 0 {
                        queue.push(node.id.as_str());
                    }
                }
            }
        }
    }
    resolved != nodes.len()
}

/// Release stale claims with the reaper's OWN liveness detection, fully
/// independent of the Coordinator's clock.
///
/// Staleness is decided by [`crate::claim::claim_is_stale`] (TTL expiry OR a
/// dead/recycled PID) — the *same* predicate the lock-held release path uses.
/// Two US-F2.1 hardenings over the original standalone reaper:
///   * **No TOCTOU** — instead of deciding from a lock-free read and then
///     releasing unconditionally, each candidate is released via
///     [`ClaimStore::release_if_still_stale`], which re-checks staleness
///     *under the lock*. A heartbeat that lands mid-sweep spares the claim.
///     The lock-free `load` here is only a cheap pre-filter to skip slots
///     that obviously hold no live claim.
///   * **Batch resilience** — a single corrupt/unreadable record (or a
///     failed release) is logged and skipped, never aborting the whole sweep
///     and stranding later stale claims.
///
/// `is_alive(pid, pid_start_time)` is injected so tests are deterministic;
/// production passes [`default_pid_alive`]. Returns the released ids, sorted.
pub fn reap_stale_claims<F>(
    claim_store: &ClaimStore,
    task_ids: &[String],
    now_ms: i64,
    ttl_ms: i64,
    is_alive: F,
) -> Result<Vec<String>, ClaimError>
where
    F: Fn(u32, Option<u64>) -> bool,
{
    use crate::state::RunState;

    let mut reaped = Vec::new();
    for task_id in task_ids {
        // Cheap lock-free pre-filter: skip slots with no live claim. Batch
        // resilience — an unreadable record is logged and skipped so the
        // sweep still reaches later stale claims.
        match claim_store.load(task_id) {
            Ok(Some(record))
                if matches!(record.state, RunState::Claimed | RunState::Running) => {}
            Ok(_) => continue,
            Err(e) => {
                tracing::warn!(task_id = %task_id, error = %e, "reaper: skipping unreadable claim record");
                continue;
            }
        }

        // Authoritative re-check + release under the lock (closes the TOCTOU
        // window the lock-free pre-filter would otherwise open).
        match claim_store.release_if_still_stale(task_id, now_ms, ttl_ms, &is_alive) {
            Ok(true) => reaped.push(task_id.clone()),
            Ok(false) => {}
            Err(e) => {
                tracing::warn!(task_id = %task_id, error = %e, "reaper: release_if_still_stale failed");
                continue;
            }
        }
    }
    reaped.sort();
    Ok(reaped)
}

/// Default PID liveness probe, dependency-free.
///
/// On Linux a live process has a `/proc/<pid>` directory. Mere existence is
/// not enough: the kernel recycles PIDs, so after a blade dies the OS may
/// hand its number to an unrelated process — `/proc/<pid>` would exist but
/// point at a *different* process. When `expected_start` is recorded we cross
/// the gate with the process's start-time (`/proc/<pid>/stat` field 22): a
/// mismatch means the original holder is gone (US-F2.1 PID-reuse hardening).
///
/// Returns `false` (dead) when `/proc/<pid>` is absent or its start-time no
/// longer matches; `true` when the pid exists and either matches or no
/// start-time was recorded. On non-Linux there is no cheap dep-free probe, so
/// we conservatively report `true` (TTL expiry stays the only safety net).
pub fn default_pid_alive(pid: u32, expected_start: Option<u64>) -> bool {
    #[cfg(target_os = "linux")]
    {
        match read_pid_start_time(pid) {
            // No /proc/<pid>/stat -> the process is gone.
            None => false,
            Some(actual) => match expected_start {
                // Start-time mismatch -> the PID was recycled; the holder died.
                Some(expected) => actual == expected,
                // No recorded start-time (older heartbeat) -> trust existence.
                None => true,
            },
        }
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = (pid, expected_start);
        true
    }
}

/// Read a process's start-time (`/proc/<pid>/stat` field 22, clock-ticks
/// since boot) on Linux, or `None` if the process is gone / unparseable.
#[cfg(target_os = "linux")]
fn read_pid_start_time(pid: u32) -> Option<u64> {
    let stat = std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?;
    parse_starttime(&stat)
}

/// Parse field 22 (`starttime`) out of a `/proc/<pid>/stat` line.
///
/// Field 2 (`comm`) is wrapped in parentheses and may itself contain spaces
/// and parentheses (`(my (weird) proc)`), so naive whitespace splitting is
/// wrong. The robust convention: anchor on the **last** `)`; everything after
/// it starts at field 3 (`state`). `starttime` is field 22 overall, i.e. the
/// 20th whitespace token after the `)` (0-based index 19). Not `cfg`-gated so
/// it is unit-testable on any platform.
fn parse_starttime(stat: &str) -> Option<u64> {
    let after_comm = &stat[stat.rfind(')')? + 1..];
    after_comm
        .split_whitespace()
        .nth(19)
        .and_then(|tok| tok.parse::<u64>().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::claim::{ClaimOutcome, ClaimStore};
    use tempfile::TempDir;

    fn graph(dir: &TempDir) -> TaskGraph {
        TaskGraph::new(dir.path().join("tasks"))
    }

    fn node(id: &str, deps: &[&str]) -> TaskNode {
        TaskNode {
            id: id.to_string(),
            title: format!("title-{id}"),
            deps: deps.iter().map(|d| d.to_string()).collect(),
        }
    }

    #[test]
    fn graph_persists_atomically_and_roundtrips() {
        let dir = TempDir::new().unwrap();
        let g = graph(&dir);
        g.add_node(node("A", &[])).unwrap();
        g.add_node(node("B", &["A"])).unwrap();
        g.mark_done("A").unwrap();

        // A fresh handle on the same root must observe the persisted state.
        let reopened = graph(&dir);
        assert!(reopened.is_done("A").unwrap());
        assert!(!reopened.is_done("B").unwrap());
        let data = reopened.load().unwrap();
        assert_eq!(data.nodes, vec![node("A", &[]), node("B", &["A"])]);
        assert_eq!(data.done, vec!["A".to_string()]);
    }

    #[test]
    fn add_node_rejects_cycle() {
        let dir = TempDir::new().unwrap();
        let g = graph(&dir);
        // A → B is fine; closing the loop B → A (via re-adding A depending
        // on B) must be rejected.
        g.add_node(node("A", &[])).unwrap();
        g.add_node(node("B", &["A"])).unwrap();
        let err = g.add_node(node("A", &["B"])).unwrap_err();
        assert!(matches!(err, GraphError::Cycle { node } if node == "A"));

        // The rejected node must not have been persisted.
        let data = g.load().unwrap();
        assert_eq!(data.nodes, vec![node("A", &[]), node("B", &["A"])]);
    }

    #[test]
    fn duplicate_deps_do_not_false_positive_cycle() {
        // `deps` is a Vec, so the same id can appear twice; deduping in the
        // cycle check keeps that from wedging Kahn into a phantom cycle.
        let dir = TempDir::new().unwrap();
        let g = graph(&dir);
        let store = ClaimStore::new(dir.path().join("claims"));
        g.add_node(node("A", &[])).unwrap();
        g.add_node(node("B", &["A", "A"])).unwrap(); // duplicate dep, acyclic
        g.mark_done("A").unwrap();
        assert_eq!(g.claimable(&store).unwrap(), vec!["B".to_string()]);
    }

    #[test]
    fn dep_gated_claimability() {
        let dir = TempDir::new().unwrap();
        let g = graph(&dir);
        let store = ClaimStore::new(dir.path().join("claims"));
        g.add_node(node("A", &[])).unwrap();
        g.add_node(node("B", &["A"])).unwrap();

        // B is gated on A; only A is claimable up front.
        assert_eq!(g.claimable(&store).unwrap(), vec!["A".to_string()]);

        // Once A is done, B unlocks (and A drops out — done is not claimable).
        g.mark_done("A").unwrap();
        assert_eq!(g.claimable(&store).unwrap(), vec!["B".to_string()]);
    }

    /// THE acceptance test: a blade claims a node and "dies"; the reaper —
    /// using its own dead-PID detection — releases the node so it is not
    /// left blocked.
    #[test]
    fn reaper_releases_dead_blade() {
        let dir = TempDir::new().unwrap();
        let store = ClaimStore::new(dir.path().join("claims"));

        let token = match store.try_claim("A").unwrap() {
            ClaimOutcome::Acquired { token } => token,
            other => panic!("expected claim, got {other:?}"),
        };
        let now = 1_000_000_i64;
        // The blade beats once, then "dies" — pid 999999 reported dead.
        assert_eq!(
            store.heartbeat("A", &token, 999_999, now, None).unwrap(),
            crate::claim::ReportOutcome::Accepted
        );

        // Well within TTL, so only the dead-PID signal can free it.
        let released =
            reap_stale_claims(&store, &["A".to_string()], now + 1, 60_000, |_, _| false).unwrap();
        assert_eq!(released, vec!["A".to_string()]);

        // Slot is freed, not blocked: it can be claimed again.
        assert!(matches!(
            store.try_claim("A").unwrap(),
            ClaimOutcome::Acquired { .. }
        ));
    }

    #[test]
    fn reaper_releases_on_ttl_expiry() {
        let dir = TempDir::new().unwrap();
        let store = ClaimStore::new(dir.path().join("claims"));
        store.try_claim("A").unwrap();

        // Read the stamped mint time, then probe just past TTL with the
        // process reported ALIVE — only TTL expiry can reap here.
        let claimed_at = store
            .load("A")
            .unwrap()
            .unwrap()
            .claimed_at_ms
            .expect("try_claim stamps claimed_at_ms");
        let ttl = 60_000_i64;
        let released = reap_stale_claims(
            &store,
            &["A".to_string()],
            claimed_at + ttl + 1,
            ttl,
            |_, _| true,
        )
        .unwrap();
        assert_eq!(released, vec!["A".to_string()]);
    }

    #[test]
    fn reaper_keeps_live_claim() {
        let dir = TempDir::new().unwrap();
        let store = ClaimStore::new(dir.path().join("claims"));
        let token = match store.try_claim("A").unwrap() {
            ClaimOutcome::Acquired { token } => token,
            other => panic!("expected claim, got {other:?}"),
        };
        let now = 2_000_000_i64;
        store.heartbeat("A", &token, 4242, now, None).unwrap();

        // Within TTL and the process is alive: must NOT be reaped.
        let released =
            reap_stale_claims(&store, &["A".to_string()], now + 1, 60_000, |_, _| true).unwrap();
        assert!(released.is_empty(), "a live, fresh claim must survive");
    }

    /// TOCTOU guard: a heartbeat that lands between the reaper's lock-free
    /// decision and the release must spare the claim. We exercise the
    /// lock-held primitive directly — a claim that *looks* stale to a stale
    /// snapshot but is fresh on disk is NOT released.
    #[test]
    fn release_if_still_stale_spares_refreshed_claim() {
        let dir = TempDir::new().unwrap();
        let store = ClaimStore::new(dir.path().join("claims"));
        let token = match store.try_claim("A").unwrap() {
            ClaimOutcome::Acquired { token } => token,
            other => panic!("expected claim, got {other:?}"),
        };
        // Anchor on the REAL minted claim time (try_claim stamps wall-clock
        // `claimed_at_ms`); `last_seen` is max(claimed_at, heartbeat), so the
        // heartbeat must beat AT/after it to dominate the deadline.
        let claimed_at = store.load("A").unwrap().unwrap().claimed_at_ms.unwrap();
        let beat = claimed_at + 1_000; // the blade just beat — fresh on disk
        store.heartbeat("A", &token, 4242, beat, None).unwrap();
        let ttl = 60_000_i64;

        // Re-check under the lock with `now` still inside the fresh deadline
        // (beat + ttl): not stale -> not released.
        let released = store
            .release_if_still_stale("A", beat + 1, ttl, &|_, _| true)
            .unwrap();
        assert!(!released, "a freshly-beaten claim must survive the re-check");
        assert!(store.has_active_claim("A").unwrap(), "claim must remain held");

        // And when `now` is past the deadline, it IS stale -> released.
        let released = store
            .release_if_still_stale("A", beat + ttl + 1, ttl, &|_, _| true)
            .unwrap();
        assert!(released, "a genuinely stale claim must be released");
    }

    /// Batch resilience: a corrupt record mid-list must not abort the sweep —
    /// the later, genuinely-stale claim still gets reaped.
    #[test]
    fn reaper_skips_corrupt_record_and_continues() {
        let dir = TempDir::new().unwrap();
        let claims_root = dir.path().join("claims");
        let store = ClaimStore::new(&claims_root);

        // A genuinely stale claim that should be reaped.
        store.try_claim("zzz-stale").unwrap();
        let claimed_at = store
            .load("zzz-stale")
            .unwrap()
            .unwrap()
            .claimed_at_ms
            .unwrap();

        // A corrupt record file that sorts BEFORE the stale one, so the sweep
        // hits it first. `load` will surface a serde error for it.
        std::fs::create_dir_all(&claims_root).unwrap();
        std::fs::write(claims_root.join("aaa-corrupt.json"), b"{ not valid json").unwrap();

        let ttl = 60_000_i64;
        let reaped = reap_stale_claims(
            &store,
            &["aaa-corrupt".to_string(), "zzz-stale".to_string()],
            claimed_at + ttl + 1,
            ttl,
            |_, _| true,
        )
        .unwrap();
        assert_eq!(
            reaped,
            vec!["zzz-stale".to_string()],
            "corrupt record skipped, stale claim still reaped"
        );
    }

    #[test]
    fn parse_starttime_handles_comm_with_spaces_and_parens() {
        // comm = "(my (weird) proc)" — embedded spaces AND parens; the parser
        // must anchor on the LAST ')'. starttime is field 22 = 9876543.
        let stat = "1234 (my (weird) proc) S 1 1234 1234 0 -1 4194304 \
                    100 0 0 0 1 2 0 0 20 0 1 0 9876543 12345 678";
        assert_eq!(parse_starttime(stat), Some(9_876_543));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn pid_reuse_detected_via_start_time() {
        // Our own (live) pid with its real start-time reads as alive.
        let me = std::process::id();
        let real = read_pid_start_time(me).expect("self has a /proc stat");
        assert!(default_pid_alive(me, Some(real)), "matching start-time = alive");
        // A mismatched start-time models the PID having been recycled: dead.
        assert!(
            !default_pid_alive(me, Some(real.wrapping_add(1))),
            "start-time mismatch = recycled PID = dead"
        );
        // No recorded start-time falls back to mere existence (alive).
        assert!(default_pid_alive(me, None), "no recorded start-time trusts existence");
        // A pid that cannot exist is dead.
        assert!(!default_pid_alive(u32::MAX, None), "absent pid = dead");
    }
}
