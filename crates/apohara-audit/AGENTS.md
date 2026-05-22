# apohara-audit — Agent Guide

JSONL audit sink with async queue + daily rotation + fchmod 0600.

## Pattern

```rust
let sink = AuditSink::new("~/.apohara/audit", "apohara-prod").await?;
sink.write(AuditEvent {
    ts: SystemTime::now(),
    server: "apohara.runs".into(),
    kind: EventKind::McpToolInvoked,
    actor: Some("agent:claude:task-42".into()),
    target: Some("list_runs".into()),
    payload: serde_json::json!({ "limit": 10 }),
}).await?;
```

## Schema

`{ ts, server, kind, actor, target, payload }` — flat, JSONL appendable, SIEM-friendly.

## Critical

- **fchmod 0600** on the file descriptor (open + fd-based chmod, no race window)
- **Queue-bounded** at 1024 events; overflow drops (NEVER blocks event loop)
- **Daily UTC rotation** + **size-based rotation** at 64 MiB
- **No PII** in payload — sanitize at the call site
