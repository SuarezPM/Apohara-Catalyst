# Post-launch smoke — Apohara Catalyst v1.0 (Sprint 23)

Manual checklist run after `bash scripts/install-arch.sh`. Mirrors the 9
acceptance criteria from the design spec §5. Tick each after observing it in the
running app (`apohara-catalyst`).

> Note: criteria assume the active CLIs are on `PATH`. The roster shows only the
> providers actually found (`which claude|codex|opencode`); if a CLI isn't
> installed it's filtered out — e.g. with only claude + opencode you'll see 2
> dispatch lanes, not 3.

## Checklist

- [ ] **1. Launch from menu** — `apohara-catalyst` opens from the KDE/Plasma (or
  GNOME) launcher; window title reads "Apohara Catalyst".
- [ ] **2. Dispatch + stream** — type a goal → click **Run** → each active
  provider gets a task node, and its live stdout streams into the Terminal
  drawer (open it from the collapsible header at the bottom of the center pane).
- [ ] **3. Diff + Accept** — for a *coding* goal (e.g. "create hello.rs that
  prints hello world"), a unified diff appears in the CodeDiffPane → click
  **Accept** → the diff is applied to the working tree (a success toast shows).
  A non-coding prompt produces no file changes, so the pane stays "No diff yet".
- [ ] **4. Command palette** — `Ctrl+K` (Cmd+K on mac) opens the palette with
  Run / Load SPEC / Switch View / Clear (+ Install providers).
- [ ] **5. View switch** — the Graph / Board / Terminal toggle swaps the center
  pane between SwarmCanvas / KanbanBoard / TaskBoard live.
- [ ] **6. Statusline** — the bottom bar shows token totals (polled every 1s)
  and the context/clock cells.
- [ ] **7. Permission dialog** — when a permission request is enqueued, the
  PermissionDialog mounts with Once / Session / Always + Deny. *(v1.0: requests
  arrive from the agent-hooks bridge; the auto-check-against-settings path is
  deferred to v1.1.)*
- [ ] **8. Reconciler toast** — the reconciler tick runs every 30s and toasts
  affected tasks. *(v1.0: needs an orchestration ledger wired; a no-ledger pass
  is a silent no-op.)*
- [ ] **9. Install ergonomics** — `bash scripts/install-arch.sh` puts
  `apohara-catalyst` on `PATH` and the `.desktop` entry in the menu.

## Notes / known v1.0 scope

- The dispatch loop runs each provider in its own git worktree (`git worktree`),
  captures the worktree `git diff` as the result, runs the quality gates over
  it, and surfaces the winning diff. Worktrees are cleaned up after each run.
- The R4 compound-bash permission pre-flight does not apply at the desktop
  dispatch level (we spawn `provider --print <goal>`, not a bash command).
- Cross-platform packaging (macOS/Windows, AUR/Homebrew), real mascot art, and
  the settings page are out of scope for v1.0 (spec §4).
