//! Conflict matrix per spec §3.2.
//!
//! ```text
//!              reads(B)    writes(B)   renames(B)
//! reads(A)     OK          conflict    conflict
//! writes(A)    conflict    conflict    conflict
//! renames(A)   conflict    conflict    conflict
//! ```
//!
//! Only `reads ∩ reads` parallelizes; everything else is a flavor of conflict.
//! Renames are the most disruptive: a rename invalidates *any* outstanding
//! reference to the symbol (the symbol identity itself is about to change),
//! so they are checked first and dominate the result.
//!
//! The function returns the *first* conflict found, ordered by severity:
//! `RenameVsRename` > `RenameVsWrite` > `RenameVsRead` > `WriteWrite`
//! > `WriteRead` > `ReadWrite` > `None`.

use crate::manifest::{SymbolRef, TaskSymbolManifest};

/// Outcome of [`check`]: either `None` (safe to parallelize) or one of six
/// conflict variants carrying the overlapping symbols for diagnostic purposes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ConflictKind {
    /// No overlap that prevents parallel execution.
    None,
    /// Both tasks intend to write the same symbol(s).
    WriteWrite { overlap: Vec<SymbolRef> },
    /// `a` writes what `b` reads.
    WriteRead { overlap: Vec<SymbolRef> },
    /// `a` reads what `b` writes.
    ReadWrite { overlap: Vec<SymbolRef> },
    /// A rename collides with a read on the same symbol.
    RenameVsRead { overlap: Vec<SymbolRef> },
    /// A rename collides with a write on the same symbol.
    RenameVsWrite { overlap: Vec<SymbolRef> },
    /// Both tasks intend to rename the same symbol.
    RenameVsRename { overlap: Vec<SymbolRef> },
}

/// Apply the conflict matrix to two manifests and return the first detected
/// conflict (or [`ConflictKind::None`]).
///
/// The order of operands matters only for `WriteRead` vs `ReadWrite`:
/// `WriteRead` means *`a` writes what `b` reads*. Renames are symmetric for
/// reporting purposes — `RenameVsRead { overlap }` is returned regardless of
/// which manifest holds the rename.
pub fn check(a: &TaskSymbolManifest, b: &TaskSymbolManifest) -> ConflictKind {
    // Renames dominate — check every rename-related cell first.
    let rr = intersect(&a.renames, &b.renames);
    if !rr.is_empty() {
        return ConflictKind::RenameVsRename { overlap: rr };
    }
    let rw = intersect(&a.renames, &b.writes);
    if !rw.is_empty() {
        return ConflictKind::RenameVsWrite { overlap: rw };
    }
    let rrd = intersect(&a.renames, &b.reads);
    if !rrd.is_empty() {
        return ConflictKind::RenameVsRead { overlap: rrd };
    }
    let wr = intersect(&a.writes, &b.renames);
    if !wr.is_empty() {
        return ConflictKind::RenameVsWrite { overlap: wr };
    }
    let rdr = intersect(&a.reads, &b.renames);
    if !rdr.is_empty() {
        return ConflictKind::RenameVsRead { overlap: rdr };
    }

    // No renames involved — fall through to write/read overlaps.
    let ww = intersect(&a.writes, &b.writes);
    if !ww.is_empty() {
        return ConflictKind::WriteWrite { overlap: ww };
    }
    let wrd = intersect(&a.writes, &b.reads);
    if !wrd.is_empty() {
        return ConflictKind::WriteRead { overlap: wrd };
    }
    let rdw = intersect(&a.reads, &b.writes);
    if !rdw.is_empty() {
        return ConflictKind::ReadWrite { overlap: rdw };
    }

    ConflictKind::None
}

/// Set-intersect two slices of `SymbolRef`, returning the overlap as owned
/// values. Uses a `HashSet` of references against `b` for `O(|a| + |b|)`.
fn intersect(a: &[SymbolRef], b: &[SymbolRef]) -> Vec<SymbolRef> {
    let set: std::collections::HashSet<&SymbolRef> = b.iter().collect();
    a.iter().filter(|r| set.contains(r)).cloned().collect()
}
