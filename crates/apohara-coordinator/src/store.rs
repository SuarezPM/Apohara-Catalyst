//! The storage seam the [`crate::coordinator::Coordinator`] schedules over
//! (US-F2.1).
//!
//! ## Why the trait lives *here* and not in `apohara-dispatch`
//!
//! The live F1.1 storage (`TaskGraph` + `ClaimStore` + the stale-claim
//! reaper) lives in `apohara-dispatch`, which **already** depends on this
//! crate (`apohara-dispatch/Cargo.toml` → `apohara-coordinator`). Making the
//! coordinator depend back on `apohara-dispatch` would close a `dispatch ↔
//! coordinator` dependency cycle that Cargo rejects — this is exactly the
//! "circular dependency F1.1↔F2.1" the plan calls out.
//!
//! The fix keeps the edge one-way: the **trait** is declared here, and
//! `apohara-dispatch` provides the concrete impl over its own `TaskGraph` +
//! `ClaimStore` (see `apohara-dispatch/src/scheduler_store.rs`). The
//! coordinator stays free of any storage dependency and schedules purely
//! against [`SchedulerStore`].
//!
//! The mock that used to BE the coordinator's storage is now an explicit
//! test double ([`InMemoryStore`]) behind the same trait — so "no mock in
//! the live path" holds: the live path binds the real `apohara-dispatch`
//! impl, never this one.

use std::collections::HashMap;

/// Failure surfaced by a [`SchedulerStore`] operation. The concrete stores
/// (filesystem claim/graph I/O, serde) collapse their error taxonomy into a
/// single stringly-typed backend error here so the coordinator stays
/// storage-agnostic — it never matches on `apohara-dispatch`'s error enums.
#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error("scheduler store backend error: {0}")]
    Backend(String),
}

/// The storage the coordinator drives each [`crate::coordinator::Coordinator::tick`].
///
/// Two operations, mirroring the two scheduling passes:
///   * [`ready_tasks`](SchedulerStore::ready_tasks) — the deps-gated,
///     claim-slot-open set the tick may dispatch (the F1.1
///     `TaskGraph::claimable` view in the live impl).
///   * [`reap_stale`](SchedulerStore::reap_stale) — the unified reaper path:
///     release every claim that has aged past `ttl_ms` or whose holder PID is
///     dead, returning the freed ids so the tick can surface them as
///     `StallDetected`. This is what turns the formerly-standalone F1.1
///     reaper into a coordinator-driven pass.
///
/// Both return ids in a deterministic (sorted) order so the tick's outcome is
/// stable across calls — the coordinator does not re-sort.
pub trait SchedulerStore {
    /// Ids ready to dispatch right now: every declared dependency is done
    /// AND the claim slot is open (unclaimed/released). Sorted.
    fn ready_tasks(&self) -> Result<Vec<String>, StoreError>;

    /// Release stale claims through the unified reaper and return the freed
    /// ids (sorted). `now_ms` is wall-clock epoch millis; `ttl_ms` is the
    /// staleness window (the coordinator passes its `stall_timeout_ms`).
    fn reap_stale(&mut self, now_ms: i64, ttl_ms: i64) -> Result<Vec<String>, StoreError>;
}

/// In-memory [`SchedulerStore`] test double. Replaces the former `MockTask`
/// HashMap that *was* the coordinator's storage — now it is an explicit
/// double the coordinator's own unit tests bind, never the live path.
///
/// It models just enough of the F1.1 semantics the tick depends on: a node
/// has `deps`, a `done` flag, and an optional live `claim` carrying the
/// last-seen timestamp + a PID-alive bit so [`reap_stale`](Self::reap_stale)
/// can mirror the real reaper's TTL-or-dead-PID rule.
#[derive(Default)]
pub struct InMemoryStore {
    tasks: HashMap<String, InMemTask>,
}

struct InMemTask {
    deps: Vec<String>,
    done: bool,
    /// `Some` while a (simulated) blade holds the slot.
    claim: Option<InMemClaim>,
}

struct InMemClaim {
    /// `max(claimed_at_ms, last_heartbeat_ms)` — seeds the TTL deadline,
    /// exactly like the real `ClaimRecord`.
    last_seen_ms: i64,
    /// Whether the holder process is reported alive (the injected PID probe
    /// in the real reaper).
    pid_alive: bool,
}

impl InMemoryStore {
    pub fn new() -> Self {
        Self::default()
    }

    /// Add a node with no deps and an open slot — immediately ready.
    pub fn enqueue(&mut self, id: &str) {
        self.tasks.insert(
            id.to_string(),
            InMemTask {
                deps: Vec::new(),
                done: false,
                claim: None,
            },
        );
    }

