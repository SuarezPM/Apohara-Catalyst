# PTY embedding — 2026-05-22-pty-embedding

**Status:** verified
**Author:** Pablo (via Opus 4.7)
**Created:** 2026-05-22

## Why

Apohara dispatches CLI agents headlessly via `callCliDriver`. The user sees a final string when the agent finishes but nothing in between — no tool calls, no progress, no diagnostics. For long-running multi-turn agents that's actually unusable: the kanban shows "Dispatched" → "Done" with no visibility into what happened. Every competitor (Orca, Nimbalyst) embeds a PTY so the user sees the agent's terminal exactly as if they'd run it themselves.

## What

A PTY-embedded terminal in the desktop UI:
1. Backend spawns CLI agents in real PTYs (`node-pty`), with a rolling replay buffer per session.
2. SSE streams PTY output (base64-encoded) to the UI.
3. xterm.js renders each PTY in a dedicated `TerminalPane`.
4. A `Terminal` tab in `ViewToggle` lists active PTYs and lets users spawn ad-hoc `bash` for hacking.

## What this is NOT

- NOT a full IDE terminal multiplexer (no tab reorder, no split-pane, no scrollback search).
- NOT a replacement for the headless dispatch path — both flows coexist.
- NOT a PTY-per-task UX yet (TaskBoard ↔ PTY correlation lands in Stage 8).

## Affects (capabilities)

- `capabilities/dispatch` — gains a "live PTY mirror" option alongside headless.
- `capabilities/ui-view-modes` — adds a third `terminal` view.

## Open questions

- Resolved: should the PTY share state with the headless `callCliDriver` invocation? **No** for v1 — they're parallel paths. Stage 8 unifies them.
- Resolved: WebSocket vs SSE for output stream? **SSE** — simpler, leverages existing infra, replay-on-attach is trivial.
