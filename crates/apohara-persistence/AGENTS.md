# apohara-persistence — Agent Guide

> Cross-platform USER-LEVEL service installer (spec §0.20).

## Responsibility

Pure-string template builders + path resolvers for autostart registration of
Apohara sidecars (e.g. `apohara-hooks-server`, indexer) on user login. Stage 11
release wires installation into the packaging step.

Strictly USER-LEVEL. **Never** generates system-wide daemons (no
`/etc/systemd/system/`, no `/Library/LaunchDaemons/`, no `schtasks /SC ONSTART`).

## Public API

| Function | Platform | Purpose |
|---|---|---|
| `build_systemd_user_unit(name, exec_start)` | Linux | `[Unit]`+`[Service]`+`[Install]` text |
| `build_launchd_plist(label, args)` | macOS | `<plist>` XML with `RunAtLoad`+`KeepAlive` |
| `build_windows_schtasks(task_name, exec)` | Windows | `schtasks /Create /SC ONLOGON ...` command |
| `systemd_unit_path(name)` | Linux | `~/.config/systemd/user/<name>.service` |
| `launchd_plist_path(label)` | macOS | `~/Library/LaunchAgents/<label>.plist` |

All functions are pure (no IO). Callers are responsible for writing the rendered
content to disk via `apohara-persistence`-aware writers (atomic write + 0600).

## Errors

`PersistenceError`: `Io`, `NoHomeDir`, `UnsupportedPlatform`.

## Tests

```bash
cargo test -p apohara-persistence
```

Three integration tests in `tests/templates.rs` assert the rendered output
contains the load-bearing tokens (`ExecStart=`, `<key>Label</key>`,
`/SC ONLOGON`). Builders are pure functions, so no fixtures or temp dirs.

## OOM hazard

None. Crate has no heavy deps. Safe to run scoped tests.

## What NOT to do

- Do **not** add system-daemon code paths.
- Do **not** invoke `systemctl`/`launchctl`/`schtasks` from this crate. Stay
  pure-template; let the release packager shell out.
- Do **not** inline secrets or absolute paths from the host — accept them as
  parameters so callers control sandbox boundaries.
