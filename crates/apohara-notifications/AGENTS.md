# apohara-notifications — Cross-platform push notifications

> Implements spec §0.21. Used by Smart Attention (Stage 7) to fire the
> "Needs you" state and other user-visible alerts.

## Public API

```rust
pub enum Urgency { Low, Normal, Critical }

pub struct Notification {
    pub title: String,
    pub body: String,
    pub urgency: Urgency,
    pub sound: Option<String>,
}

#[derive(Debug, thiserror::Error)]
pub enum NotifyError {
    Backend(String),
    NotInitialized,
}

pub trait Notifier: Send + Sync {
    fn notify(&self, notification: Notification) -> Result<(), NotifyError>;
}

pub fn set_global_notifier(notifier: Arc<dyn Notifier>);
pub fn fire(notification: Notification);

pub struct DefaultNotifier; // implements Notifier
```

## Injection model

- `static GLOBAL_NOTIFIER: OnceLock<Arc<dyn Notifier>>` per spec §0.21.
- Tauri startup wires a `TauriNotifier` that calls the native notification
  plugin. Headless / CLI processes wire `DefaultNotifier`.
- `fire()` is a no-op + `tracing::warn!` if no notifier is registered, so
  callers never need to branch on "is Tauri up". If the notifier returns
  `Err`, `fire()` logs at `tracing::error!` with the title attached — backend
  failures (osascript spawn, D-Bus down, etc.) are NEVER silently swallowed.
- Re-initialization is a no-op with a `tracing::warn!` log (was silently
  swallowed before the §0.21 hardening fix).
- In tests this means each integration binary gets ONE notifier — keep test
  surfaces small.

## Platform behaviour (DefaultNotifier)

| OS      | Mechanism                                                                    |
| ------- | ---------------------------------------------------------------------------- |
| macOS   | `osascript -e 'display notification ...'` — title/body escaped via `applescript_escape` to neutralize quote injection (PR titles / branch names are untrusted input). Child is reaped via `wait()` to avoid zombies. |
| Linux   | `notify-rust` (libnotify / D-Bus) — errors propagate as `NotifyError::Backend`. |
| Windows | Stub: logs at `tracing::warn!` (NOT `info!` — production log levels filter `info`). Returns `Ok(())`. Full PowerShell toast comes in later stages per spec §0.21. |

The full Windows toast and sound playback (`afplay`/`paplay`/`aplay`/
PowerShell `SoundPlayer`) come in later stages per spec §0.21.

## Test

```bash
cargo test -p apohara-notifications
```

A single integration test (`tests/api.rs`) installs a `CollectingNotifier`,
fires one notification, and asserts it reached the collector through the
`OnceLock` global. Never run workspace-wide tests on this repo — see root
`AGENTS.md` OOM hazard.
