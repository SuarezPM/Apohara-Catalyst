# @apohara/tui — Ink + React TUI prototype (archived)

> **Status (2026-05-12):** Superseded by **`packages/desktop/`** (Tauri v2 +
> React 19 + Bun.serve + SSE). This Ink-based TUI remains in the tree only
> because `src/commands/dashboard.ts` still launches `cli.tsx` at runtime;
> it will be removed entirely after M017.10 (Playwright E2E proves
> packages/desktop reaches feature parity).

## Why it exists

The original v1 plan for Apohara's visual surface was a terminal renderer.
Two candidates were explored:

1. **Ink + React** — this package. Reuses React idioms in a terminal grid.
   Shipped as a prototype during Phase 3 hardening.
2. **Ratatui (Rust)** — cancelled 2026-05-11 before any code landed.

The 2026-05-11 Roadmap v2.0 pivot replaced both with **Tauri v2 + React 19
desktop** (the M017 milestone) — a real GUI window, not a terminal app.
Visual identity (Geist + cyan/violet), full DAG canvas via `@xyflow/react`,
Monaco diff editor, SSE-tailed event ledger — all live in
[`../desktop`](../desktop/).

## When to look at this code

- You're debugging a `apohara dashboard` invocation (the CLI subcommand
  still spawns `bun run cli.tsx` via `getTuiPath()` in
  `src/commands/dashboard.ts`).
- You're migrating a hook from here to `packages/desktop/src/hooks/`
  (M017.9 ongoing — see [`../desktop/src/hooks/`](../desktop/src/hooks/)).
- You're verifying the v0.1 demo doesn't regress while M017.10 lands.

## When NOT to look here

- For *anything* user-facing — UI work goes in `packages/desktop/`.
- For new features — they go in `packages/desktop/`.
- For visual identity (Geist, cyan/violet accents) — that lives in
  `packages/desktop/src/index.css`.

## How to run

```sh
cd packages/tui
bun run dev          # launches the Ink TUI directly
```

…but you almost certainly want `bun run --filter @apohara/desktop dev`
from the repo root instead — that boots the real visual orchestrator on
`http://localhost:7331`.

## Removal plan

This directory is queued for deletion once two boxes are checked:

- [ ] M017.10 — Playwright E2E in `packages/desktop/` covers the same
      surface the dashboard command exercises today.
- [ ] `src/commands/dashboard.ts` updated to spawn the desktop dev
      server (or open the packaged binary) instead of loading `cli.tsx`.

Tracked in `ROADMAP.md` under M017.9. Until both are done, leave this
package in place — `apohara dashboard` is a real user-facing entry point
and yanking it would regress the CLI.
