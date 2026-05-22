# Tasks — 2026-05-22-pty-embedding

## Implementation
- [x] T-1 Add `src/core/pty/registry.ts` with spawnPty / writePty / resizePty / killPty / onPtyData / onPtyExit / getReplay / listPtys.
- [x] T-2 Wire `POST /api/pty`, `GET /api/pty`, `GET /api/pty/:id/stream` (SSE base64), `POST /api/pty/:id/input`, `POST /api/pty/:id/resize`, `DELETE /api/pty/:id`.
- [x] T-3 Add `packages/desktop/src/components/TerminalPane.tsx` (xterm.js + FitAddon + ResizeObserver).
- [x] T-4 Add `packages/desktop/src/components/TerminalView.tsx` with PTY list + spawn-bash button.
- [x] T-5 Extend `ViewMode` + `ViewToggle` with `terminal`. Render `TerminalView` from `App.tsx`.

## Tests
- [x] T-test-1 Unit tests for `src/core/pty/registry.ts` covering spawn / data / exit / kill / writePty-after-close / unknown-id.
- [x] T-test-2 Live smoke: `POST /api/pty` returns handle, `GET /api/pty` lists it, exit recorded.

## Docs / observability
- [x] T-doc-1 Add `bash -c` quirk to CLAUDE.md "Past incidents" so future PTY tests don't hit the same flake.
- [ ] T-doc-2 Add a per-PTY tab title with sessionId/taskId correlation once Stage 8 wires PTY to dispatch.

## Verification
- [x] Live POST `/api/pty` smoke (verified `075aa77`).
- [x] 480 bun tests green.
- [x] tsc clean.
- [ ] End-to-end UI click on `+ bash` (blocked by the existing footer overlay layout issue — separate concern).
