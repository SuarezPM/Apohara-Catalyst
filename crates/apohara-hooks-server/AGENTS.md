# apohara-hooks-server

Per spec §3.5 — axum sidecar that receives CLI agent hook events
(PreToolUse / PostToolUse / Stop / UserPromptSubmit / PermissionRequest)
via HTTP loopback (127.0.0.1 only). Bearer token auth with constant-time
comparison. JSON normalization. Forwards to orchestration DB.

## Responsibility

Receive raw hook payloads from native CLI agents (claude-code, codex,
opencode), normalize them to ApoharaEvent JSONL, and:
- Persist to orchestration DB (Stage 2.2+)
- Broadcast to tokio channel (Stage 2.2+)
- Audit-log per §0.4 (apohara-audit integration in Stage 2.2)

## Security model

- 127.0.0.1-only bind (configurable via ServerConfig::bind_addr; never wildcard)
- Bearer token auth, constant-time comparison (mitigates timing oracles)
- Token rotation hook in Stage 2.3
- All requests logged via tracing (no token in logs)

## Public API

- `ServerConfig { bearer_token, bind_addr }` — construction config
- `HooksServer::start(Arc<ServerConfig>) -> Result<Self, HooksError>` — bind + spawn
- `HooksServer::bound_addr() -> SocketAddr` — useful when binding to :0
- `HooksServer::shutdown(self)` — graceful via oneshot

## Routes

All routes sit behind the bearer-auth middleware (`Authorization: Bearer <token>`).
Missing or wrong token → `401 Unauthorized`.

| Method | Path     | Auth   | Body                                | Success                                  |
|--------|----------|--------|-------------------------------------|------------------------------------------|
| GET    | `/health`| Bearer | —                                   | `200 { "alive": true, "ts": <rfc3339> }` |
| POST   | `/event` | Bearer | `HookEventEnvelope` (JSON, see below)| `200 { "accepted": true }`              |

`HookEventEnvelope` (see `src/event.rs`):

```json
{
  "type": "pre_tool_use | post_tool_use | post_tool_use_failure | stop | user_prompt_submit | permission_request",
  "pane_key": "pane-1",
  "task_id": "task-42 | null",
  "worktree_id": "swift-falcon-a3f9c2 | null",
  "payload": { /* shape per event type — see HookEventPayload variants */ }
}
```

Validation: the discriminator is re-folded into `payload` and deserialized as
the tagged `HookEventPayload` enum. Unknown `type` or malformed payload →
`422 Unprocessable Entity`.

Stage 2.3 will forward accepted events to the orchestration DB + a tokio
broadcast channel; today the handler only validates and `tracing::info!`s.

## Tests

`cargo test -p apohara-hooks-server --test auth` — 2 tests (unauthorized rejection + port-0 binding).
`cargo test -p apohara-hooks-server --test event` — 2 tests (valid pre_tool_use accepted + unknown type → 422).

## What this crate is NOT

- Not the orchestration DB (that's `src/core/orchestration/db.ts`)
- Not the CLI surface (that's `src/cli/orchestration.ts`)
- Not the hook installer (that's `src/core/hooks/installer.ts`)
- Not the event normalizer dispatcher (that's `src/core/hooks/events.ts`)

## Anti-patterns

- Never bind to `0.0.0.0` — bearer auth alone is insufficient defense
- Never log tokens (no `tracing::info!("auth: {}", token)`)
- Never use `==` for token comparison — must use constant-time helper
