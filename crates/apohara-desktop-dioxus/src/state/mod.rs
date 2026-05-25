//! Global UI state stores for the Dioxus desktop rewrite.
//!
//! Each submodule owns one `GlobalSignal` that replaces a jotai atom from
//! `packages/desktop/src/store/`. The 1:1 mapping is documented per-module
//! and finalized in the Sprint 18 (G2.C.1) cierre commit.
//!
//! Tests live in `state_test.rs` (one test module per signal) so the
//! signal/operation pairing is reviewed together rather than scattered.

pub mod code_diff;
pub mod command_palette;
pub mod objective_input;
pub mod permissions;
pub mod roster;
pub mod running_status;
pub mod selected_task;
pub mod sse_events;
pub mod tasks;
pub mod toast_queue;
pub mod view_mode;

#[cfg(test)]
mod state_test;
