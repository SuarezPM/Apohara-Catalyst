//! Blast radius per spec §3.2.
//!
//! A `BlastRadius` is the set of symbols transitively affected by a task's
//! declared writes/renames, as expanded by the indexer's call-graph. The
//! coordinator unions the blast radius into the manifest's `writes` set
//! before applying the conflict matrix.
//!
//! [`Confidence`] reflects how trustworthy the expansion is: `High` →
//! `Assign` if no conflict, `Low` → `Queue` defensively, `None` → `Defer`
//! and retry once the indexer recovers (gradient policy, spec §3.2).

use crate::manifest::SymbolRef;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// Indexer confidence in the blast-radius expansion for a manifest.
///
/// See spec §3.2 "Política gradient":
/// - `High`: all symbols resolved and < 10% of edges unknown → `Assign`
/// - `Low`: some symbols missing or 10-50% edges unknown → `Queue`
/// - `None`: indexer unreachable or > 50% unknown → `Defer` (retry 30s)
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Confidence {
    High,
    Low,
    None,
}

/// Transitive set of symbols reachable from a task's writes/renames, with
/// an indexer-supplied confidence score.
#[derive(Debug, Clone)]
pub struct BlastRadius {
    pub symbols: HashSet<SymbolRef>,
    pub confidence: Confidence,
}
