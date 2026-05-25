//! Code diff state — the winning provider's unified diff, shown in CodeDiffPane.
//!
//! NEW signal (Sprint 23). Set by the dispatch loop (W4.4) with the best
//! result; cleared on Reject (W3.C.2) or after a successful `git apply` (W4.7).

use dioxus::prelude::*;

/// A unified diff plus metadata about which provider produced it.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Diff {
    pub unified: String,
    pub files_changed: Vec<String>,
    pub provider_winner: String,
}

/// Root signal carrying the current diff, or `None` when there's nothing to show.
pub static CODE_DIFF: GlobalSignal<Option<Diff>> = Signal::global(|| None);

/// Set the current diff.
pub fn set(diff: Diff) {
    *CODE_DIFF.write() = Some(diff);
}

/// Clear the current diff.
pub fn clear() {
    *CODE_DIFF.write() = None;
}
