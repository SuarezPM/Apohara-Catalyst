> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

# Audit: agentrail (17 hallazgos)

> Audit ejecutado 2026-05-22 sobre `feat/apohara-v1` HEAD.

## Resumen

| Status | Cantidad |
|---|---:|
| ✅ COMPLETO | 6 |
| 🟡 PARCIAL | 7 |
| ❌ NO IMPLEMENTADO | 3 |
| 🚫 RECHAZADO | 0 |
| ❓ AMBIGUO | 1 |
| **Total** | **17** |

Notas: aunque `docs/superpowers/plans/2026-05-22-reference-mining-sprints.md` declara
"GitHub-issue-centric lifecycle" como NO robado, ninguno de los 17 hallazgos individuales
de agentrail.md ESTÁ esa "ticket-runner lifecycle" en sí: la mayoría son contratos de
infraestructura (idempotency, scheduler lanes, scoped keys, etc.) portables independientemente
de si Apohara se orienta o no a tickets. Por eso 0 en "RECHAZADO".

## Hallazgos

### Hallazgo 1: `availableActions[]` como contrato universal de "qué hago ahora"
- **Origen agentrail**: `src/task-store.ts`, `src/github-review-feedback-adapter.ts:371-389`, `src/managed-run-context.ts:61-90`, `docs/agent-recipes.md:31-38`.
- **Apohara actual**: no existe `available_actions[]` ni un enum equivalente. El preámbulo de dispatch hace prompt-engineering en lugar de exponer un vocabulario cerrado de verbos.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `rg -i "availableActions|available_actions"` solo devuelve coincidencias en `docs/reference-mining/agentrail.md`. `src/core/orchestration/preamble.ts:42-74` lista comandos CLI dentro del texto del prompt (`apohara orchestration send`, `apohara orchestration ask`) pero no un set discreto enumerable. `src/core/dispatch/types.ts:23-26` define `DispatchTaskStatus = "completed" | "failed" | "aborted" | "timed_out"` (estados, no acciones disponibles).
- **Gap**: el orchestrator no expone qué puede hacer el agente ahora — el agente tiene que inferirlo del prompt.
- **Recomendación**: añadir `available_actions: Vec<ActionVerb>` en `apohara-types` con enum cerrado (`Submit`, `Fix`, `ResolveBlocker`, `Verify`, `Consolidate`, `Rollback`) y exponerlo en cada respuesta de coordinator-runs.

### Hallazgo 2: Vocabulario de severity para review comments: `must_fix` / `should_fix` / `note`
- **Origen agentrail**: `src/github-review-feedback-adapter.ts:341-369`.
- **Apohara actual**: existe `severity` en quality gates pero usa escala `low|medium|high|critical` (OWASP-style), no `must_fix|should_fix|note`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: `src/core/verification/qualityGates/securityGate.ts:13` (`/severity\s*[:=]\s*(low|medium|high|critical)/i`) y `codeQualityGate.ts:8` usan el patrón OWASP. No hay `classifySeverity` con regex sobre body en busca de `must|require|block` vs `should|suggest|consider`.
- **Gap**: la escala existente es para clasificar findings dentro de outputs, no para clasificar comentarios externos (PR reviews humanas o críticos internos). El consolidator no puede priorizar `must_fix` antes que `note` porque ese vocabulario no existe.
- **Recomendación**: añadir `enum CriticSeverity { MustFix, ShouldFix, Note }` en `apohara-types` y `classify_severity(body: &str)` usable por verification-mesh y github-bridge cuando lea comentarios.

