//! Equitable, anti-idle task distribution across blades (US-F2.2).
//!
//! F2.1 made the `Coordinator` schedule deps-gated `ready_tasks` over real
//! storage. This module answers the next question: *which blade runs which
//! ready task?* It is a **pure** decision function — no IO, no global state —
//! mirroring [`crate::auto_spawn::decide_auto_spawn`], so the live dispatch
//! path can call it without inheriting any of its policy.
//!
//! Three invariants, from the F2.2 acceptance criteria:
//!
//!   1. **No same-binary parallelism.** Two tasks on the same CLI *binary*
//!      (basename, the `cli_driver::binary_key` granularity) never run
//!      concurrently beyond that binary's capacity (default 1 = the
//!      `runSerialized` invariant). Distinct binaries (claude vs codex vs
//!      opencode) DO parallelize — that is where the throughput comes from.
//!   2. **Anti-idle.** While unblocked work and spare binary capacity both
//!      exist, no eligible blade is left idle. The policy keeps assigning
//!      until it runs out of ready tasks or capacity.
//!   3. **Configurable affinity.** Intent→provider affinity reuses
//!      [`AutoSpawnPolicy`] (the same overrides/block-list the smart router
//!      uses); when affinity is disabled or its pick is saturated, the policy
//!      falls back to the least-loaded eligible binary so a task is never
//!      dropped just because its *preferred* binary is busy.

use std::collections::HashMap;

use apohara_types::intent::Intent;

use crate::auto_spawn::{decide_auto_spawn, AutoSpawnDecision, AutoSpawnPolicy};

/// A blade available to take work: its provider id plus the binary basename
/// that governs serialization (two providers sharing a binary share the
/// no-same-binary-parallel budget).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Blade {
    pub provider_id: String,
    /// Binary basename — must match `apohara_dispatch::cli_driver::binary_key`
    /// so the serialization budget here lines up with the runtime lock.
    pub binary_key: String,
}

impl Blade {
    pub fn new(provider_id: impl Into<String>, binary_key: impl Into<String>) -> Self {
        Self {
            provider_id: provider_id.into(),
            binary_key: binary_key.into(),
        }
    }
}

/// A unit of unblocked work to place. `intent` drives affinity; default to
/// [`Intent::Implement`] when the caller has no better signal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReadyTask {
    pub task_id: String,
    pub intent: Intent,
}

impl ReadyTask {
    pub fn new(task_id: impl Into<String>, intent: Intent) -> Self {
        Self {
            task_id: task_id.into(),
            intent,
        }
    }
}

/// One placement decision: run `task_id` on `provider_id`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Assignment {
    pub task_id: String,
    pub provider_id: String,
}

/// How work is spread across blades. `affinity` is the intent→provider
/// preference (reused from the smart router); `per_binary_capacity` is the
/// max concurrent tasks for ONE binary basename (default 1 = runSerialized).
#[derive(Debug, Clone)]
pub struct DistributionPolicy {
    pub affinity: AutoSpawnPolicy,
    pub per_binary_capacity: u32,
}

impl Default for DistributionPolicy {
    fn default() -> Self {
        Self {
            // Affinity off by default → pure least-loaded balancing. Callers
            // opt into intent routing by enabling the AutoSpawnPolicy.
            affinity: AutoSpawnPolicy::disabled(),
            per_binary_capacity: 1,
        }
    }
}

impl DistributionPolicy {
    /// Project-configurable constructor. `APOHARA_BLADE_CAPACITY` (>=1) sets
    /// the per-binary concurrency; affinity is read from the same env the
    /// smart router uses ([`AutoSpawnPolicy::from_env`]). Anything unparseable
    /// or < 1 folds to the runSerialized default of 1.
    pub fn from_env(env: &HashMap<String, String>) -> Self {
        let per_binary_capacity = env
            .get("APOHARA_BLADE_CAPACITY")
            .and_then(|v| v.parse::<u32>().ok())
            .filter(|&c| c >= 1)
            .unwrap_or(1);
        Self {
            affinity: AutoSpawnPolicy::from_env(env),
            per_binary_capacity,
        }
    }

    /// Enable intent→provider affinity (otherwise pure least-loaded).
    pub fn with_affinity(mut self, affinity: AutoSpawnPolicy) -> Self {
        self.affinity = affinity;
        self
    }

