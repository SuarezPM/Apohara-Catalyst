//! Effect-owner coroutines (Wave 4). Mounted once from `App` via
//! [`mount_coroutines`]; the message-driven owners (`dispatch_loop`,
//! `git_apply_handler`) expose their `Coroutine` handle through a `GlobalSignal`
//! so the Run / Accept buttons elsewhere can `.send()` to them. The
//! timer-driven owners (`reconciler_tick`, `toast_reaper`) and the queue-driven
//! `permission_arbitrator` are self-running and ignore their receiver.
//!
//! `use_coroutine` defers its future past the SSR render, so the App SSR tests
//! never spin these loops.

pub mod dispatch_loop;
pub mod git_apply_handler;
pub mod permission_arbitrator;
pub mod reconciler_tick;
pub mod toast_reaper;

/// Mount all five effect-owner coroutines. Called unconditionally from `App` so
/// the hook order stays stable.
pub fn mount_coroutines() {
    dispatch_loop::mount();
    git_apply_handler::mount();
    permission_arbitrator::mount();
    reconciler_tick::mount();
    toast_reaper::mount();
}

#[cfg(test)]
mod coroutines_test;
