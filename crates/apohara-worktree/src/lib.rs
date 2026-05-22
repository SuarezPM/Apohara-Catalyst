//! Apohara Worktree — git worktree lifecycle per spec §3.1.
//!
//! Public API for both the CLI binary (`apohara-worktree-cli`) and the
//! TypeScript core via Unix Domain Socket (see Task 4.9).

pub mod cleanup;
pub mod lifecycle;
pub mod lineage;
pub mod naming;
pub mod paths;
pub mod preflight;
pub mod uds;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}