    pub fn with_capacity(mut self, per_binary_capacity: u32) -> Self {
        self.per_binary_capacity = per_binary_capacity.max(1);
        self
    }
}

/// Live load on each binary basename while [`assign`] runs.
struct LoadLedger<'p> {
    policy: &'p DistributionPolicy,
    /// binary_key → in-flight count (seeded from the roster, bumped per
    /// assignment so the no-same-binary-parallel budget is enforced WITHIN a
    /// single assign() call too).
    in_flight: HashMap<String, u32>,
}

impl<'p> LoadLedger<'p> {
    fn has_spare(&self, binary_key: &str) -> bool {
        *self.in_flight.get(binary_key).unwrap_or(&0) < self.policy.per_binary_capacity
    }

    fn bump(&mut self, binary_key: &str) {
        *self.in_flight.entry(binary_key.to_string()).or_insert(0) += 1;
    }

    fn load(&self, binary_key: &str) -> u32 {
        *self.in_flight.get(binary_key).unwrap_or(&0)
    }
}

/// Place `ready` tasks onto `roster` blades under `policy`, returning the
/// assignments in input order. A task with no spare-capacity binary is left
/// unassigned (it waits for the next tick) — never forced onto a saturated
/// binary, never dropped silently.
///
/// `current_in_flight` seeds the per-binary load from the world outside this
/// call (claims already running), so the result respects work already in
/// progress. Keyed by binary basename.
pub fn assign(
    ready: &[ReadyTask],
    roster: &[Blade],
    policy: &DistributionPolicy,
    current_in_flight: &HashMap<String, u32>,
) -> Vec<Assignment> {
    let mut ledger = LoadLedger {
        policy,
        in_flight: current_in_flight.clone(),
    };

    let mut out = Vec::new();
    for task in ready {
        if let Some(blade) = pick_blade(task.intent, roster, &ledger) {
            ledger.bump(&blade.binary_key);
            out.push(Assignment {
                task_id: task.task_id.clone(),
                provider_id: blade.provider_id.clone(),
            });
        }
        // else: no spare capacity anywhere — task waits, no assignment.
    }
    out
}

