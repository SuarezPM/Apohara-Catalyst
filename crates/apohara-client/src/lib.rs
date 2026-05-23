//! Apohara client — thin SDK used by `apohara` CLI and TS bridge to talk to
//! the daemon (G6.A.2). Owns the connect/reconnect loop (G6.A.4) and exposes
//! a stream-based subscribe API once the WS hub (G6.A.5) is wired.

pub mod connect;

#[cfg(test)]
mod connect_tests;

pub fn version() -> &'static str {
    env!("CARGO_PKG_VERSION")
}

pub use connect::{
    connect_with_backoff, BackoffPolicy, ConnectError, DeterministicClock, RetryClock,
};
