# Design — 2026-05-22-pty-embedding

## Affected modules

- `src/core/pty/registry.ts` — new. Process-side PTY spawn / data fanout / replay buffer / kill.
- `packages/desktop/src/server.ts` — adds `/api/pty` routes (POST, GET, stream SSE, input, resize, DELETE).
- `packages/desktop/src/components/TerminalPane.tsx` — new. xterm.js consumer for one PTY id.
- `packages/desktop/src/components/TerminalView.tsx` — new. List + select + spawn UX.
- `packages/desktop/src/store/viewStore.ts` — `ViewMode` widened to include `"terminal"`.
- `packages/desktop/src/components/ViewToggle.tsx` — third tab.
- `packages/desktop/src/App.tsx` — renders `<TerminalView />` when `viewMode === "terminal"`.

## Data model deltas

None on the orchestration DB. PTY state is process-local (`registry.ts` Map).

New event types on the SSE ledger: none for this change. Output streaming is its own SSE under `/api/pty/:id/stream`.

## Algorithm sketch

```
spawnPty(opts):
  validate cap → if registry.size >= 50, throw.
  id = `pty-${uuid().slice(0,12)}`
  pty = node-pty.spawn(opts.command, opts.args, {name, cols, rows, cwd, env})
  pty.onData(chunk):
    entry.replay.push(chunk)
    trim(entry.replay) until replayBytes <= 100 KiB
    emitter.emit("data", chunk)
  pty.onExit({exitCode}):
    handle.exitCode = exitCode
    emitter.emit("exit", exitCode)
    setTimeout(() => registry.delete(id), 60_000).unref()
  return handle

SSE /api/pty/:id/stream:
  base64-encode the existing replay buffer → `event: replay`
  subscribe to emitter.on("data") → base64 → `data: ...`
  subscribe to emitter.on("exit") → `event: exit\ndata: <code>`
  heartbeat every 15s
  cleanup on req.signal.abort
```

## Tradeoffs considered

- **WebSocket** instead of SSE: rejected for v1 — adds a parallel transport surface, and the input/output asymmetry (output streaming, input as discrete POSTs) is awkward to fit in one WS.
- **One persistent PTY per orchestration session**: rejected — couples PTY lifecycle to session lifecycle and forces the user to discard their terminal whenever a run ends.
- **Ghostty WASM renderer** (Nimbalyst's pick): deferred. xterm.js is the well-trodden React path; Ghostty WASM is faster but heavier to integrate.

## Migration path

No migration needed — PTY routes are net-new, headless dispatch is unchanged. Users opt in by clicking the Terminal tab.
