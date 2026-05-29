> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

# Audit: symphony (15 hallazgos)

> Audit ejecutado 2026-05-22 sobre `feat/apohara-v1` HEAD (`d9372eb`).
> Source: `docs/reference-mining/symphony.md`.
> Plan de referencia: `docs/superpowers/plans/2026-05-22-reference-mining-sprints.md`.

## Resumen

| Status | Cantidad |
|---|---:|
| COMPLETO | 3 |
| PARCIAL | 7 |
| NO IMPLEMENTADO | 4 |
| RECHAZADO | 0 |
| AMBIGUO | 1 |
| **Total** | **15** |

*Nota:* el ítem "SSH worker extension" (#13) aparece como "v1.1+" en el plan
maestro, pero el usuario lo promovió a Apohara Ultimate y se evalúa
normalmente (NO RECHAZADO).

---

## Hallazgos

### Hallazgo 1: RFC 2119 + Validation Profiles en SPEC

- **Origen symphony**: `_reference/symphony/SPEC.md:9-14, 1916-2107`
- **Apohara actual**: `src/core/spec/planDocuments.ts`, `src/core/decomposer/*`, `docs/superpowers/specs/2026-05-21-apohara-v1-design.md §6`
- **Status**: NO IMPLEMENTADO
- **Evidencia**: el spec v1.0 lista el patrón en la tabla §11 (línea 3287: "symphony #1 | RFC 2119 + Validation Profiles | §6 (SPEC.md schema)"), pero §6.1 define `PlanDocument` SIN campos `normative.language` ni `profile` por criterion. `grep -rn "rfc.2119\|core.*conformance" src/ crates/` no devuelve nada. El parser de `acceptanceCriteria` (`src/core/spec/planDocuments.ts`) es plano: ChecklistItem sin nivel de conformance.
- **Gap**: schema YAML no expone `profile: core | extension | integration`; verification-mesh no recibe el profile como threshold modifier.
- **Recomendación**: extender `PlanDocument.acceptanceCriteria[].profile` + propagar al JCR gate. Riesgo bajo (schema-additive), valor medio.

---

### Hallazgo 2: WORKFLOW.md hot-reload con last-known-good fallback

- **Origen symphony**: `_reference/symphony/SPEC.md:289-345, 522-541`; `elixir/lib/symphony_elixir/workflow_store.ex`
- **Apohara actual**: `src/core/spec/watcher.ts` (29 LOC con chokidar)
- **Status**: PARCIAL
- **Evidencia**: `watcher.ts:11-50` usa `chokidar.watch` y emite `apohara://plan-changed` al `listenerRegistry`. Pero NO existe `LastKnownGoodSpec` cache, NO se distinguen `fields_changed`, y NO hay reload-failure-recovery con preservación del cache previo. `grep -rn "LastKnownGood\|workflow_watcher\|hot.reload"` devuelve cero matches. El spec v1.0 §0.26 (línea 219-223) prescribe `apohara-workflow-watcher` crate con `notify` (no chokidar) — ese crate no existe en `crates/`.
- **Gap**: no hay (a) crate Rust `apohara-workflow-watcher`, (b) `LastKnownGoodSpec` cache, (c) distinción live-reloadable vs restart-required, (d) emit de `WorkflowReloaded { fields_changed: [...] }`.
- **Recomendación**: el patrón actual es file-change → invalidate-cache → re-parse on demand. Suficiente para "edita plan, ve cambios" pero NO sobrevive parse failures. Crear crate o migrar a `notify` para FS events robustos.

---

### Hallazgo 3: Tres state machines separadas (claim / phase / external)

- **Origen symphony**: `SPEC.md:598-694, 1865-1913`; `elixir/lib/symphony_elixir/orchestrator.ex:200-244`
- **Apohara actual**: `src/core/dispatch/state.ts`, `src/core/orchestration/tasks.ts`, `src/core/orchestration/migrations/001_initial.sql`
- **Status**: PARCIAL
- **Evidencia**:
  - **RunState** (claim states) está definido en `state.ts:19-24` con los 5 estados exactos (`unclaimed | claimed | running | retry_queued | released`) per symphony §7.1.
  - **RunPhase** (lifecycle phases) está definido en `state.ts:26-37` con las 11 fases exactas (`preparing_workspace ... canceled_by_reconciliation`).
  - El dispatcher emite phase events al SSE stream (commits `9e58d80` + `92e9ac9`).
  - PERO: no existen las tablas `orchestrator_claims` + `run_attempts` que el spec v1.0 §3.7 prescribe (líneas 1206-1228). El schema actual en `tasks.ts:6` solo tiene `TaskStatus = 'pending'|'ready'|'dispatched'|'completed'|'failed'|'blocked'` — claim state y phase state están conflados en el campo único `status`.
  - `claim_token` (UUID for race-free release) NO existe; `tryClaimTask` en `tasks.ts:73-93` usa conditional UPDATE WHERE status (suficiente para race pero no respeta el contrato symphony de claim_token).
  - **success != done** (continuation retry pattern): NO implementado. `dispatcher.ts:18` lo menciona en un comentario "(continuation pattern from symphony §10.3)" pero el `FollowUpAction` (`executor-action.ts:48-56`) está explícitamente "reserved for the Stage 8 continuation-turn ... hookups" — el dispatcher chain walker (`dispatcher.ts:148-268`) NO programa retries post-success.
- **Gap**: las 3 SMs son vocabulario público pero NO están separadas en almacenamiento; el patrón "success ≠ done" no existe.
- **Recomendación**: agregar migration `002_orchestrator_claims_and_run_attempts.sql` con las tablas separadas para llegar al contrato simfónico completo. Alta prioridad — afecta correctness del scheduler.

---

### Hallazgo 4: Continuation vs Failure retry semánticos

- **Origen symphony**: `SPEC.md:626-637, 751-760, 1230-1237`; `elixir/lib/symphony_elixir/orchestrator.ex:13-15, 1172-1183`
- **Apohara actual**: `src/core/dispatch/dispatcher.ts`, `src/core/dispatch/executor-action.ts`
- **Status**: NO IMPLEMENTADO
- **Evidencia**: `grep -rn "RetryReason\|continuation_retry\|delay_type" src/ crates/` solo devuelve dos referencias en COMENTARIOS (`dispatcher.ts:18`, `executor-action.ts:12`). No existe `enum RetryReason { Continuation, TransientFailure, StallDetected, ProviderError }`. No existe `next_retry_delay()`. La spec v1.0 §3.8 (líneas 1232-1261) lo prescribe pero apunta al crate inexistente `crates/apohara-scheduler/`. El plan maestro lo lista en T3.9 como NO ejecutado (línea 194 de sprints.md).
- **Gap**: ningún código de retry diferencia continuación vs falla; no hay fixed-1s vs exponential-cap-5min; el chain walker rompe en cualquier non-completed (`dispatcher.ts:238-242`).
- **Recomendación**: implementar antes que reconciliation pass de "blocked" — el continuation pattern es el throughput multiplier más grande. T3.9 en pendientes.

---

### Hallazgo 5: Tres reconciliation passes por tick

- **Origen symphony**: `elixir/lib/symphony_elixir/orchestrator.ex:300-505, 557-614`; `SPEC.md:779-808`
- **Apohara actual**: `src/core/dispatch/reconciler.ts` (134 LOC); `src/core/orchestration/drift-probe.ts`
- **Status**: PARCIAL
- **Evidencia**:
  - **Pass A (Stall detection)**: implementado. `reconciler.ts:47-134` calcula `elapsed = now - instruction.createdAt` y emite synthetic `task_failed` con `error: "stalled..."`. Commit `9e58d80`.
  - **Pass B (Tracker state refresh)**: NO implementado. `grep -rn "tracker_state\|external_state\|github_state"` devuelve cero. `packages/github-bridge/src/poller.ts` existe pero corre como cron independiente (cada 60s), NO inline con el reconciliation tick. No hay kill-worker-on-external-cancellation.
  - **Pass C (Missing-issue cleanup)**: NO implementado.
  - **Pass D (Drift detection)** ya está en el spec §3.10 (línea 1305) pero `drift-probe.ts:31-` solo compara git commits behind base ref — NO compara symbols modificados vs `TaskSymbolManifest`. Parcial.
  - **Pass E (Blocked reconciliation)**: NO implementado (ver Hallazgo 10).
- **Gap**: 4 de 5 passes ausentes; el reconciler actual solo cubre stalls del worker propio, no la "drift detection real con mundo externo".
- **Recomendación**: extender `reconciler.ts` a un orquestador de passes pluggable A→E. Acoplar el poller GitHub al tick en vez de cron separado. Alto valor — diferencia clave de symphony.

---

### Hallazgo 6: PathSafety con symlink-escape detection

- **Origen symphony**: `SPEC.md:886-905, 1618-1629`; `elixir/lib/symphony_elixir/path_safety.ex`
- **Apohara actual**: `crates/apohara-pathsafety/src/lib.rs` (78 LOC)
- **Status**: PARCIAL
- **Evidencia**: la crate existe y define el `enum PathSafetyError` exacto del spec (`EscapesRoot | SymlinkEscape | InvalidCharsInIdentifier | EqualToRoot`) — ver `lib.rs:16-31`. `validate_cwd` (`lib.rs:41-63`) distingue symlink-escape vs literal-outside via `workspace.starts_with(workspace_root)` check, exactamente per spec §3.11. `safe_identifier` (`lib.rs:67-77`) implementa la sanitización `[A-Za-z0-9._-]` → `_`. PERO `canonicalize_recursive` (`lib.rs:35-37`) NO recorre segment-by-segment (sólo delega a `std::fs::canonicalize`) — el `_max_depth: u32` está sin usar, el spec menciona "lstat + readlink loop con detección de cycle / max depth" (`lib.rs:34` comment es honesto sobre eso).
- **Gap**: el algoritmo "segment-by-segment con depth limit" del Elixir prod-grade NO está; solo el wrapper API.
- **Recomendación**: cierre rápido — re-implementar `canonicalize_recursive` con loop manual `lstat + readlink + push`. Valor alto: la versión actual no detecta cycles de symlink ni profundidad maliciosa.

---

### Hallazgo 7: Workspace hooks 4-phase lifecycle

- **Origen symphony**: `SPEC.md:385-406, 861-905`; `elixir/lib/symphony_elixir/workspace.ex:165-356`
- **Apohara actual**: `crates/apohara-hooks-server/`, `src/core/hooks/`, `src/core/providers/agent-config.ts`
- **Status**: PARCIAL
- **Evidencia**:
  - El spec v1.0 §0.28 (líneas 231-241) prescribe el patrón exacto (4 hooks, fatal vs best-effort, timeout 60s, output truncado 2048 bytes).
  - Pero el código actual implementa "agent hooks" (PreToolUse/PostToolUse/Stop, ver `agent-config.ts:36-83` con `hookScriptName: apohara-{claude|codex|opencode}-hook`), no "workspace lifecycle hooks". `grep -rn "after_create\|before_run\|after_run\|before_remove" src/ crates/` devuelve cero en código (sólo en docs spec).
  - El `apohara-hooks-server` axum sidecar es un HTTP loopback para recibir eventos DEL CLI, no para ejecutar scripts shell pre/post-workspace.
- **Gap**: missing entirely el ciclo "workspace creation → before_run → agent → after_run → before_remove". El "agent hooks" cubre otra cosa (CLI tool events) y no provee la extensibilidad simfónica que descansa sobre `sh -lc <script>` con timeout.
- **Recomendación**: crate nuevo `apohara-workspace-hooks` o sub-módulo en `apohara-worktree` que invoque scripts via `Command::spawn` con timeout + 2048-byte truncation + diferenciación fatal vs best-effort.

---

### Hallazgo 8: Line-framed JSON-RPC con tolerancia non-JSON

- **Origen symphony**: `elixir/lib/symphony_elixir/codex/app_server.ex:9-14, 340-440, 922-980`; `SPEC.md:906-1015`
- **Apohara actual**: `src/core/providers/protocols/{ClaudeCodeProtocol,CodexProtocol,OpenCodeProtocol}.ts`, `src/core/providers/BaseAgentProvider.ts`, `src/core/providers/streams/persistentStdin.ts`
- **Status**: PARCIAL
- **Evidencia**:
  - El spec v1.0 (línea 3294) referencia "Line-framed JSON-RPC con tolerancia non-JSON | §4.5 (BaseAgentProvider transport)". Pero en `CodexProtocol.ts:7-21` y `OpenCodeProtocol.ts:7-21` ambos son stubs ("Stage 3 scaffold; Stage 4+ replaces with the real ... integration") que retornan `complete:finished` inmediatamente.
  - `persistentStdin.ts` (existe pero acotado a stdin lifetime, no a frame parsing).
  - El parsing real ocurre en `src/providers/cli-driver.ts` (legacy) — `grep -rn "NDJSON\|Frame::Json\|Frame::NonJson" src/ crates/` devuelve cero matches en producción.
  - El commit `5a52031` ("opencode NDJSON streaming") implementa "format json" line-by-line PERO sin la dicotomía `Frame::Json vs Frame::NonJson` (heurística regex para stderr leaks no existe).
- **Gap**: no hay transporte unificado `LineFramedTransport` con `pending_line` buffer y tolerancia a líneas non-JSON con severity heuristic.
- **Recomendación**: implementar en el refactor BaseAgentProvider que aún tiene los Protocols como scaffolds. Alta prioridad — robustez contra warnings stderr de los CLIs.

---

### Hallazgo 9: Dynamic tools + approval auto-resolution + heuristic for input

- **Origen symphony**: `elixir/lib/symphony_elixir/codex/dynamic_tool.ex`, `app_server.ex:454-921`; `SPEC.md:1038-1095`
- **Apohara actual**: `src/core/safety/`, `src/core/providers/protocols/AgentProtocol.ts`, `crates/apohara-mcp-bridge/`
- **Status**: NO IMPLEMENTADO
- **Evidencia**:
  - `AgentProtocol.ts:33-41` define `ProtocolEvent` con variante `permission_request` (línea 40) — solo declara la forma del evento, no la auto-resolución.
  - El spec v1.0 (línea 3295) lo asocia a §4.6, pero §4.6 (líneas 1913-1973) define un sistema de "permission patterns" estilo Claude (`Bash(npm test:*)`, scope `once/session/always`, settings hierarchy 3-tier) — útil para tools Apohara conocidos pero NO cubre la heurística simfónica de "buscar labels 'Approve*'/'Allow*' en `requestUserInput.options[]` y auto-responder canned message si no hay match".
  - No existe `approval_policy` en frontmatter SPEC.md.
  - No existe `try_resolve_approval_request(request) -> ResolvedAction` helper.
  - No existe `ClientSideToolBridge` para advertise tools en `thread/start` payload (los MCP servers internos sí, pero usan MCP transport stdio, no la inline dynamicTools del simfonía).
- **Gap**: feature entera ausente. Apohara puede colgarse si el CLI dispara un prompt interactivo.
- **Recomendación**: crítico para correr unattended. Implementar `tryResolveApproval()` con la misma heurística labels + canned-response. Alto riesgo si se omite.

---

### Hallazgo 10: "Blocked" como primary state distinto de "Retrying"

- **Origen symphony**: `elixir/lib/symphony_elixir/orchestrator.ex:24-44, 200-244, 325-451, 722-749`
- **Apohara actual**: `src/core/orchestration/tasks.ts`, `migrations/001_initial.sql`, `src/core/orchestration/decision-gates.ts`
- **Status**: PARCIAL
- **Evidencia**:
  - `TaskStatus` en `tasks.ts:6` incluye `'blocked'`; SQL CHECK en `001_initial.sql:33` también. Y `listReadyTasks` (`tasks.ts:96-101`) explícitamente excluye tareas con `decision_gates.status = 'open'`. Esto da un "blocked-by-gate" semánticamente similar a symphony.
  - PERO: el `BlockedReason` enumerado (`ApprovalRequired | UserInputRequired | McpElicitation | StalledAfterInputRequest | ProviderRejected`) NO existe. `grep -rn "BlockedReason\|blocked.*reason" src/ crates/` devuelve cero.
  - No hay `reconcile_blocked_issues` pass dedicado.
  - El criterion N-11 del spec (línea 307: "Blocked como primary state distinto de Retrying en orchestration DB; TaskBoard kanban suma columna dedicada Blocked / Needs Operator; reconciliation pass dedicado") NO se cumple: la columna "Blocked / Needs Operator" en `TaskBoard/` no existe (`grep -rn "Blocked.*Operator\|needs.operator" packages/desktop/` devuelve cero).
  - El propio `decision-gates` está bien implementado pero modela "task A bloqueado por overlap con task B", NO "agente pidió aprobación interactiva".
- **Gap**: la primitiva existe en SQL pero los flujos que la usan (approval intercept + UI column + reconcile pass) faltan.
- **Recomendación**: extender la primitive existente — agregar columna `blocked_reason TEXT`, módulo TS para clasificar permission_request events, columna kanban dedicada. Cumple criterio N-11 del v1.0.

---

### Hallazgo 11: Token accounting absolutes > deltas + per-thread keying

- **Origen symphony**: `elixir/docs/token_accounting.md` (305 LOC); `orchestrator.ex:1438-1466, 1581-1585`
- **Apohara actual**: `crates/apohara-token-accounting/src/lib.rs`
- **Status**: NO IMPLEMENTADO
- **Evidencia**: el crate existe pero `lib.rs` es 5 líneas literales: "// apohara-token-accounting — see spec for purpose. Placeholder until Stage 2+ implementations." Su único test (`tests/smoke.rs`) sólo verifica que `version()` retorna un string no vacío. El spec v1.0 §0.14 (línea 139-143) lo lista como discipline pero el crate sigue sin implementar `ThreadTokenLedger`, `TokenSource` enum, `apply()` con high-water mark. `grep -rn "absolute_total\|ThreadTokenLedger" src/ crates/` devuelve cero.
- **Gap**: literal nothing — sólo skeleton package.
- **Recomendación**: dado que es un patrón documentado linea-por-linea en el `token_accounting.md` simfónico (305 LOC), el cost-of-delay es alto y la fricción es baja. Port directo recomendado.

---

### Hallazgo 12: Dashboard fingerprint + throttle + sparkline + event humanizer

- **Origen symphony**: `elixir/lib/symphony_elixir/status_dashboard.ex` (1953 LOC); `elixir/lib/symphony_elixir_web/live/dashboard_live.ex`
- **Apohara actual**: `packages/desktop/src/App.tsx`, `packages/desktop/src/components/useLedgerStream.ts`, `crates/apohara-event-humanizer/`
- **Status**: NO IMPLEMENTADO
- **Evidencia**:
  - `apohara-event-humanizer/src/lib.rs` también es placeholder (4 LOC: "see spec for purpose. Placeholder until Stage 2+ implementations.").
  - `grep -rn "throttle\|sparkline\|fingerprint\|render_interval" packages/desktop/src/ packages/tui/` devuelve cero coincidencias propias (los hits son node_modules typescript/monaco).
  - `useLedgerStream.ts` y `App.tsx` re-renderizan en cada evento SSE sin throttling ni fingerprinting (sólo `useMemo` para `rosterCsv` en `App.tsx:289`).
  - No hay regla `humanize_event` per provider; los eventos se muestran tal cual.
- **Gap**: dashboard performance + UX (humanización) sin trabajar.
- **Recomendación**: el desktop ya funciona pero escalará mal con cientos de eventos. Hook `useThrottledSnapshot` + implementar `apohara-event-humanizer` con dispatch table per-provider. Bajo coste, demo-quality.

---

### Hallazgo 13: SSH worker extension (central orchestrator + remote workers)

- **Origen symphony**: `SPEC.md:2109-2169`; `elixir/lib/symphony_elixir/ssh.ex`; `orchestrator.ex:1217-1277`
- **Apohara actual**: ninguno (búsqueda de `ssh_hosts`, `SshHost`, `remote_worker`, `WorkerLocation` retorna cero).
- **Status**: NO IMPLEMENTADO
- **Evidencia**: el v1.0 spec lo lista en la tabla "diferidos v1.1+" (línea 3124: "SSH worker extension | symphony Appendix A | Multi-machine future"). El plan maestro también lo difiere (sprints.md línea 236). PERO: el usuario (Pablo) promovió este ítem a Apohara Ultimate fuera del scope v1.0. Esa promoción NO se materializó en código todavía: no hay `crates/apohara-remote-worker/`, no hay `WorkerLocation` enum, no hay SSH transport wrapping. `src/lib/git.ts:15,78` menciona "ssh" pero sólo como formato de URL git remote (no relacionado).
- **Gap**: la decisión de Pablo es promover, pero todavía no aterrizó. Es un greenfield completo.
- **Recomendación**: arrancar con un crate scaffold `apohara-remote-worker` con `enum WorkerLocation { Local, Ssh { host, port } }` + un test e2e contra `docker compose` con dos containers SSH (per el patrón `live_e2e_docker` simfónico). Bajo riesgo de adoption porque es opcional.

---

### Hallazgo 14: Self-describing guardrail flag (CLI UX)

- **Origen symphony**: `elixir/lib/symphony_elixir/cli.ex:8-9, 105-144`
- **Apohara actual**: `src/commands/uninstall.ts`, `packages/apohara-shared/types.ts:17`, `crates/apohara-audit/bindings/EventKind.ts:3`
- **Status**: AMBIGUO
- **Evidencia**: el spec v1.0 §0.25 (línea 213-217) prescribe el patrón exacto (flag `--i-understand-that-this-will-be-running-without-the-usual-guardrails`, banner ANSI Unicode box, evento `cli.guardrails_bypassed`). En el código:
  - El **EventKind** `"guardrails_bypassed"` existe en `apohara-shared/types.ts:17` (auto-gen por ts-rs) Y en `crates/apohara-audit/bindings/EventKind.ts:3` — el plumbing del audit event EXISTE.
  - Pero `grep -rn "--i-understand\|guardrails_bypassed" src/ packages/` SOLO devuelve la definición del enum, ningún emit, ninguna CLI option. No hay banner ANSI; no hay flag de runtime.
  - Existe `--yes-always` en `cli-driver.ts:204` (passthrough a `opencode --yes-always`), distinto del patrón.
- **Gap**: el evento está modelado pero nunca se emite porque no hay flag de invocación.
- **Recomendación**: como es UX + audit trail, vale poco esfuerzo (parsear arg en `src/commands/*` o en bun server entrypoint, emit ledger event, ANSI banner). Marcado AMBIGUO porque parte del plumbing ya está hecho.

---

### Hallazgo 15: Tracker adapter pattern (multi-tracker future)

- **Origen symphony**: `elixir/lib/symphony_elixir/tracker.ex`; `linear/adapter.ex`; `tracker/memory.ex`
- **Apohara actual**: `packages/github-bridge/` (poller + issue-parser + pr-builder)
- **Status**: PARCIAL
- **Evidencia**:
  - El spec v1.0 línea 3300 lo mapea a §5, y §5 (líneas 2282-2360) describe `github-bridge` como package con sus métodos: `poller.ts`, `issue-parser.ts`, `pr-builder.ts`. Las funciones existen pero NO detrás de un trait/interface — son funciones imperativas que `octokit-client.ts` consume directamente.
  - `grep -rn "TrackerAdapter\|tracker.kind\|MemoryAdapter" src/ packages/ crates/` devuelve cero.
  - Sin embargo, la estructura modular (poller/parser/PR builder) facilita un trait extraction posterior. La forma "fetch candidate issues → orchestration.taskCreate" está implementada per pattern simfónico, sólo sin el adapter layer.
- **Gap**: no hay `TrackerAdapter` trait/interface; no hay `MemoryAdapter` para tests; el github-bridge está acoplado a octokit directamente.
- **Recomendación**: bajo costo de refactor — definir `interface TrackerAdapter` en TS (o `trait` Rust en un `apohara-tracker` crate nuevo) y mover `octokit-client` a `GithubIssuesAdapter implements TrackerAdapter`. Habilita Jira/Linear adapters sin tocar el coordinator.

---

## Notas metodológicas

- Búsquedas hechas con `grep -rn` sobre `src/`, `crates/`, `packages/` excluyendo `node_modules/`.
- "PARCIAL" se usa cuando hay primitivas pero faltan flujos completos; "NO IMPLEMENTADO" cuando el crate o función o flag está literalmente ausente o stub.
- "AMBIGUO" se reserva para el caso del Hallazgo 14, donde audit-plumbing existe pero el flag de invocación que lo dispara no.
- El item #13 (SSH worker) **NO** se marca como RECHAZADO: aunque está diferido en el plan v1.0, Pablo lo promovió a Apohara Ultimate. Se reporta como NO IMPLEMENTADO con recomendación greenfield.
