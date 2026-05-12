# @apohara/desktop

The Apohara visual orchestrator desktop shell. Tauri v2 native window wrapping a Bun-served React 19 SPA. Single binary target <15 MB.

## Architecture (Roadmap v2.0 M017)

```
┌───────────────────────────────────────────────────────────────────┐
│  apohara-desktop (Tauri v2 native, ~8 MB)                         │
│    ↳ loads localhost:7331 in dev                                  │
│    ↳ bundles ../dist in release                                   │
└───────────────────────────────────────────────────────────────────┘
                ↕  (HTTP / SSE / Tauri IPC)
┌───────────────────────────────────────────────────────────────────┐
│  Bun.serve dev backend (src/server.ts, port 7331)                 │
│    ↳ POST /api/enhance     → decomposer prompt enhancement        │
│    ↳ POST /api/run         → ParallelScheduler.run                │
│    ↳ GET  /api/session/:id/events → SSE tail of .events/run-X.jsonl│
└───────────────────────────────────────────────────────────────────┘
                ↕
┌───────────────────────────────────────────────────────────────────┐
│  Apohara core (../../src/core/) — decomposer, scheduler,          │
│  verification-mesh, ledger Phase 4, consolidator                  │
└───────────────────────────────────────────────────────────────────┘
```

## Layout

Three-column main view (`src/App.tsx`):

| Pane | Role | Width |
|---|---|---|
| Objective (left) | Prompt input, enhance toggle, run/pause/takeover | 320 px |
| Swarm Canvas (center) | DAG of tasks + agent lanes with live progress | flex |
| Code + Diff (right) | File tree, Monaco diff, verification mesh verdicts | 480 px |

Top bar: live cost meter (tokens · USD), session indicator, GPU/Cloud toggle for ContextForge.

## Visual identity

- Dark mode default
- Geist Mono + Geist Sans
- Accent palette: cyan `#6EE7F7` (agent activity) + violet `#A78BFA` (verification mesh)
- Reference: Linear, Vercel, Raycast

## Dev commands

```bash
# Frontend (React SPA on Bun.serve)
bun --filter @apohara/desktop dev

# Native window (Tauri loads localhost:7331)
bun --filter @apohara/desktop tauri:dev

# Single-binary release
bun --filter @apohara/desktop tauri:build
```

## M017 progress (per Roadmap v2.0)

| Sub-task | Status |
|---|---|
| 17.1 Bootstrap Tauri v2 + Bun.serve + React | ✅ scaffolded |
| 17.2 SSE endpoint tailing JSONL ledger | 🟡 historical-only stub, fs.watch pending |
| 17.3 Objective pane | 🟡 stub UI, enhance/run wires placeholder |
| 17.4 Swarm Canvas with @xyflow/react DAG | 🔴 list stub, no graph yet |
| 17.5 Code+Diff with Monaco | 🔴 list stub, no Monaco yet |
| 17.6 Cost meter live in top bar | ✅ basic version |
| 17.7 Visual identity locked | ✅ palette + tokens in index.css |
| 17.8 Tauri build → <15 MB binary | 🔴 system deps required (libwebkit2gtk, libgtk) |
| 17.9 Migrate hooks from packages/tui | 🔴 |
| 17.10 E2E visual test | 🔴 |

## Status notes

- **Dependencies not installed.** `bun install` against this scaffold needs internet + system deps (libwebkit2gtk-4.1, libgtk-3 for Tauri on Linux). The TS-side compiles standalone via `bunx tsc --noEmit`.
- **Bun workspace integration pending.** Root `package.json` needs a `workspaces` field or `bun --filter` won't resolve `@apohara/desktop`. M017.x.
- **Icons placeholder.** `src-tauri/icons/icon.png` needs to be added before bundling. Use the Apohara logo from `assets/` or generate via `cargo tauri icon path/to/source.png`.
