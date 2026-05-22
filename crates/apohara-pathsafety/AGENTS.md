# apohara-pathsafety

Symlink-escape detection for the worktree spawn flow (spec §3.11).

## What this crate enforces

Three invariants every worker MUST satisfy before spawning an agent subprocess:

1. `cwd == workspace_path` (caller responsibility — assert before `Command::spawn`).
2. `workspace_path` has `workspace_root` as prefix AFTER full symlink resolution.
3. Workspace directory name uses only `[A-Za-z0-9._-]`; other chars get replaced with `_`.

## API surface

| Function | Purpose |
|---|---|
| `canonicalize_recursive(path, max_depth)` | Resolve all symlinks; surfaces `Io` on broken links. |
| `validate_cwd(workspace, workspace_root)` | Returns `Ok(())` only if `workspace` is a strict sub-path of `workspace_root` post-canonicalize. |
| `safe_identifier(s)` | Replace any char outside `[A-Za-z0-9._-]` with `_`. |

## `PathSafetyError` variants

- `EscapesRoot { canonical, root }` — surface path is literally outside the root (likely a config mistake).
- `SymlinkEscape { surface, target }` — surface path appears to live inside the root but resolves outside it. **Treat as an attack signal**, not user error. Stage 4 scheduler must log this distinctly and refuse to dispatch.
- `EqualToRoot` — caller asked to use the root itself as the workspace; require a sub-path so per-task isolation can never accidentally land at the project root.
- `InvalidCharsInIdentifier(_)` — reserved for callers that prefer strict rejection over auto-rewrite. `safe_identifier` itself never returns this; future callers can.
- `Io(_)` — propagated from `std::fs::canonicalize` (broken link, permission denied, etc.).

## Why distinguish `SymlinkEscape` from `EscapesRoot`

A literal `/tmp/foo` outside `/home/user/repo` is almost always a misconfiguration. A symlink at `/home/user/repo/evil → /etc` is hostile: either a malicious checkout, a compromised worktree, or a TOCTOU race. Stage 4 surfaces these to the audit sink (§3.5) and Stage 9 telemetry so we can spot active probing.

## Running tests

```bash
cargo test -p apohara-pathsafety
```

5 tests total. The symlink-escape test is gated on `#[cfg(unix)]`; Windows coverage arrives when we wire `MountPoint`/junction handling in Stage 4.

## Downstream consumers (planned)

- `apohara-worktree` (Stage 4) — call `validate_cwd` after `git worktree add`, before any spawn.
- `apohara-coordinator` (Stage 4.18) — call before each task dispatch; on error mark task `failed` with reason `path_safety_violation`.
- `apohara-audit` (Stage 1.12) — log `SymlinkEscape` as `kind=security_event`.

## Do NOT

- Do NOT bypass `validate_cwd` "because the path looks fine" — Stage 4 spawn flow is the one place where this gate exists.
- Do NOT widen `safe_identifier` to accept additional characters without updating the spec — filesystem portability across macOS/Linux/Windows depends on the conservative set.
- Do NOT swallow `SymlinkEscape` into a generic "path error" — losing this distinction defeats the entire crate.
