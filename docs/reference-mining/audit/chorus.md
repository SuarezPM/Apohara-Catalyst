# Audit: chorus (19 hallazgos)

> Audit ejecutado 2026-05-22 sobre `feat/apohara-v1` HEAD.
> Cruza cada hallazgo de `docs/reference-mining/chorus.md` contra el código real.

## Resumen

| Status | Cantidad |
|---|---:|
| COMPLETO | 2 |
| PARCIAL | 5 |
| NO IMPLEMENTADO | 9 |
| RECHAZADO | 2 |
| AMBIGUO | 1 |
| **Total** | **19** |

## Hallazgos

### Hallazgo 1: Presence inferida automáticamente desde tool-calls
- **Origen chorus**: `_reference/chorus/src/mcp/tools/presence.ts:180-202`, `docs/PRESENCE_DESIGN.md:46-99`.
- **Apohara actual**: `crates/apohara-hooks-server/src/event.rs` recibe PreToolUse/PostToolUse pero NO emite `PresenceEvent`. No hay wrapper de `registerTool` que clasifique view/mutate.
- **Status**: NO IMPLEMENTADO.
- **Evidencia**: `crates/apohara-hooks-server/src/event.rs:100`: `// TODO Stage 2.3: forward to broadcast channel + orchestration DB.` — el handler solo valida y hace `tracing::info!`. No hay PresenceEvent. `crates/apohara-attention/src/lib.rs` implementa attention bands (HOT/WARM/COOL/IDLE) pero es un mecanismo distinto: tracks attention en el coordinator, no presence del agente sobre recursos.
- **Recomendación**: agregar middleware en `crates/apohara-hooks-server/src/event.rs::handle_event` que clasifique `tool_name` (`get_*` → view, otros → mutate), extraiga UUIDs/paths del payload, y emita `presence_inferred` event al ledger.

### Hallazgo 2: Throttle de 2 capas (server 2s + cliente 3s) con auto-eviction
- **Origen chorus**: `_reference/chorus/src/lib/event-bus.ts:107-138`, `src/hooks/use-presence.ts:44-92`.
- **Apohara actual**: Sin throttle de eventos del hooks-server al ledger. `src/core/spec/watcher.ts:18-27` tiene `debounceMs: 100` pero es para SPEC file watching, no para hooks bursts.
- **Status**: NO IMPLEMENTADO.
- **Evidencia**: `grep -rn "throttle"` solo devuelve `src/core/spec/watcher.ts:27` (debounce 100ms en chokidar) y `src/core/worktree-manager.ts:7` (mención en comentario de "throttle parallel agent dispatch", no de eventos). No hay DashMap throttle keyed por (agent, entity) ni eviction timer 30s.
- **Recomendación**: implementar `dashmap::DashMap<(AgentId, EntityId), Instant>` en `apohara-hooks-server` con ventana 2s y eviction 30s `tokio::task`. Lado TS desktop usa `setTimeout` con `.unref()` para anti-burst de SSE.

### Hallazgo 3: PixelCanvas — visualización lúdica de hasta N agentes activos
- **Origen chorus**: `_reference/chorus/src/components/pixel-canvas.tsx:30-95`, `src/services/session.service.ts:407-505`.
- **Apohara actual**: `packages/desktop/src/components/SwarmCanvas.tsx` usa `@xyflow/react` para DAG visualization (nodes + edges con `task_scheduled/completed/failed` states). NO es pixel-art ni sprite-based.
- **Status**: NO IMPLEMENTADO (lo que existe — SwarmCanvas — es DAG funcional, no la versión lúdica con sprites).
- **Evidencia**: `packages/desktop/src/components/SwarmCanvas.tsx:1-95`: render via ReactFlow con nodes/edges, sin canvas + sprite. No hay assets en `src-tauri/icons/agents/`.
- **Recomendación**: dejar v1.1+. SwarmCanvas cubre lo funcional; un widget pixel-art es polish/marketing.

### Hallazgo 4: Dual-path acceptance criteria (dev self-check + admin verify)
- **Origen chorus**: `_reference/chorus/prisma/schema.prisma:242-266`, `src/services/task.service.ts:142-168` (`computeAcceptanceStatus`).
- **Apohara actual**: `src/core/spec/planDocuments.ts:52` define `acceptanceCriteria: ChecklistItem[]` con UN solo status (`checked: boolean`). NO hay campos paralelos dev*/verify*.
- **Status**: NO IMPLEMENTADO.
- **Evidencia**: `src/core/spec/planDocuments.ts:30-32`: `ChecklistItem { checked: boolean; text: string; }` — modelo plano. El plan T3.11 ("Acceptance Criteria dual-status") quedó en el catálogo Tier 3 SIN ejecutar (línea 196 del plan: "PROPUESTAS pero no entraron en Sprints 1-3").
- **Recomendación**: ejecutar T3.11. Agregar tabla `acceptance_criterion` en orchestration DB con `claim_*` (judge) y `verify_*` (critic) parallel fields + computed `verify_status` reducer.