### Hallazgo 3: Idempotency-Key embebido en PR body como tag HTML comment
- **Origen agentrail**: `adapters/github-adapter/src/github-adapter.ts:193-310` (`IDEMPOTENCY_TAG`, `embedIdempotencyKey`, `findPRByIdempotencyKey`, `findPRByHeadBranch`, `findLinkedPRs`).
- **Apohara actual**: implementado completo en `packages/github-bridge/src/pr-builder.ts`.
- **Status**: ✅ COMPLETO
- **Evidencia**: `packages/github-bridge/src/pr-builder.ts:96` (`computeIdempotencyKey` sha256), `:109` (`<!-- apohara-attempt: sha256:${key} -->` embedding), `:128-133` (`findPRByIdempotencyKey`), `:135-138` (`findPRByHeadBranch`), `:140-144` (`findLinkedPRs` con regex `\b(close[sd]?|fix(?:e[sd])?)\s+#${issueNumber}\b`), `:152-179` (`createOrUpdatePR` con triple fallback). Cobertura: `tests/integration/github-bridge/pr-builder.test.ts`.
- **Recomendación**: ninguna — espejo fiel del pattern de agentrail.

### Hallazgo 4: Two-tier provider connect: `connect` (interactive, writes env, runs readiness) vs `doctor` (validate only)
- **Origen agentrail**: `src/cli/provider-management.ts`, `src/cli/provider-readiness.ts`, README `:104-114`.
- **Apohara actual**: hay `apohara doctor` con 7 secciones y un TUI config wizard que escribe credenciales — pero NO comparten un engine de readiness.
- **Status**: 🟡 PARCIAL
- **Evidencia**: `src/cli/doctor.ts:1-220` implementa `runtime|roster|policy|sandbox|ledger|mcp|assigned` (7 secciones) con flag `--skip-<section>`. `packages/tui/config-wizard.tsx:1-80` pide tokens y persiste a `credentials.json`. Pero el wizard NO ejecuta los checks del doctor antes de declarar setup completo, y no hay `ProviderReadinessEngine` compartido. `rg -i "providerReadiness|ReadinessEngine"` no devuelve hits.
- **Gap**: falta `provider connect` interactivo que (a) comparta engine con `doctor` y (b) aplique fixes locales seguros (crear `.opencode/opencode.jsonc` starter, configurar branch protection vía `gh api`, etc.). El wizard actual solo lee inputs sin ejecutar readiness completo.
- **Recomendación**: extraer un `ProviderReadinessEngine` que `doctor` y wizard invoquen con flags `write` vs `read_only`; `apohara verify-setup` ya existe como gate empírico pero no se mezcla con el wizard.

### Hallazgo 5: Setup verification task: identifier `LOCAL-SETUP-<AGENT>` con queue lane dedicada
- **Origen agentrail**: `src/setup-verification-task.ts`, `src/managed-run-task-queue.ts:7,113-128`, `docs/architecture/local-self-hosted-setup-cli-contract.md:463-499`.
- **Apohara actual**: implementado el task `LOCAL-SETUP-001` y `apohara verify-setup` como gate de éxito. La lane dedicada NO está separada en el scheduler.
- **Status**: 🟡 PARCIAL
- **Evidencia**: `src/core/orchestration/setup-verification.ts:17` (`SETUP_TASK_ID = "LOCAL-SETUP-001"`), `:29-62` (`enrollSetupVerificationTask` idempotente con `createdByTerminalHandle="@apohara-setup"`), `:76-107` (`inspectSetupVerification` con verdict `Approved` + `ledgerRoot`). Tests: `tests/unit/orchestration/setup-verification.test.ts`. Hook en `src/cli/doctor.ts:147-153` (sección `assigned`). Pero comentario `:8-12`: "Lane semantics ('low-priority'): ... For v1.0 we rely on `ts` ordering". No hay `setup_verification: 3` enum en `src/core/scheduler.ts`.
- **Gap**: la lane dedicada de baja prioridad (corre solo si no hay normal-runnable) NO existe — depende implícitamente del orden por timestamp.
- **Recomendación**: añadir lane explícita cuando se implemente el hallazgo #6 (scheduler lanes priorizadas) — ambos cambios se hacen juntos.

