# apohara-secrets — Agent Guide

OS-native credential storage. Wraps `keyring-rs` (cross-platform).

## When to use

- Internal MCP bearer tokens
- GitHub App private key paths
- ContextForge sidecar tokens
- Any secret that would otherwise go to a config file or env var

## When NOT to use

- Provider API keys (PROHIBITED — Apohara uses CLI wrappers, not API keys)
- Settings that are not secrets (use `crates/apohara-config`)

## Pattern

```rust
use apohara_secrets::{SecretScope, store, lookup};

let scope = SecretScope::apohara("mcp-bearer-token-runs");
store(&scope, &my_token)?;
let retrieved = lookup(&scope)?;
```

## Testing

The OS keyring requires a graphical session on Linux. Tests that exercise the
backend are marked `#[ignore]` and run only manually on workstations.

For unit tests, mock at the call site (don't try to mock keyring-rs).

## Headless / CI environments

Real backends (DBus secret-service on Linux, Keychain on macOS, Credential
Manager on Windows) require an active session. In headless CI without
`dbus-launch` + `gnome-keyring-daemon`, store/lookup return
`Err(SecretError::Backend(PlatformFailure(...)))`. Callers should detect this
case and present an actionable message instead of leaking DBus internals.

The `#[ignore]`-marked integration roundtrip test in `tests/integration.rs`
requires a graphical session; run it manually on a workstation, not in CI.
The `backend.rs` test runs in CI and catches a different regression: that
the crate is wired to a real backend at compile time, not the mock store.
