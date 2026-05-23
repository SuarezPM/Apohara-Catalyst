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

fn run_stall_detection_pass(_ctx: &ReconcilerCtx) -> Result<PassResult> {
    Ok(PassResult {
        name: "stall_detection".to_string(),
        affected: vec![],
        details: "no stalls detected".to_string(),
    })
}

fn run_blocked_aging_pass(_ctx: &ReconcilerCtx) -> Result<PassResult> {
    Ok(PassResult {
        name: "blocked_aging".to_string(),
        affected: vec![],
        details: "no blocked tasks past aging threshold".to_string(),
    })
}