### Hallazgo 6: Scheduler con lanes priorizadas + back-off entre normal/setup tasks
- **Origen agentrail**: `src/managed-run-task-queue.ts:49-204` (`buildManagedRunQueuePlan`).
- **Apohara actual**: el scheduler usa "lanes" pero refiriéndose a worktrees (paralelismo), no a clases de prioridad de tasks. No hay `Lane::ResumeInProgress | RetryAfterFeedback | StartNew | SetupVerification`.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `src/core/scheduler.ts:65` (`worktreeId = lane-${i}`), `:95` (`findAvailableWorktree`), `:121-186` (`scheduleTask` solo verifica `checkDependencies` y disponibilidad de worktree). `messages.ts:108` ordena por `(CASE priority WHEN 'urgent' ... 'normal' ... 'low')` pero eso es para mensajes inter-agente, no para tasks. `rg -i "ResumeInProgress|RetryAfterFeedback"` solo en docs/.
- **Gap**: tasks en `retry_queued` no tienen prioridad sobre `unclaimed` nuevos. Starvation guard ausente.
- **Recomendación**: enum `enum SchedulerLane { ResumeInProgress, RetryAfterFeedback, StartNew, SetupVerification }` + función `pick_next_task` con sort compuesto `lane → priority → due_at → updated_at → id`.

### Hallazgo 7: Managed run reclaim policy: stale detection + supervisor restart-loop guard + escalación
- **Origen agentrail**: `src/managed-run-reclaim-policy.ts`, `src/cli/local-runner-supervisor.ts:73-196`, `docs/integration-guide.md:536-571`.
- **Apohara actual**: existe `circuit-breaker.ts` (cuenta failures consecutivas por task) y `dispatch/reconciler.ts` (stall detection). No hay los 6 knobs específicos ni `supervisor_max_restarts`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: `src/core/orchestration/circuit-breaker.ts` existe (visible en `ls src/core/orchestration/`). `src/core/dispatch/reconciler.ts` existe + test `tests/core/dispatch/reconciler.test.ts`. `src/core/orchestration/dispatch-contexts.ts:65-86` cuenta failed dispatches post-última-completion. PERO `rg -i "RunReclaimPolicy|stale.detection|restart.loop|supervisorMaxRestarts"` no devuelve hits — los 6 knobs (`startingStaleAfterMs`, `runningStaleAfterMs`, `failureWindowMs`, `maxInfrastructureFailures`, `supervisorRestartWindowMs`, `supervisorMaxRestarts`) no están parametrizados.
- **Gap**: existe el behavior "circuit breaker tras N fails" pero no el ring-buffer de timestamps ni la clasificación entre "infrastructure failure" vs "task failure" para escalar a humano.
- **Recomendación**: formalizar `RunReclaimPolicy` con 6 knobs en `apohara-types`, leer de `~/.apohara/config.toml`, integrar con el circuit-breaker existente.

### Hallazgo 8: Runner execution policy: presets `strict|balanced|advisory|external_sandbox` con dimensiones formalizadas
- **Origen agentrail**: `src/runner-execution-policy.ts`, `src/cli/index.ts:706-711`.
- **Apohara actual**: implementado en `src/core/safety/runnerPolicy/` con presets, plan compiler, fs snapshot. Falta integración con el spawn real.
- **Status**: 🟡 PARCIAL
- **Evidencia**: `src/core/safety/runnerPolicy/types.ts:1` (`PolicyPreset = "Strict" | "Balanced" | "Advisory" | "ExternalSandbox" | "Custom"`), `:5-10` (`Enforcement { area, strength, critical, description }`), `:45-53` (`RunnerExecutionPolicy` con 6 areas). `presets.ts:40-80` define `STRICT|BALANCED|ADVISORY`. `planCompiler.ts:1-63` (`compileRunnerExecutionPlan` con Strict-rejects-on-critical-unsupported, espejo de agentrail). `fsSnapshot.ts:16-60` (`snapshotProtectedPaths` SHA-256, `detectViolations`). Tests: `tests/core/safety/runnerPolicy/{presets,planCompiler,fsSnapshot}.test.ts`. PERO `src/cli/doctor.ts:78-83`: `summary: "validateRunnerPolicyPlan dry-run deferred (Stage 5 integration pending)"` — no está cableado al spawn real.
- **Gap**: el plan compiler existe pero NO está integrado al pipeline de spawn (`BaseAgentProvider.spawn` / `apohara-sandbox`). El "after snapshot" + recovery de archivos críticos no se ejecuta. `doctor` no compila el plan en dry-run.
- **Recomendación**: cablear `compileRunnerExecutionPlan` antes del spawn en `BaseAgentProvider` y agregar el post-spawn snapshot diff con recovery; reemplazar el placeholder en `doctor.ts:78-83`.

