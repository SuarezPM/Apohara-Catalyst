# apohara-persistence — Agent Guide

> Cross-platform USER-LEVEL service installer (spec §0.20).

## Responsibility

Pure-string template builders + path resolvers for autostart registration of
Apohara sidecars (e.g. `apohara-hooks-server`, indexer) on user login. Stage 11
release wires installation into the packaging step.

Strictly USER-LEVEL. **Never** generates system-wide daemons (no
`/etc/systemd/system/`, no `/Library/LaunchDaemons/`, no `schtasks /SC ONSTART`).

## Input validation

All three builders REJECT inputs that would produce malformed or injectable
output:

- `build_systemd_user_unit(name, exec_start)`:
  - `name`: must match `[a-zA-Z0-9_-]+` and be non-empty
  - `exec_start`: must not contain `\n`, `\r`, `%`, or start with `@`/`-`/`+`/`:`/`!`
- `build_launchd_plist(label, args)`: all `<`, `>`, `&`, `"`, `'` in label and args
  are XML-escaped. No rejections — the escaper handles everything.
- `build_windows_schtasks(task_name, exec)`:
  - `task_name`: must not contain control chars, `&|<>^"`
  - `exec`: same restrictions (cmd.exe quoting cannot represent these safely)

When validation fails, `PersistenceError::InvalidInput { field, reason }` is
returned. Callers must NOT bypass these checks; they're the only defense
between a misconfigured config file and arbitrary code execution at login.

## Public API

| Function | Platform | Purpose |
|---|---|---|
| `build_systemd_user_unit(name, exec_start)` | Linux | `[Unit]`+`[Service]`+`[Install]` text (validated) |
| `build_launchd_plist(label, args)` | macOS | `<plist>` XML with `RunAtLoad`+`KeepAlive` (XML-escaped) |
| `build_windows_schtasks(task_name, exec)` | Windows | `schtasks /Create /SC ONLOGON ...` command (validated) |
| `systemd_unit_path(name)` | Linux | `~/.config/systemd/user/<name>.service` |
| `launchd_plist_path(label)` | macOS | `~/Library/LaunchAgents/<label>.plist` |

All functions are pure (no IO). Callers are responsible for writing the rendered
content to disk via `apohara-persistence`-aware writers (atomic write + 0600).

## Errors

`PersistenceError`: `Io`, `NoHomeDir`, `UnsupportedPlatform`, `InvalidInput`.

## Tests

```bash
cargo test -p apohara-persistence
```

Integration tests in `tests/templates.rs` cover:
- Happy-path tokens (`ExecStart=`, `<key>Label</key>`, `/SC ONLOGON`).
- USER-LEVEL invariant: systemd unit MUST contain `WantedBy=default.target`
  (never `multi-user.target`).
- Hostile inputs: newline / `%` / prefix specifier / invalid name for systemd;
  `</string>` plist injection; `&` in task name; `"` in exec for schtasks.

Builders are pure functions, so no fixtures or temp dirs.

## OOM hazard

None. Crate has no heavy deps. Safe to run scoped tests.

## What NOT to do

- Do **not** add system-daemon code paths.
- Do **not** invoke `systemctl`/`launchctl`/`schtasks` from this crate. Stay
  pure-template; let the release packager shell out.
- Do **not** inline secrets or absolute paths from the host — accept them as
  parameters so callers control sandbox boundaries.
- Do **not** bypass `InvalidInput` validation by reformatting hostile input.
  If a user-supplied label or exec path doesn't pass, the correct fix is to
  reject it upstream (config validation), not to "sanitize" it here.
