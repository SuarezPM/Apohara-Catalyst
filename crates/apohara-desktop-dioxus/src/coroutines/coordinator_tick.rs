//! US-S6 — continuous background coordinator coroutine (D4-A).
//!
//! A 1s poll, sibling of `claim_watcher` / `utilization_watcher`, that drives
//! the mesh DAG forward even with NO foreground `run_dispatch` in flight — so a
//! node a reaper freed *between* runs gets re-dispatched without a human re-Run
//! (the D4-A "active background dispatch" win over the D4-B on-demand loop).
//!
//! Safety: this is the SECOND spawn driver. It is made safe by
//! [`dispatch_loop::MESH_DRIVE_LOCK`] (single driver at a time — the foreground
//! run holds it for its whole duration; this tick `try_lock`s and skips when a
//! run owns it) ON TOP OF the per-node cross-process claim lock (no
//! double-spawn). It reuses the SINGLE `spawn_blade` site via
//! [`dispatch_loop::drive_background_tick`], so the two drivers can never drift.
//!
//! Gated on `APOHARA_MESH`: when the flag is off this coroutine is inert (the
//! bake-off owns its own lifecycle). Reaper liveness is NOT here (Story #1
//! reaps-on-exit; Story #2's watcher reaps between runs) — this is purely the
//! active-dispatch enhancement.

use std::path::PathBuf;
use std::time::Duration;

use dioxus::prelude::*;

use crate::coroutines::dispatch_loop::{drive_background_tick, mesh_enabled};

/// Mount the 1s background-dispatch poll. Self-driven; the receiver is unused.
pub fn mount() {
    let _ = use_coroutine(|_rx: UnboundedReceiver<()>| async move {
        let repo = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        loop {
            tokio::time::sleep(Duration::from_secs(1)).await;
            // Inert unless the mesh flag is on; the drive itself is best-effort
            // (a foreground run owning the lock, or no ready work, yields 0).
            if mesh_enabled(std::env::var("APOHARA_MESH").ok().as_deref()) {
                let dispatched = drive_background_tick(&repo).await;
                if dispatched > 0 {
                    tracing::info!(dispatched, "mesh background coordinator dispatched ready work");
                }
            }
        }
    });
}