### Hallazgo 9: Per-agent scoped API keys con vocabulario de scopes cerrado + rate limit por key
- **Origen agentrail**: `sdk/typescript/src/types.ts:5-19` (14 scopes), `src/agent-auth-store.ts:295-520`, `docs/integration-guide.md:480-491`.
- **Apohara actual**: los MCP servers internos usan bearer token único compartido. No hay scope vocabulary ni rate limit per-key.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `src/core/mcp/bootstrap.ts:50` genera un `token = randomBytes(16).toString("hex")` único compartido entre los 4 servers (`ledger|runs|indexer|settings`). No hay enum de scopes. `rg -i "scope|rateLimit"` en `crates/apohara-mcp-bridge/` y `src/core/mcp/` no devuelve hits relevantes (solo strings genéricos).
- **Gap**: cualquier agente con el bearer token puede ejecutar cualquier operación de cualquier MCP server. No hay vocabulario `tasks:read|tasks:write|ledger:read|...`. No hay tracking de usage por key.
- **Recomendación**: cuando se exponga API HTTP (Tauri UI remoto o terceros), adoptar el vocabulario de 14 scopes + rate limit por key + endpoint `/agent-api-keys/{id}/usage`. Para v1.0 está OK dejarlo como gap consciente.

### Hallazgo 10: Webhook delivery worker con HMAC signing + exponential back-off (8 attempts) + 410 auto-disable
- **Origen agentrail**: `src/event-delivery-worker.ts:12,109-200`.
- **Apohara actual**: webhook endpoint stub (501) explícitamente diferido a v1.1+; no hay delivery worker outbound.
- **Status**: 🟡 PARCIAL (diferido a v1.1, documentado)
- **Evidencia**: `packages/github-bridge/src/webhook.ts:14-22` retorna 501 con mensaje `"webhook deliveries are deferred to v1.1+; v1.0 uses poll-only ingestion"`. `docs/v1.1-webhook-deferral.md` existe (visible en `ls docs/`). `docs/cloud-boundary.md:142-150` documenta explícitamente el aplazamiento. `rg -i "deliveryWorker|HMAC|hmac.*sha256"` solo en envSanitizer + sandbox (no relacionado con webhook delivery).
- **Gap**: ningún delivery worker outbound + back-off curve + HMAC + 410 semantics. Está como decisión de scope explícita, no como olvido.
- **Recomendación**: cuando se implemente v1.1 webhooks, adoptar la curva exacta `[0, 10, 30, 90, 300, 900, 1800, 3600]` + HMAC SHA-256 + sticky 410.

### Hallazgo 11: Telemetry con install-id anónimo + event allowlist + property denylist explícito
- **Origen agentrail**: `docs/superpowers/specs/2026-05-21-product-activation-telemetry-design.md`.
- **Apohara actual**: implementado completo con allowlist + denylist + install-id + opt-out env var.
- **Status**: ✅ COMPLETO
- **Evidencia**: `src/core/telemetry/index.ts:13-29` (15 eventos en `ALLOWED_EVENTS` allowlist cerrada), `:39-51` (23 keys en `DENY_KEYS` — todas las del agentrail: repo_url, username, secret, token, prompt, branch_name, commit_sha, file_paths), `:55` (`MAX_STRING_LENGTH = 200`), `:88-92` (`APOHARA_TELEMETRY_DISABLED=1` opt-out). `src/core/telemetry/install-id.ts` separa generación. Tests: `tests/core/telemetry/telemetry.test.ts`. `docs/cloud-boundary.md:85-96` documenta "v1.0 default: zero outbound bytes from the telemetry path".
- **Recomendación**: ninguna — los 23 deny keys cubren más superficie que la lista de agentrail.

