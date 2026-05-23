//! Multi-pass reconciler.
//!
//! Ported from `src/core/dispatch/reconciler.ts` (TS legacy, post-Sprint-5 G5.B.2).
//! Runs N passes per tick. G1.A.4 lands the structure with stub passes;
//! G1.A.5 fills `run_stall_detection_pass` with the real ledger scan;
//! G1.A.6 fills `run_blocked_aging_pass`.

use anyhow::Result;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone)]
pub struct ReconcilerCtx {
    pub ledger_path: String,
    pub workspace: String,
    pub session_id: String,
    pub blocked_aging_ms: u64,
    pub stall_timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PassResult {
    pub name: String,
    pub affected: Vec<String>,
    pub details: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReconcilerResult {
    pub pass_results: Vec<PassResult>,
    pub total_affected: Vec<String>,
}

pub fn run_reconciler_passes(ctx: &ReconcilerCtx) -> Result<ReconcilerResult> {
    let mut pass_results = Vec::new();
    let mut total_affected = Vec::new();

    let stall_pass = run_stall_detection_pass(ctx)?;
    total_affected.extend(stall_pass.affected.iter().cloned());
    pass_results.push(stall_pass);

    let aging_pass = run_blocked_aging_pass(ctx)?;
    total_affected.extend(aging_pass.affected.iter().cloned());
    pass_results.push(aging_pass);

    total_affected.sort();
    total_affected.dedup();

    Ok(ReconcilerResult { pass_results, total_affected })
}

fn run_stall_detection_pass(ctx: &ReconcilerCtx) -> Result<PassResult> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let content = std::fs::read_to_string(&ctx.ledger_path).unwrap_or_default();
    let mut latest_dispatched: std::collections::HashMap<String, u64> =
        std::collections::HashMap::new();
    let mut completed: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in content.lines() {
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let Some(kind) = v.get("kind").and_then(|k| k.as_str()) else {
            continue;
        };
        let Some(task_id) = v.get("task_id").and_then(|t| t.as_str()) else {
            continue;
        };
        let ts = v.get("ts").and_then(|t| t.as_u64()).unwrap_or(0);

        match kind {
            "task_dispatched" => {
                latest_dispatched.insert(task_id.to_string(), ts);
            }
            "task_completed" | "task_failed" => {
                completed.insert(task_id.to_string());
            }
            _ => {}
        }
    }

    let mut stalled = Vec::new();
    for (task_id, dispatched_ts) in &latest_dispatched {
        if completed.contains(task_id) {
            continue;
        }
        if now_ms.saturating_sub(*dispatched_ts) > ctx.stall_timeout_ms {
            stalled.push(task_id.clone());
        }
    }
    stalled.sort();

    Ok(PassResult {
        name: "stall_detection".to_string(),
        details: format!("{} stalled tasks", stalled.len()),
        affected: stalled,
    })
}

fn run_blocked_aging_pass(ctx: &ReconcilerCtx) -> Result<PassResult> {
    let now_ms = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);

    let content = std::fs::read_to_string(&ctx.ledger_path).unwrap_or_default();
    let mut latest_blocked: std::collections::HashMap<String, u64> =
        std::collections::HashMap::new();
    let mut released: std::collections::HashSet<String> = std::collections::HashSet::new();

    for line in content.lines() {
        if line.is_empty() {
            continue;
        }
        let Ok(v) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let Some(kind) = v.get("kind").and_then(|k| k.as_str()) else {
            continue;
        };
        let Some(task_id) = v.get("task_id").and_then(|t| t.as_str()) else {
            continue;
        };
        let ts = v.get("ts").and_then(|t| t.as_u64()).unwrap_or(0);

        match kind {
            "task_blocked" => {
                latest_blocked.insert(task_id.to_string(), ts);
            }
            "task_unblocked" | "task_completed" | "task_failed" | "needs_operator" => {
                released.insert(task_id.to_string());
            }
            _ => {}
        }
    }

    let mut aged = Vec::new();
    for (task_id, blocked_ts) in &latest_blocked {
        if released.contains(task_id) {
            continue;
        }
        if now_ms.saturating_sub(*blocked_ts) > ctx.blocked_aging_ms {
            aged.push(task_id.clone());
        }
    }
    aged.sort();

    Ok(PassResult {
        name: "blocked_aging".to_string(),
        details: format!("{} blocked tasks past aging threshold", aged.len()),
        affected: aged,
    })
}
