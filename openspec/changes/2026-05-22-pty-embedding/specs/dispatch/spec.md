# capabilities/dispatch

## ADDED Requirements

### Requirement: Embedded PTY mirror

The dispatch layer MUST support spawning a CLI agent inside a node-pty
PTY so its real-time terminal output reaches the UI in addition to
landing as a final string in the result file.

#### Scenario: WHEN POST /api/pty is called with {command, args} THEN a PTY is registered

- Returns 200 with `{id, pid, command, args, cols, rows, startedAt}`.
- The new PTY shows up in `GET /api/pty`.
- The `cols`/`rows` default to 120/30 when omitted.

#### Scenario: WHEN the PTY emits stdout THEN GET /api/pty/:id/stream broadcasts it

- The SSE stream begins with `event: replay` carrying the
  base64-encoded scrollback (≤ 100 KiB).
- Each subsequent chunk arrives as `data: <base64>` within ~1 s.
- Heartbeats `: heartbeat <ts>` arrive every 15 s.

#### Scenario: WHEN the child exits THEN the SSE stream emits a final exit event

- The handler emits `event: exit\ndata: <code>` and closes the
  controller.
- The registry keeps the entry for 60 s post-exit so a re-attaching
  UI sees the final state.

#### Scenario: WHEN 50 PTYs already exist THEN spawnPty refuses the 51st

- `POST /api/pty` returns 500 with body containing
  "pty registry full".
- No new entry is created.

### Requirement: Replay buffer cap

The PTY's per-session replay buffer MUST be bounded.

#### Scenario: WHEN the child writes more than 100 KiB THEN the oldest data is dropped

- `replayBytes` never exceeds 100 KiB.
- Subscribers attaching late see the most recent 100 KiB only.
