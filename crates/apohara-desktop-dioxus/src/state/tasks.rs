//! Global tasks state — replaces `packages/desktop/src/store/dagStore.ts`.
//!
//! The TS side used `jotai/vanilla` atoms keyed by task id. The Dioxus side
//! uses a single `GlobalSignal<HashMap<String, DagTask>>` — same shape, same
//! semantics, no React/jotai dependency.
//!
//! Types are defined locally rather than imported from `apohara-types`
//! because the canonical crate currently only carries IPC / capabilities /
//! version contracts. UI projection types (DagTask, TaskStatus) live here
//! until Sprint 19 collapses the TS desktop and we promote these to the
//! shared crate via ts-rs (§0.7).

use dioxus::prelude::*;
use std::collections::HashMap;

/// The 7 task statuses in column order rendered left→right by TaskBoard.
/// Mirrors `TaskStatus` from `packages/desktop/src/store/dagStore.ts`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash)]
pub enum TaskStatus {
    #[default]
    Pending,
    Ready,
    Dispatched,
    InVerification,
    Done,
    Failed,
    Blocked,
}

/// UI projection of a DAG task. Mirrors the `DagTask` interface in
/// `dagStore.ts`. Fields use `Option` where the TS shape used `?:`.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct DagTask {
    pub id: String,
    pub title: String,
    pub status: TaskStatus,
    pub agent_role: Option<String>,
    pub provider_id: Option<String>,
    pub worktree_slug: Option<String>,
    pub duration_ms: Option<u64>,
    pub cost_usd: Option<f64>,
    pub tokens_in: Option<u64>,
    pub tokens_out: Option<u64>,
    pub blocked_reason: Option<String>,
    pub waiting_for_task_id: Option<String>,
    pub overlap_symbols: Option<Vec<String>>,
}

/// Root signal: `Map<TaskId, DagTask>`. Both SwarmCanvas and TaskBoard
/// read from this single source so the two surfaces never drift.
pub static TASKS: GlobalSignal<HashMap<String, DagTask>> = Signal::global(HashMap::new);

/// Insert or replace a task keyed by `task.id`.
pub fn upsert_task(task: DagTask) {
    TASKS.write().insert(task.id.clone(), task);
}

/// Remove a task by id; no-op if it doesn't exist.
pub fn remove_task(id: &str) {
    TASKS.write().remove(id);
}

/// Snapshot all tasks. Cloned so callers don't hold the signal lock.
pub fn all_tasks() -> Vec<DagTask> {
    TASKS.read().values().cloned().collect()
}