/// Pick the best blade for `intent`: the affinity-preferred provider if it
/// has spare capacity, otherwise the least-loaded blade that still has spare
/// capacity (anti-idle balancing). `None` only when EVERY blade is at its
/// per-binary capacity.
fn pick_blade<'r>(intent: Intent, roster: &'r [Blade], ledger: &LoadLedger) -> Option<&'r Blade> {
    // 1. Affinity: honour the preferred provider if it has room.
    if let AutoSpawnDecision::Spawn { provider_id, .. } = decide_auto_spawn(intent, &ledger.policy.affinity)
    {
        if let Some(preferred) = roster
            .iter()
            .find(|b| b.provider_id == provider_id && ledger.has_spare(&b.binary_key))
        {
            return Some(preferred);
        }
    }

    // 2. Anti-idle fallback: the least-loaded blade with spare capacity.
    // Tie-break by roster order (stable, deterministic) via the `min_by_key`
    // taking the FIRST minimum. Using an index keeps the comparison total.
    roster
        .iter()
        .filter(|b| ledger.has_spare(&b.binary_key))
        .min_by_key(|b| ledger.load(&b.binary_key))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn roster3() -> Vec<Blade> {
        vec![
            Blade::new("claude-code-cli", "claude"),
            Blade::new("codex-cli", "codex"),
            Blade::new("opencode-go", "opencode"),
        ]
    }

    fn no_load() -> HashMap<String, u32> {
        HashMap::new()
    }

    #[test]
    fn anti_idle_uses_a_free_blade_for_available_work() {
        // One ready task + idle blades → it MUST be placed (no idle blade
        // while work waits).
        let ready = vec![ReadyTask::new("t1", Intent::Implement)];
        let out = assign(&ready, &roster3(), &DistributionPolicy::default(), &no_load());
        assert_eq!(out.len(), 1, "available work must not leave blades idle");
        assert_eq!(out[0].task_id, "t1");
    }

    #[test]
    fn spreads_across_distinct_binaries_no_same_binary_parallel() {
        // Three ready tasks, three distinct-binary blades, capacity 1 each →
        // each task lands on a DIFFERENT binary; none doubles up.
        let ready = vec![
            ReadyTask::new("t1", Intent::Implement),
            ReadyTask::new("t2", Intent::Implement),
            ReadyTask::new("t3", Intent::Implement),
        ];
        let out = assign(&ready, &roster3(), &DistributionPolicy::default(), &no_load());
        assert_eq!(out.len(), 3);
        let mut binaries: Vec<&str> = out
            .iter()
            .map(|a| match a.provider_id.as_str() {
                "claude-code-cli" => "claude",
                "codex-cli" => "codex",
                "opencode-go" => "opencode",
                other => other,
            })
            .collect();
        binaries.sort();
        binaries.dedup();
        assert_eq!(binaries.len(), 3, "no two tasks may share a binary at cap 1");
    }

    #[test]
    fn capacity_one_holds_back_excess_work() {
        // Four tasks, three cap-1 binaries → only 3 placed, the 4th waits.
        let ready = vec![
            ReadyTask::new("t1", Intent::Implement),
            ReadyTask::new("t2", Intent::Implement),
            ReadyTask::new("t3", Intent::Implement),
            ReadyTask::new("t4", Intent::Implement),
        ];
        let out = assign(&ready, &roster3(), &DistributionPolicy::default(), &no_load());
        assert_eq!(out.len(), 3, "cap-1 binaries can hold at most 3 concurrent tasks");
    }

    #[test]
    fn respects_in_flight_seed_no_same_binary_parallel() {
        // claude is already busy (in-flight 1, cap 1). A claude-affinity task
        // must NOT double up on claude — it spills to another binary.
        let affinity = AutoSpawnPolicy::enabled_default(); // Implement → claude-code-cli
        let policy = DistributionPolicy::default().with_affinity(affinity);
        let mut seeded = HashMap::new();
        seeded.insert("claude".to_string(), 1u32);

        let ready = vec![ReadyTask::new("t1", Intent::Implement)];
        let out = assign(&ready, &roster3(), &policy, &seeded);
        assert_eq!(out.len(), 1, "anti-idle: spill to a free binary, do not drop");
        assert_ne!(
            out[0].provider_id, "claude-code-cli",
            "must not run a 2nd claude task while claude is at capacity"
        );
    }

    #[test]
    fn affinity_override_routes_to_chosen_provider() {
        // Override Implement → codex; with all binaries free the preferred
        // one wins.
        let affinity = AutoSpawnPolicy::enabled_default().with_override(Intent::Implement, "codex-cli");
        let policy = DistributionPolicy::default().with_affinity(affinity);
        let ready = vec![ReadyTask::new("t1", Intent::Implement)];
        let out = assign(&ready, &roster3(), &policy, &no_load());
        assert_eq!(out[0].provider_id, "codex-cli", "affinity override must win when free");
    }

    #[test]
    fn higher_capacity_allows_same_binary_concurrency() {
        // capacity 2 on a single-blade roster → two tasks both land on it.
        let policy = DistributionPolicy::default().with_capacity(2);
        let roster = vec![Blade::new("claude-code-cli", "claude")];
        let ready = vec![
            ReadyTask::new("t1", Intent::Implement),
            ReadyTask::new("t2", Intent::Implement),
            ReadyTask::new("t3", Intent::Implement),
        ];
        let out = assign(&ready, &roster, &policy, &no_load());
        assert_eq!(out.len(), 2, "cap-2 binary takes 2 concurrent, holds the 3rd");
    }

    #[test]
    fn empty_roster_assigns_nothing() {
        let ready = vec![ReadyTask::new("t1", Intent::Implement)];
        let out = assign(&ready, &[], &DistributionPolicy::default(), &no_load());
        assert!(out.is_empty());
    }

    #[test]
    fn from_env_reads_capacity_and_affinity() {
        let mut env = HashMap::new();
        env.insert("APOHARA_BLADE_CAPACITY".to_string(), "3".to_string());
        env.insert("APOHARA_SMART_ROUTER".to_string(), "1".to_string());
        let p = DistributionPolicy::from_env(&env);
        assert_eq!(p.per_binary_capacity, 3);
        assert!(p.affinity.enabled);

        // Garbage / sub-1 capacity folds to the runSerialized default.
        let mut bad = HashMap::new();
        bad.insert("APOHARA_BLADE_CAPACITY".to_string(), "0".to_string());
        assert_eq!(DistributionPolicy::from_env(&bad).per_binary_capacity, 1);
    }
}
