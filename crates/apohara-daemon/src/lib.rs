//! Apohara daemon — long-lived background service for Ultimate Sprint 6 (G6.A).
//!
//! Behind feature flag `APOHARA_DAEMON_MODE=1`. The daemon hosts the WS hub,
//! local-socket transport, profile state, and reactor sidecars. Clients
//! (`apohara-client`) connect via local socket; daemon publishes events to
//! subscribers and exposes a health endpoint.
//!
//! Defense-in-depth: if the daemon is not running, `apohara` CLI falls back to
//! monolithic mode (see `src/cli/entry.ts`).

pub mod profiles;
pub mod health;
pub mod shutdown;
pub mod dispatch_remote;
pub mod recovery;
pub mod reactor;

#[cfg(test)]
mod profiles_tests;
#[cfg(test)]
mod health_tests;
#[cfg(test)]
mod shutdown_tests;

/// Crate version surfaced to clients for compatibility checks.
pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

/// Whether daemon mode is enabled via env. Reads `APOHARA_DAEMON_MODE`; any
/// value other than `"1"` (or unset) keeps the legacy monolithic mode.
pub fn daemon_mode_enabled() -> bool {
    std::env::var("APOHARA_DAEMON_MODE").as_deref() == Ok("1")
}
