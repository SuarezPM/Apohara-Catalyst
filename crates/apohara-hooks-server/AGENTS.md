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
- Publish loopback endpoint metadata to `~/.apohara/sockets/hooks-endpoint.json`
  on start, delete on shutdown (Stage 2.3)

## Security model

- 127.0.0.1-only bind (configurable via ServerConfig::bind_addr; never wildcard)
- Bearer token auth, constant-time comparison (mitigates timing oracles)
- Endpoint file is mode 0600, atomically written (NamedTempFile + rename in
  same parent dir; fchmod-style permissions set on the fd before persist —
  no world-readable window). See `src/endpoint_file.rs`.
- Token rotation: `HooksServer::rotate_token` rewrites the endpoint file
  atomically. v1.0 does NOT mutate the in-memory `AuthState` — Stage 2.6
  adds live token rollover (dual-accept window).
- All requests logged via tracing (no token in logs)

## Public API

- `ServerConfig { bearer_token, bind_addr }` — construction config
- `HooksServer::start(Arc<ServerConfig>) -> Result<Self, HooksError>` — bind + spawn + publish endpoint file
- `HooksServer::bound_addr() -> SocketAddr` — useful when binding to :0
- `HooksServer::endpoint_file_path() -> Option<&Path>` — path of published file (None if HOME unset / write failed)
- `HooksServer::rotate_token(&mut self, new_token: String) -> io::Result<()>` — rewrites endpoint file (v1.0)
- `HooksServer::shutdown(self)` — graceful via oneshot + best-effort delete of endpoint file
- `endpoint_file::EndpointDescriptor { port, token, started_at }` — JSON schema written to disk
- `endpoint_file::write_atomic(path, desc)` / `delete_if_exists(path)` / `endpoint_file_path()` — module-level helpers

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

## Endpoint file (`~/.apohara/sockets/hooks-endpoint.json`)

Per spec §3.5 + §0.8:

```json
{
  "port": 49234,
  "token": "<bearer>",
  "started_at": 1737562800
}
```

Hook scripts re-read this on every event POST so they survive server restarts
without needing process-tree env propagation. The write is atomic
(`NamedTempFile::new_in(parent) → fchmod 0o600 → persist(path)`), so a hook
script reading concurrently always sees either the old or new file in full —
never a partial write.

On `HooksServer::shutdown` the file is best-effort deleted; absence is not
an error and shutdown still completes even if the file system is read-only.

## Tests

`cargo test -p apohara-hooks-server --test auth` — 2 tests (unauthorized rejection + port-0 binding).
`cargo test -p apohara-hooks-server --test event` — 2 tests (valid pre_tool_use accepted + unknown type → 422).
`cargo test -p apohara-hooks-server --test endpoint_file` — 4 tests (0600 perms, atomic replace, idempotent delete, server-integration writes + deletes).

## What this crate is NOT

- Not the orchestration DB (that's `src/core/orchestration/db.ts`)
- Not the CLI surface (that's `src/cli/orchestration.ts`)
- Not the hook installer (that's `src/core/hooks/installer.ts`)
- Not the event normalizer dispatcher (that's `src/core/hooks/events.ts`)

## Anti-patterns

- Never bind to `0.0.0.0` — bearer auth alone is insufficient defense
- Never log tokens (no `tracing::info!("auth: {}", token)`)
- Never use `==` for token comparison — must use constant-time helper