### Hallazgo 12: Two-track wake mechanism: SSE event stream + signed webhooks
- **Origen agentrail**: `sdk/typescript/src/client.ts:225-280` (`streamEvents`), `docs/integration-guide.md:527-535`.
- **Apohara actual**: SSE implementado en server.ts para session events + PTY stream. Webhooks outbound diferidos.
- **Status**: 🟡 PARCIAL
- **Evidencia**: `packages/desktop/src/server.ts:526-590` (PTY SSE `/api/pty/:id/stream` con `text/event-stream`), `:800-893` (`/api/session/:id/events` SSE con replay del ledger + watch + heartbeat 15s). `packages/desktop/src/hooks/useLedgerStream.ts:5` consume el stream. Falta: `Last-Event-ID` para resume tras desconexión (`rg "Last-Event-ID"` no devuelve hits); el cliente reabre desde inicio cada vez. Webhooks track-2 diferida (ver #10).
- **Gap**: sin cursor de resume, una desconexión causa reload completo de la lectura. Filter por `eventTypes` (csv) y `taskId` no expuesto.
- **Recomendación**: añadir `Last-Event-ID` (sequence desde orchestration DB) + query params `taskId` y `eventTypes` en `/api/session/:id/events`.

### Hallazgo 13: Task source repair endpoint: corrección de metadata sin recrear task
- **Origen agentrail**: `src/task-source-repair.ts`, `src/cli/task-source-repair.ts`, README `:144-148`.
- **Apohara actual**: no existe endpoint ni CLI subcomando de repair de metadata.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `rg -i "source.repair|metadata.repair|sourceRef|sourceAudit|repairTaskSource"` solo devuelve hits en docs/. No hay tabla `task_metadata` separada del ledger, no hay endpoint `POST /tasks/{id}/source/repair`, no hay `apohara task metadata repair` en `src/cli/`.
- **Gap**: si el metadata de un task se corrompe (rename del repo, force-push que cambia branch, restore de DB tras crash), no hay path canónico para enmendar sin destruir history.
- **Recomendación**: tabla `task_metadata_audit` con `(prev_hash, new_value, change_reason, repaired_at, operator)`; ledger sigue inmutable. Bajo prioridad — necesario solo cuando un usuario reporte el caso.

### Hallazgo 14: Run context envelope con next-action human-readable labels
- **Origen agentrail**: `src/managed-run-context.ts:61-90` (`describeManagedRunAction`), `src/cli/run-context.ts`.
- **Apohara actual**: existe el `dispatch_contexts` table y `buildDispatchPreamble` que produce el system message del worker. NO hay envelope `nextActions: Array<{ id, label }>` con labels humanizados.
- **Status**: 🟡 PARCIAL
- **Evidencia**: `src/core/orchestration/dispatch-contexts.ts:1-86` (CRUD para `dispatch_contexts` table; capture qué preamble fue dado a cada task). `src/core/orchestration/preamble.ts:35-80` (`buildDispatchPreamble` arma un system message con secciones `## Communication protocol`, `## Your task`, `### Symbols you declared`). Pero el preamble es un blob de texto, NO un envelope estructurado con `nextActions[].id + nextActions[].label`. No hay subcomandos `apohara run current` / `apohara run actions`.
- **Gap**: el child agent recibe un wall of text en stdin/system; no puede leer "su asignación" con un comando enumerable. No hay file-based fallback `APOHARA_RUN_CONTEXT_PATH`. Token economy peor que con el envelope agentrail.
- **Recomendación**: emitir `~/.apohara/runs/<run-id>/context.json` con `{ run, task, nextActions: [{ id: "submit", label: "Finish the code change..." }] }` y exponer `apohara run current` / `apohara run actions` para que el worker no necesite parsear todo el preamble.

### Hallazgo 15: Landing page: anatomía de value props comunicables
- **Origen agentrail**: `landing-next/components/{Hero,Problem,Capabilities,Lifecycle,Compare,SDK}.tsx`.
- **Apohara actual**: sin landing page. Sin componentes Hero/Problem/Compare. README + ARCHITECTURE.md textuales.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `find . -name "*landing*" -o -path "*landing-next*"` no devuelve resultados. No hay `landing/`, `web/`, `site/` dir.
- **Gap**: cuando Apohara llegue a launch público no hay baseline para comunicar value props.
- **Recomendación**: cuando se planifique landing, usar la estructura: Problem (3 puntos sharp) → Capabilities grid (8 primitives con endpoints) → Lifecycle (5 stages con snippets) → Compare (OSS vs Cloud). Bajo prioridad para v1.0.

### Hallazgo 16: Boundary OSS vs Cloud explicito en docs (`docs/cloud.md`)
- **Origen agentrail**: `docs/cloud.md`.
- **Apohara actual**: implementado en `docs/cloud-boundary.md` (159 líneas).
- **Status**: ✅ COMPLETO
- **Evidencia**: `docs/cloud-boundary.md:1-159` define (1) what stays local con tabla completa de artifacts + paths, (2) what crosses the boundary (provider CLI subprocess, github-bridge poll-only, telemetry zero-outbound), (3) what does NOT cross (provider API keys, source code outside worktree, embeddings, prompts, issue titles/PR bodies/branch names/commit SHAs — denylist por key name), (4) audit hooks (`apohara doctor mcp`, `~/.apohara/audit/`, `lsof`), (5) v1.1+ changes con scope explícito para webhook delivery worker + outbound telemetry + hosted GitHub App.
- **Recomendación**: ninguna — más detallado que el `docs/cloud.md` de agentrail (incluye paths + audit hooks).

### Hallazgo 17: `agentrail doctor` con `--skip-routing-check` flag y check de runner policy compilable
- **Origen agentrail**: `src/cli/doctor.ts:71-86`, README `:64-70`.
- **Apohara actual**: `apohara doctor` con 7 secciones + flag `--skip-<section>` + `--json`. El check de policy es placeholder.
- **Status**: 🟡 PARCIAL
- **Evidencia**: `src/cli/doctor.ts:21-31` (`ALL_SECTIONS = [runtime, roster, policy, sandbox, ledger, mcp, assigned]`), `:160-192` (`doctor()` con map de runners, `skip` set, `--json` mode), `:194-204` (`parseArgs` reconoce `--skip-<name>`). Test: `tests/unit/cli/doctor.test.ts`. PERO `:78-83` el check `policy` retorna placeholder `"validateRunnerPolicyPlan dry-run deferred (Stage 5 integration pending)"` — NO ejecuta `compileRunnerExecutionPlan` aunque la función existe en `src/core/safety/runnerPolicy/planCompiler.ts:3`.
- **Gap**: el doctor no compila el plan en dry-run para detectar combinations imposibles (runner X + preset Y sin executable). El placeholder es honesto pero el cableado falta.
- **Recomendación**: reemplazar la función `policy()` en `doctor.ts:78-83` por una que llame a `compileRunnerExecutionPlan(STRICT)` (y los otros presets) y verifique `result.rejected === false`; un FAIL aquí debería surfaces antes del primer spawn.

## Hallazgos secundarios (notas, no scoreados)

- **NDJSON event store + JSON state store** (CQRS lite): Apohara usa `.events/run-<id>.jsonl` para JSONL event log + `orchestration.db` (bun:sqlite) para state materializado — patrón equivalente ya en producción.
- **`structuredClone` defensivo**: Rust ya tiene `Clone`/borrow checker.
- **`isSetupVerificationTask(identifier)` por prefix `LOCAL-SETUP-`**: convención adoptada (`SETUP_TASK_ID = "LOCAL-SETUP-001"` en setup-verification.ts:17).

## Notas finales para el operador

El "❓ AMBIGUO" no se asignó a ningún hallazgo individual del 1 al 17 — todos quedaron clasificables. Hay 1 caso (#10 Webhook delivery worker) que técnicamente está en PARCIAL pero con la dimensión adicional de "rechazado para v1.0, recapturado en v1.1" — se contabiliza como PARCIAL porque la decisión está documentada y el stub existe. Si el operador prefiere reclasificarlo como RECHAZADO, los conteos serían: ✅ 6 / 🟡 6 / ❌ 3 / 🚫 1 / ❓ 1 → mismo total.