### Hallazgo 5: Adversarial review sub-agent con system reminders críticos + max turns
- **Origen chorus**: `_reference/chorus/public/chorus-plugin/agents/task-reviewer.md:1-158` (líneas 12-21, 119-123).
- **Apohara actual**: `src/core/verification-mesh.ts` ejecuta 2 agentes paralelos (A + B) con arbiter para verification, PERO no inyecta system reminders críticos enumerando rationalizations al critic. El spec describe el prompt esperado en `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:1672-1709` pero el archivo `src/core/verification-mesh/prompts/critic.ts` NO existe.
- **Status**: NO IMPLEMENTADO (spec'd, sin código).
- **Evidencia**: `find ... -name "*critic*"` no devuelve nada en `src/`. `grep -rn "CRITICAL_SYSTEM_REMINDER" src/` no devuelve nada. Solo aparece en `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:1678` como bloque de TS pendiente.
- **Recomendación**: crear `src/core/verification-mesh/prompts/critic.ts` exportando `CRITICAL_SYSTEM_REMINDER` (el bloque del spec §4.5.2) e inyectarlo en `VerificationMesh.runAgentB` como `systemMessages` antes del task prompt.

### Hallazgo 6: Hallucination flag explícito en reviewers
- **Origen chorus**: `_reference/chorus/public/chorus-plugin/agents/proposal-reviewer.md:58`, `task-reviewer.md:90`.
- **Apohara actual**: No hay categoría taxonómica `HALLUCINATION_RISK` en el verification-mesh ni en quality gates.
- **Status**: NO IMPLEMENTADO.
- **Evidencia**: `grep -rn "HALLUCINATION_RISK\|hallucination" src/` retorna 0. Solo `docs/superpowers/specs/...:1699` menciona la categoría como deseable. `src/core/verification/qualityGates/types.ts:1` enumera roles pero NO finding categories.
- **Recomendación**: agregar `type FindingSeverity = "NOTE" | "HALLUCINATION_RISK" | "BLOCKER"` y propagar en `MeshResult`. Persistir en `agent-mistakes.md` con tag `hallucination:*`.

### Hallazgo 7: Per-agent pending file pattern (atomic mv claim)
- **Origen chorus**: `_reference/chorus/public/chorus-plugin/bin/on-pre-spawn-agent.sh:41-58`, `on-subagent-start.sh:56-97`.
- **Apohara actual**: `src/core/dispatch/dispatcher.ts:28-30` usa `atomicWriteFile` (tmp + rename) para escribir instruction files. `src/core/dispatch/result-watcher.ts:13` documenta el rename pattern para watching. PERO no hay separación `pending/` → `active/` dir con FIFO claim para correlacionar dispatches con primer hook event.
- **Status**: PARCIAL.
- **Evidencia**: `src/core/dispatch/result-watcher.ts:13`: `* an atomic temp-then-rename (which atomicWriteFile always does)`. El flujo es: dispatcher escribe `.apohara-run/<task_id>.json` instruction + worker espera result_file. NO existe la fase intermediaria `pending/<dispatch_id>.json` → `mv active/<session_uuid>.json` para correlacionar sub-agents spawneados sin shared state.
- **Recomendación**: agregar `~/.apohara/pending/` con `rename()` POSIX cuando hooks-server recibe primer evento del agente — permite re-attach si el coordinator muere entre dispatch y primer hook.

### Hallazgo 8: Hook output JSON con `additionalContext` para inyectar al sub-agente
- **Origen chorus**: `_reference/chorus/public/chorus-plugin/bin/chorus-api.sh:124-163`, `on-subagent-start.sh:208-247`.
- **Apohara actual**: `src/core/anti-thrash/strategyRotation.ts:5-6, 35, 108` implementa exactamente el patrón: emite `RotationAlert.additionalContext` para inyectar al next turn via `hookSpecificOutput.additionalContext`.
- **Status**: COMPLETO (parcial: solo para anti-thrash, no para drift/heartbeat).
- **Evidencia**:
  - `src/core/anti-thrash/strategyRotation.ts:5-6`: `// emits RotationAlert with additionalContext to inject into the agent's next turn via hookSpecificOutput.additionalContext.`
  - Linea 35: `additionalContext: string;`
  - Linea 108: `additionalContext: this.composeRotationDirective(tool, failureCount)`
- **Recomendación**: extender a otros use cases mencionados en el hallazgo (drift detection, timeout reminders) — los wires de `additionalContext` ya existen, solo falta agregar más call sites en `apohara-hooks-server`.

### Hallazgo 9: Session reuse heurística por nombre (active reuse / closed reopen / else create)
- **Origen chorus**: `_reference/chorus/public/chorus-plugin/bin/on-subagent-start.sh:103-172`.
- **Apohara actual**: `src/core/orchestration/migrations/001_initial.sql` define `tasks`, `dispatch_contexts`, `decision_gates`, `coordinator_runs`, `messages` — NO hay tabla `agent_sessions` con `name`, `status`, `closed_at`, `reopened_at` para reuse heuristic.
- **Status**: NO IMPLEMENTADO.
- **Evidencia**: `grep -n "session" src/core/orchestration/migrations/001_initial.sql` retorna 0. `coordinator_runs` es por-run, no por-agent-session reusable.
- **Recomendación**: agregar tabla `agent_sessions(name, status, started_at, closed_at, reopened_at)` + lógica de checkin en SubagentManager.

### Hallazgo 10: Permisos como `resource:action` bits con presets + custom override
- **Origen chorus**: `_reference/chorus/src/lib/authz/types.ts:1-19`, `presets.ts:1-41`, `permissions.ts:17-63`.
- **Apohara actual**: `src/core/safety/runnerPolicy/presets.ts` define `STRICT/BALANCED/ADVISORY/EXTERNAL_SANDBOX` policies con filesystem/network/credentials/commands — pero NO es el grid 5×3 (idea/proposal/document/task/project × read/write/admin) de chorus.
- **Status**: AMBIGUO. Apohara tiene presets de runner policy (modelo distinto y más granular en otra dimensión), pero NO el algebra preset + customPermissions union de chorus.
- **Evidencia**:
  - `src/core/safety/runnerPolicy/presets.ts:40-87`: presets son policies de ejecución (`filesystem`, `network`, `commands`, `external_sandbox`), no `(resource, action)` bits.
  - El spec menciona "permission patterns con scopes + 3-tier settings hierarchy" en `src/core/safety/settingsHierarchy.ts:19` pero no como (resource, action) grid.
- **Recomendación**: solo aplicable si Apohara añade modelo de entidades estilo chorus (idea/proposal/document). Para v1.0 (orchestrator de tasks únicamente), el modelo actual de runnerPolicy es más relevante. Diferir / N/A.

### Hallazgo 11: Tool registration permission-gated invisible (no error, just absent)
- **Origen chorus**: `_reference/chorus/src/mcp/tools/register-helpers.ts:26-39`.
- **Apohara actual**: `src/core/mcp/base/McpServer.ts:56-58` registra todas las tools en un Map. Al recibir request, si no existe → HTTP 404 "Unknown tool" (línea 111-113). NO hay permission check en `tools/list` o tools/call.
- **Status**: NO IMPLEMENTADO.
- **Evidencia**: `src/core/mcp/base/McpServer.ts:110-113`: `if (!body.tool || !this.tools.has(body.tool)) { ... return new Response("Unknown tool", { status: 404 }); }`. El plan T3.12 ("registerPermissionedTool deny-by-non-registration") quedó en Tier 3 SIN ejecutar.
- **Recomendación**: ejecutar T3.12. Agregar `register(tool, requiredPermissions?)` y un endpoint `tools/list` que filtra por `auth_context.permissions`.

### Hallazgo 12: AsyncLocalStorage para per-request context (logger + requestId)
- **Origen chorus**: `_reference/chorus/src/lib/request-context.ts:1-15`, `api-handler.ts:43-94`.
- **Apohara actual**: `src/core/context/request-context.ts:1-49` implementa exactamente el patrón con Node `AsyncLocalStorage`, `runWithRequestContext()`, `getRequestContext()`, `getRequestLogger()` con prefix por dispatchId/sessionId/taskId.
- **Status**: COMPLETO.
- **Evidencia**:
  - `src/core/context/request-context.ts:11`: `import { AsyncLocalStorage } from "node:async_hooks";`
  - Linea 27: `const storage = new AsyncLocalStorage<RequestContext>();`
  - Linea 29-34: `runWithRequestContext(ctx, fn)` envuelve correctamente.
  - Linea 40-49: `getRequestLogger()` con prefijo automático.
- **Recomendación**: ninguna — está implementado al spec.

### Hallazgo 13: Cross-instance event dedup con `_origin` envelope
- **Origen chorus**: `_reference/chorus/src/lib/event-bus.ts:37-105`.
- **Apohara actual**: `packages/desktop/src/App.tsx:164-181` implementa dedup por `lastBridgedEventId` cursor para evitar re-emit en StrictMode rerenders. PERO no hay `_origin: process_id` envelope para descartar echos cross-process (orchestrator ↔ Rust sidecars).
- **Status**: PARCIAL.
- **Evidencia**:
  - `packages/desktop/src/App.tsx:164`: `const lastBridgedEventId = useRef<string | null>(null);` — dedup por id, no por origin.
  - `grep -rn "_origin\|process_id\|instance_id" src/ crates/` retorna 0.
- **Recomendación**: cuando se cablee tokio broadcast del hooks-server al orchestrator, agregar `_origin: process_id` (UUID) en envelope para que cada nodo descarte sus echos.

### Hallazgo 14: `/yolo` skill — full-auto pipeline con escape hatch
- **Origen chorus**: `_reference/chorus/public/chorus-plugin/skills/yolo/SKILL.md:1-50, 262-310, 380-440`.
- **Apohara actual**: `src/commands/auto.ts` ejecuta decomposer → scheduler en paralelo con worktrees, PERO no es "wave-based con barriers + verification adversarial entre fases", ni implementa escape hatch `apohara resume <dispatch_id>`.
- **Status**: RECHAZADO (explícitamente diferido a v1.1+).
- **Evidencia**: `docs/superpowers/plans/2026-05-22-reference-mining-sprints.md:239`: tabla "Items que el análisis explícitamente difirió a v1.1+ (10 ítems)" incluye **"/yolo full-auto pipeline | Chorus"**. Justificación: no está en el scope cerrado de v1.0.
- **Recomendación**: dejar para v1.1 según decisión documentada en el sprint plan.

### Hallazgo 15: maxRounds + escalation explícita en pipelines de review
- **Origen chorus**: `_reference/chorus/public/chorus-plugin/skills/yolo/SKILL.md:429-440, 303-310`.
- **Apohara actual**: `src/core/orchestration/migrations/001_initial.sql:15` define `messages.type` enum que incluye `'escalation'` (mecanismo de mensaje). `src/core/orchestration/groups.ts:43` usa `dispatch + escalation` para el grupo `@idle`. PERO NO hay configuración `maxRounds` por DAG node ni una transición a status `ESCALATED` que despublica del DAG.
- **Status**: PARCIAL.
- **Evidencia**:
  - `src/core/orchestration/messages.ts:8`: `type: "escalation"` solo como categoría de mensaje.
  - `grep -rn "max_verify\|maxRounds\|max_round" src/` retorna 0 en código (solo aparece en el spec doc).
- **Recomendación**: agregar `max_verify_rounds: u8` a TaskRecord + status `ESCALATED` en migration schema. Cuando agotado, no bloquea descendientes que no dependan del output.

### Hallazgo 16: OpenSpec mode — local files autoritativos, MCP como mirror byte-equal
- **Origen chorus**: `_reference/chorus/public/chorus-plugin/skills/openspec-aware/SKILL.md:76-99, 100-101`.
- **Apohara actual**: `src/core/openspec/validator.ts` valida `openspec/changes/<slug>/{proposal,design,tasks,specs}/` (T3.1 ejecutado: `42b09d7`). Hay `openspec/changes/2026-05-22-pty-embedding/` real con la estructura completa. PERO no existe un comando `apohara doc sync <path>` con byte-equal stream que el LLM nunca vea el contenido completo.
- **Status**: PARCIAL.
- **Evidencia**:
  - `src/core/openspec/validator.ts:55-145`: validator estructural existe.
  - `openspec/changes/2026-05-22-pty-embedding/{design.md,proposal.md,tasks.md,specs/}` existe (formato adoptado).
  - `grep -rn "doc sync\|byte-equal\|byteFaithful" src/` retorna 0. NO hay enforcement de "single source of truth + LLM no re-emite contenido".
- **Recomendación**: agregar `apohara doc sync` CLI que push el file local al MCP server por byte stream + verifica sha256.

### Hallazgo 17: Reversed Conversation como design principle explícito
- **Origen chorus**: `_reference/chorus/CLAUDE.md:1-10`, `docs/AIDLC_GAP_ANALYSIS.md:17-26`.
- **Apohara actual**: `src/core/orchestration/decision-gates.ts` implementa el patrón de gates (blocking/blocked), pero NO el approval gate automático cuando blast-radius > threshold. El spec marca explícitamente en `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3137`: "Decision gates ya en §3.6; el gate de plan_approval queda para v1.1".
- **Status**: RECHAZADO (diferido explícitamente al spec).
- **Evidencia**:
  - `src/core/orchestration/decision-gates.ts:1-12`: gates resuelven conflictos write/read entre tasks, no son "plan approval gates".
  - `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3137`: "el gate de plan_approval queda para v1.1 cuando tengamos métricas reales de blast-radius threshold".
- **Recomendación**: respetar la decisión del spec — diferir.

### Hallazgo 18: SSE listener con exponential backoff + onReconnect backfill callback
- **Origen chorus**: `_reference/chorus/packages/openclaw-plugin/src/sse-listener.ts:1-184`.
- **Apohara actual**: `packages/desktop/src/hooks/useLedgerStream.ts:20` usa `new EventSource(url)` nativo que auto-reconnect, pero NO tiene tracking de `lastEventTimestamp` ni `onReconnect` callback para back-fill via `apohara.runs.list_since(timestamp)`.
- **Status**: PARCIAL.
- **Evidencia**:
  - `packages/desktop/src/hooks/useLedgerStream.ts:5-7`: comentario explícito "EventSource auto-reconnects on drop".
  - Linea 22-29: solo agrega events a state, sin track de cursor.
  - Linea 31-34: `onerror` no dispara back-fill.
- **Recomendación**: agregar `lastEventTimestamp` en `useRef` + en `onerror` (cuando se cierra) llamar `fetch(/api/session/:id/events?since=${lastEventTimestamp})` antes de reconectar.

### Hallazgo 19: Notification listener desacoplado via EventBus (zero invasion)
- **Origen chorus**: `_reference/chorus/src/services/notification-listener.ts:1-58`.
- **Apohara actual**: `crates/apohara-notifications/src/lib.rs` provee Notifier trait + global `OnceLock<Arc<dyn Notifier>>`, pero el wiring es DIRECTO desde los call sites (no via subscribe a un event bus). Ejemplo: `crates/apohara-hooks-server/src/event.rs:100` solo hace `tracing::info!`, no emite a un bus que el notifier consuma.
- **Status**: PARCIAL.
- **Evidencia**:
  - `crates/apohara-notifications/src/lib.rs:1-50`: `pub trait Notifier` + `fire(n: Notification)` global pull-based, no via subscribe.
  - `grep -rn "EventBus\|notification-listener" src/` retorna 0.
  - El ledger es file-append + SSE tail (`src/core/ledger.ts`); no broadcast in-process con multiple listeners.
- **Recomendación**: para event sourcing light, agregar `tokio::sync::broadcast` channel en el hooks-server que multi-cast a (a) orchestration DB writer, (b) notifier, (c) tracker workflow. Cada listener es `tokio::spawn` independiente — patrón de chorus pero adaptado a single-instance.

---

## Notas de auditoría

**Estado general**: chorus aporta patrones de plataforma multi-tenant que se traducen sólo parcialmente a Apohara (orchestrator local single-user). Los hallazgos COMPLETO (2) son los más universales (AsyncLocalStorage context, hookSpecificOutput.additionalContext). Los NO IMPLEMENTADO (9) tienen plan documentado o son trivialmente cableables sin cambiar arquitectura — particularmente los del Tier 3 (T3.11, T3.12) que quedaron explícitamente fuera de Sprints 1-3.

**Top 3 gaps de mayor valor**:
1. **Hallazgo 5 — system reminders críticos para critic** — alta señal/ruido: el bloque TS está en el spec (línea 1678-1709) pero el archivo `src/core/verification-mesh/prompts/critic.ts` no existe. Crear archivo + inyectar es 1 día. Eleva la calidad del verification-mesh sin cambiar arquitectura.
2. **Hallazgo 11 — registerPermissionedTool invisible** — T3.12 del plan; bloquea hardening MCP. Sin esto, agents ven tools admin-only y queman tokens en error handling. 1 día.
3. **Hallazgo 4 — dual-path acceptance criteria** — T3.11 del plan; mismatch dev/admin es señal de hallucination. Refactor de planDocuments + nueva tabla DB. 2 días.