    /// Add a node gated on `deps`; ready only once every dep is
    /// [`mark_done`](Self::mark_done).
    pub fn enqueue_with_deps(&mut self, id: &str, deps: &[&str]) {
        self.tasks.insert(
            id.to_string(),
            InMemTask {
                deps: deps.iter().map(|d| d.to_string()).collect(),
                done: false,
                claim: None,
            },
        );
    }

    /// Add a node already claimed `age_ms` ago by a live process and never
    /// heartbeaten since — i.e. it goes stale once `age_ms > ttl`. Mirrors
    /// the original `enqueue_test_task_with_age` semantics over the new
    /// claim model so the reaper (not a dispatched-at clock) is what
    /// surfaces the stall.
    pub fn enqueue_claimed_with_age(&mut self, id: &str, age_ms: u64, now_ms: i64) {
        self.tasks.insert(
            id.to_string(),
            InMemTask {
                deps: Vec::new(),
                done: false,
                claim: Some(InMemClaim {
                    last_seen_ms: now_ms.saturating_sub(age_ms as i64),
                    pid_alive: true,
                }),
            },
        );
    }

    /// Mark `id` completed so its dependents become claimable.
    pub fn mark_done(&mut self, id: &str) {
        if let Some(t) = self.tasks.get_mut(id) {
            t.done = true;
        }
    }

    /// Place a live, fresh claim on `id` (slot taken, not stale) — used by
    /// tests that need to take a node out of the ready set.
    pub fn claim_fresh(&mut self, id: &str, now_ms: i64) {
        if let Some(t) = self.tasks.get_mut(id) {
            t.claim = Some(InMemClaim {
                last_seen_ms: now_ms,
                pid_alive: true,
            });
        }
    }
}

impl SchedulerStore for InMemoryStore {
    fn ready_tasks(&self) -> Result<Vec<String>, StoreError> {
        let done: std::collections::HashSet<&str> = self
            .tasks
            .iter()
            .filter(|(_, t)| t.done)
            .map(|(id, _)| id.as_str())
            .collect();

        let mut out: Vec<String> = self
            .tasks
            .iter()
            .filter(|(_, t)| !t.done && t.claim.is_none() && t.deps.iter().all(|d| done.contains(d.as_str())))
            .map(|(id, _)| id.clone())
            .collect();
        out.sort();
        Ok(out)
    }

    fn reap_stale(&mut self, now_ms: i64, ttl_ms: i64) -> Result<Vec<String>, StoreError> {
        let mut reaped = Vec::new();
        for (id, task) in self.tasks.iter_mut() {
            let Some(claim) = task.claim.as_ref() else {
                continue;
            };
            let deadline = claim.last_seen_ms.saturating_add(ttl_ms);
            let ttl_expired = now_ms > deadline;
            let pid_dead = !claim.pid_alive;
            if ttl_expired || pid_dead {
                task.claim = None;
                reaped.push(id.clone());
            }
        }
        reaped.sort();
        Ok(reaped)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ready_excludes_done_claimed_and_dep_gated() {
        let mut s = InMemoryStore::new();
        s.enqueue("a");
        s.enqueue_with_deps("b", &["a"]);
        s.enqueue("c");
        s.claim_fresh("c", 1_000); // c slot is taken -> not ready

        // b gated on a (not done), c claimed -> only a is ready.
        assert_eq!(s.ready_tasks().unwrap(), vec!["a".to_string()]);

        s.mark_done("a");
        // a done (drops out), b unlocks, c still claimed.
        assert_eq!(s.ready_tasks().unwrap(), vec!["b".to_string()]);
    }

    #[test]
    fn reap_releases_stale_and_dead_keeps_fresh() {
        let mut s = InMemoryStore::new();
        let now = 10_000_000_i64;
        s.enqueue_claimed_with_age("old", 6 * 60 * 1000, now); // 6 min old
        s.enqueue("fresh");
        s.claim_fresh("fresh", now); // live + fresh -> survives
        s.enqueue("dead");
        if let Some(t) = s.tasks.get_mut("dead") {
            t.claim = Some(InMemClaim {
                last_seen_ms: now,
                pid_alive: false,
            });
        }

        let ttl = 5 * 60 * 1000; // 5 min
        let reaped = s.reap_stale(now, ttl).unwrap();
        // "old" is past TTL, "dead" has a dead PID; "fresh" survives.
        assert_eq!(reaped, vec!["dead".to_string(), "old".to_string()]);
        // Reaped slots are open again -> ready.
        let ready = s.ready_tasks().unwrap();
        assert!(ready.contains(&"old".to_string()));
        assert!(ready.contains(&"dead".to_string()));
        assert!(!ready.contains(&"fresh".to_string()));
    }
}
