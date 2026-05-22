//! TaskSymbolManifest per spec §3.2.
//!
//! Symbol-level declaration of what a task `reads`, `writes`, and `renames`.
//! The coordinator consumes manifests to build a conflict matrix between
//! a candidate task and every currently-dispatched task before assignment.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ts_rs::TS;

/// Kind of symbol being referenced. Mirrors the language-agnostic categories
/// the indexer exposes.
#[derive(Debug, Clone, Serialize, Deserialize, Hash, PartialEq, Eq, TS)]
#[serde(rename_all = "snake_case")]
#[ts(export)]
pub enum SymbolKind {
    Function,
    Class,
    Type,
    Module,
    Constant,
    Trait,
    Enum,
    Other,
}

/// Stable reference to a symbol within the workspace.
///
/// Two `SymbolRef`s are equal iff their `(file, symbol, kind)` triple matches
/// exactly. This is what `conflict_matrix::check` intersects on.
#[derive(Debug, Clone, Serialize, Deserialize, Hash, PartialEq, Eq, TS)]
#[ts(export)]
pub struct SymbolRef {
    pub file: String,
    pub symbol: String,
    pub kind: SymbolKind,
}

/// The set of symbols a single task intends to touch, classified by intent.
///
/// `reads` is the most permissive bucket (read ∩ read parallelizes), `writes`
/// blocks any other write or read of the same symbol, and `renames` is the
/// most disruptive — it always blocks every other access because the symbol
/// identity itself is changing.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[ts(export)]
pub struct TaskSymbolManifest {
    pub reads: Vec<SymbolRef>,
    pub writes: Vec<SymbolRef>,
    pub renames: Vec<SymbolRef>,
}

impl TaskSymbolManifest {
    /// Construct an empty manifest (no reads, writes, or renames).
    pub fn empty() -> Self {
        TaskSymbolManifest { reads: vec![], writes: vec![], renames: vec![] }
    }

    /// Set of `writes` for cheap overlap testing.
    pub fn writes_set(&self) -> HashSet<&SymbolRef> {
        self.writes.iter().collect()
    }

    /// Set of `reads` for cheap overlap testing.
    pub fn reads_set(&self) -> HashSet<&SymbolRef> {
        self.reads.iter().collect()
    }

    /// Set of `renames` for cheap overlap testing.
    pub fn renames_set(&self) -> HashSet<&SymbolRef> {
        self.renames.iter().collect()
    }
}
