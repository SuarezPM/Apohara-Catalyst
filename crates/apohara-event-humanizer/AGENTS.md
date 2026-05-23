# apohara-event-humanizer — Agent Guide

Turns raw provider events (Claude / Codex / OpenCode stream lines) into
human-readable labels that the desktop dashboard can render without
re-interpreting every wire format. Acts as a "label rules" engine: input is
an opaque event payload, output is a one-line summary the UI's status bar
or log feed can show as-is.

## When to use

- The desktop is about to render a ledger event and you want a friendly
  label (`"Claude is reading src/lib.rs"`) instead of the raw JSON.
- A hook event needs to surface in the TUI as a single line.

## Pattern

```rust
use apohara_event_humanizer::{humanize, EventInput};

let label = humanize(&EventInput {
    provider: "claude-code-cli",
    event_type: "tool_use",
    payload: &json!({ "name": "Read", "input": { "file_path": "/tmp/a.rs" } }),
});
// → "Claude is reading /tmp/a.rs"
```

## Anti-patterns

- Do NOT embed business logic here. The humanizer is a *projection*; if you
  find yourself adding a rule like "if X then dispatch Y", that belongs in
  the orchestrator, not in the label engine.
- Do NOT localize here. Label keys are stable strings; the UI does i18n via
  its own dictionary keyed off the label id.

## Testing

`cargo test -p apohara-event-humanizer --lib` — snapshot tests pinning each
rule's output to a fixture string.
