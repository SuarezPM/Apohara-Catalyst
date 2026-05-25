//! apohara-token-accounting — per-thread absolute token counting per spec §0.14.
//!
//! Replaces the Stage 2 placeholder. The key invariant is **absolutes >
//! deltas**: provider events carry cumulative totals, not increments. We
//! store the last known absolute per thread and replace on each event;
//! the cross-thread total sums those last-knowns. This makes reconnects
//! and replays idempotent.

pub mod api;
pub mod counter;
pub use counter::{ThreadKey, TokenCounter, TokenSnapshot};

#[cfg(test)]
mod tests;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
