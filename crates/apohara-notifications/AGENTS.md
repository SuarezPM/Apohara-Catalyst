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

pub trait Notifier: Send + Sync {
    fn notify(&self, notification: Notification);
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
  callers never need to branch on "is Tauri up".
- `OnceLock::set` swallows the second call. In tests this means each
  integration binary gets ONE notifier — keep test surfaces small.

## Platform behaviour (DefaultNotifier)

| OS      | Mechanism                                              |
| ------- | ------------------------------------------------------ |
| macOS   | `osascript -e 'display notification ...'`              |
| Linux   | `notify-rust` (libnotify / D-Bus)                      |
| Windows | PowerShell toast — currently a `tracing::info!` stub   |

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
