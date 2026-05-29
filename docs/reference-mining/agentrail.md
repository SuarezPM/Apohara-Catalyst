> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

I have enough to compile a thorough report. Let me produce the final findings.

---

# AgentRail Research Report — Hallazgos para Apohara v1.0

Análisis exhaustivo de `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/`. AgentRail es un control plane local-first para coding agents (Node 24 + Octokit + Octokit + Linear/CircleCI adapters) con TS/Python SDKs, CLI-first wizard, runtime con SQLite/JSON stores, telemetry PostHog. Stack distinto del de Apohara (Bun/Rust/Tauri), pero los **patrones de contrato** son altamente portables.

---

## Hallazgos NUEVOS (no presentes en spec Apohara v1.0)

### 1. `availableActions[]` como contrato universal de "qué hago ahora"

**Qué.** Toda respuesta (task list, task detail, CI status, review feedback, submit response, ship response) trae un array `availableActions` con strings tipo `["submit", "fix", "ship", "resolve_blocker"]`. El agente nunca infiere su siguiente paso del status crudo — lo lee del campo.

**Dónde.**
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/task-store.ts` líneas 108, 202, 216, 395 (filtro a vocabulario cerrado: `["start","submit","fix","ship","resolve_blocker"]`).
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/github-review-feedback-adapter.ts:371-389` (`actionsForDecision(outcome)` — outcome → set de acciones).
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/managed-run-context.ts:61-90` (`describeManagedRunAction` mapea acción → label humanizado tipo "Finish the code change, leave worktree changes in place, write the result file, then report completion.").
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/docs/agent-recipes.md:31-38` ("Agents should follow the API's `availableActions` field instead of guessing the next step").

**Por qué inspira.** Apohara tiene Coordinator semántico, decomposer, scheduler — pero los agentes (CLI providers `claude/codex --pure`) reciben prompts. Si Apohara expusiera en cada respuesta de su orchestration API un array `availableActions` con verbos del workflow (`verify`, `consolidate`, `await-judge`, `submit-attempt`, `rollback`), elimina ambigüedad sobre el siguiente paso y reduce prompt churn.

**Cómo traducir.** En la Orchestration DB SQLite + en respuestas del Coordinator, agregar `available_actions: Vec<ActionVerb>` enum con vocabulario CERRADO (no strings libres) — Rust enum + serde discriminated union. El verification-mesh, ledger, y CLI wrappers consumen el campo.

**Valor.** Loop determinístico entre orchestrator y providers; logs/replay legibles; menor probabilidad de "agent invents work".

---

### 2. Vocabulario de severity para review comments: `must_fix` / `should_fix` / `note`

**Qué.** Adapter de review feedback clasifica cada comentario por (a) review state de GitHub (`CHANGES_REQUESTED` → `must_fix`) y (b) regex sobre el body buscando palabras `must|require|block|critical|fix this` → `must_fix`; `should|suggest|consider|prefer|recommend` → `should_fix`; default → `note`. Luego ordena por severidad y trunca a `MAX_COMMENTS`.

**Dónde.** `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/github-review-feedback-adapter.ts:341-369` (`severityFromReviewState`, `classifySeverity`, `extractSuggestion` que captura ```` ```suggestion ```` blocks).

**Por qué inspira.** El verification-mesh judge≠critic de Apohara produce críticas — si las clasificamos con esta misma escala de severidad y orden, el consolidator puede priorizar `must_fix` antes que `note`, y la UI (TaskBoard kanban) puede mostrar badges blocker vs advisory. También el github-bridge puede usar exactamente este modelo cuando lea comentarios de PR humanos.

**Cómo traducir.** En `apohara-types` Rust crate definir `enum CriticSeverity { MustFix, ShouldFix, Note }` y `fn classify_severity(body: &str) -> CriticSeverity` con la misma heurística (regex). Aplicar tanto en verification-mesh internal critics como en github-bridge cuando lea PR review comments.

**Valor.** Triage automático entre cambios obligatorios vs sugerencias; ordering estable; menos tokens dedicados a comentarios decorativos.

---

### 3. Idempotency-Key embebido en PR body como tag HTML comment

**Qué.** Submit adapter embebe `<!-- agentrail-idempotency-key: <key> -->` en el body del PR al crearlo. Antes de crear un nuevo PR, lista PRs y busca ese marker — si lo encuentra reutiliza el PR existente, no crea uno nuevo. Doble fallback: por head branch, luego por linked-PR regex (`close[sd]?|fix(?:e[sd])?|resolve[sd]?` + `#<issue>`).

**Dónde.** `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/adapters/github-adapter/src/github-adapter.ts:193-310` — `IDEMPOTENCY_TAG`, `extractIdempotencyKey`, `embedIdempotencyKey`, `findPRByIdempotencyKey`, `findPRByHeadBranch`, `findLinkedPRs` con regex.

**Por qué inspira.** github-bridge de Apohara (poll-only, Issue→PR) necesita garantía de no-duplicación. El "replay link en PR body" ya está pensado — sumar este patrón de idempotency-key comment (que GitHub no parsea pero los humanos no ven) da retry seguro sin estado lateral. El ledger SHA-256 puede ser el idempotency key natural.

**Cómo traducir.** En github-bridge Rust: al crear PR, append en body `<!-- apohara-attempt: sha256:abc123 -->`. Antes de crear, buscar PRs abiertos+cerrados con ese marker. Si match, retornar PR existente; si no, crear nuevo. El attempt-id puede derivarse de `(issue_id, attempt_number, ledger_root)`.

**Valor.** Submit retry-safe sin necesidad de tabla `submitted_prs`; resiliente a crashes entre "creé el PR" y "registré la creación".

---

### 4. Two-tier provider connect: `connect` (interactive, writes env, runs readiness) vs `doctor` (validate only)

**Qué.** `agentrail provider connect <github|circleci|linear>` es interactivo, pide tokens con prompts ocultos, escribe `~/.agentrail/provider.env` con mode 0600, corre **readiness check completo** (no solo "token válido"), aplica fixes locales seguros (ej.: crea `.circleci/config.yml` starter si falta), y reporta blockers clasificados que el usuario debe resolver remotamente. `agentrail provider doctor <provider>` usa el **mismo engine** que connect — solo que sin escribir. `provider test` también usa el mismo engine.

**Dónde.**
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/cli/provider-management.ts` (56k, command runner)
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/cli/provider-readiness.ts` (54k, engine compartido)
- README `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/README.md:104-114` (explica que test/doctor/connect comparten engine)

**Por qué inspira.** Apohara tiene Roster hardening y BaseAgentProvider, pero falta el patrón de "diagnóstico que aplica fixes seguros". Esto es esencial cuando integremos OAuth a GitHub App, configures de Bun runtime, paths del sandbox, etc. Tener `apohara doctor providers` que comparte engine con `apohara providers connect` reduce drift entre "lo que el wizard verifica" y "lo que después se chequea".

**Cómo traducir.** Diseñar un `ProviderReadinessEngine` (Rust) que cada provider implementa: `check_credentials`, `check_remote_settings`, `apply_safe_local_fixes`, `classify_remaining_blockers`. Comandos `apohara provider connect`, `apohara provider doctor`, `apohara provider test` invocan el mismo engine con flags distintas (write vs read-only, interactive vs scripted).

**Valor.** Setup forgiving — el usuario no recibe "token inválido" críptico sino "token OK, pero te falta webhook secret y el repo no tiene branch protection configurado; corro `gh api ...` para crearlo? [Y/n]".

---

### 5. Setup verification task: identifier `LOCAL-SETUP-<AGENT>` con queue lane dedicada

**Qué.** El final del wizard NO es "tu agent está creado". Es: AgentRail genera una `setup verification task` con identifier `LOCAL-SETUP-<NORMALIZED_AGENT_ID>` (status `in_progress`, asignada al nuevo agent, acceptance criteria autoexplicativas), y `agentrail doctor` exige que `GET /tasks/mine?status=in_progress` la devuelva — sólo entonces declara setup completo. Esa task tiene una lane dedicada en el scheduler (`setup_verification`, prioridad más baja) que sólo corre cuando no hay tasks reales pendientes.

**Dónde.**
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/setup-verification-task.ts` (todo el archivo)
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/managed-run-task-queue.ts:7,113-128,172-178` (lane priority `setup_verification: 3`, sólo runnable si no hay normalRunnable)
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/docs/architecture/local-self-hosted-setup-cli-contract.md:463-499` (success gate)

**Por qué inspira.** Apohara tiene Smart Attention pero no un "hello-world task que demuestra que el wiring completo funciona end-to-end". Una `apohara verify-setup` que enrolla en el ledger, dispara verification-mesh, llama a un provider, y produce un attempt verificable, prueba TODA la pila sin requerir input de usuario.

**Cómo traducir.** En el wizard de Apohara, después de crear roster + providers, generar una task seed (`SETUP-001`: "Echo 'apohara-ok' from each provider, judge approves") que ingresa por el flujo normal: decomposer → scheduler → providers → verification-mesh → consolidator → ledger entry. El `apohara doctor` exige que esta task complete con `verdict: approved` y `ledger_root` válido. Lane scheduler de baja prioridad.

**Valor.** Setup success gate empírico (no "el comando salió 0"); detecta regressions en wiring; demo path para nuevos usuarios.

---

### 6. Scheduler con lanes priorizadas + back-off entre normal/setup tasks

**Qué.** `buildManagedRunQueuePlan` clasifica cada task en uno de los lanes: `resume_in_progress` (0), `retry_after_feedback` (1), `start_new` (2), `setup_verification` (3). Reglas de selección: si hay AT LEAST ONE normal-lane runnable, las setup_verification se ignoran (`runnable = normalRunnable.length > 0 ? normalRunnable : setupRunnable`). Sorting compuesto: `lane → priority desc → dueAt asc → updatedAt asc → id asc`.

**Dónde.** `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/managed-run-task-queue.ts:49-204` (todo el archivo).

**Por qué inspira.** El scheduler de Apohara hace decomposition + dispatch, pero no veo en spec un orden de preferencia explícito como "resumir antes de empezar nuevo, retry-after-feedback antes que start_new". Este patrón evita que tasks long-running con review feedback queden hambrientas mientras la cola se llena de tasks nuevos.

**Cómo traducir.** En el scheduler Rust de Apohara: definir `enum Lane { ResumeInProgress, RetryAfterFeedback, StartNew, SetupVerification }` y la función `pick_next_task` aplica el lane-rank antes del priority/date sort. Implementar el "starvation guard" de setup tasks.

**Valor.** Workflow más fluido cuando un task está esperando review humano y llega un task nuevo; tasks viejas no se mueren.

---

### 7. Managed run reclaim policy: stale detection + supervisor restart-loop guard + escalación

**Qué.** Política con 6 knobs (`startingStaleAfterMs: 5min`, `runningStaleAfterMs: 90min`, `failureWindowMs: 1hr`, `maxInfrastructureFailures: 2`, `supervisorRestartWindowMs: 60s`, `supervisorMaxRestarts: 5`). Si un local runner desaparece, se reclama tras umbral conservador (PID muerto + tiempo). Si crashea repetidamente dentro de window, el supervisor pausa restarts automáticos. Cuenta de "infrastructure failures" → tras 2 en una hora, en vez de reintentar infinito, BLOQUEA la task para acción de usuario con razón `managed-run reclaim`.

**Dónde.**
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/managed-run-reclaim-policy.ts` (todo)
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/cli/local-runner-supervisor.ts:73-196` (`recordRestartAndShouldPause` + restartHistory + pausedAgents).
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/docs/integration-guide.md:536-571` ("Managed Run Reclaim Policy" section).

**Por qué inspira.** Worktree reliability ya está en spec, pero falta un anti-restart-loop explícito. Cuando un CLI provider (codex/claude --pure) falla por config rota, no queremos que apohara-sandbox crashee infinito. Y cuando un sandbox muere durante una run larga (90 min), debemos saber a partir de qué umbral reclaim es seguro.

**Cómo traducir.** En `apohara-sandbox` Rust crate: estructura `RunReclaimPolicy` con los mismos 6 knobs, leída de `~/.apohara/config.toml`. Función `should_pause_restarts(agent_id) -> bool` usando ring-buffer de timestamps. En vez de loop infinito, marcar la task como `blocked` con `block_reason: SandboxInfrastructureFailure` y mostrar al usuario el comando `apohara task resume <id>` para retomar después de reparar.

**Valor.** Anti-DDoS de tu propia máquina cuando un sandbox falla; mejor diagnóstico ("falló 2 veces en 1 hora, presumo problema sistémico, paso a humano").

---

### 8. Runner execution policy: presets `strict|balanced|advisory|external_sandbox` con dimensiones formalizadas

**Qué.** `RunnerExecutionPolicy` tiene 6 áreas: `filesystem` (worktree read/write, deny-globs como `.env`, `AGENTS.md`, `.agentrail/**`), `network` (`none|agentrail_local_only|allowlist|unrestricted` con `allowedHosts`), `credentials` (`inherit: "none"|"allowlist"`, `allowEnv` whitelist + `denyEnvPatterns` con wildcards `*TOKEN*`, `*SECRET*`), `publish` (`agentrail_owned|direct_allowed`), `commands` (deny list como `git push`, `gh pr create`, `agentrail tasks ship`), `externalSandbox` (wrap con comando externo tipo `bwrap`/`firejail`). Cada plan emitido reporta `enforcement[]` con `area`, `strength: enforced|partial|advisory|unsupported`, `critical: bool`. Modo `strict` rechaza plans con cualquier item `unsupported` o `partial+critical`. Snapshot de filesystem **antes y después** del run con SHA-256 detecta modificaciones a deny-write paths y los restaura si son recoverable (AGENTS.md, CLAUDE.md).

**Dónde.**
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/runner-execution-policy.ts` (todo, ~37k)
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/cli/index.ts:706-711` (flag `--runner-policy strict|balanced|advisory|external-sandbox`).

**Por qué inspira.** Esto es MUCHO más sofisticado que cualquier "permission patterns" actual de Apohara. Spec Apohara v1.0 menciona Permission patterns y apohara-sandbox como crate, pero no veo este nivel de presets formales + filesystem snapshots + recovery de archivos críticos.

**Cómo traducir.** En apohara-sandbox Rust: definir `RunnerPolicy { preset, filesystem: FsPolicy, network: NetPolicy, env: EnvPolicy, commands: CmdPolicy }` con normalización por preset. Antes del spawn de un CLI provider: snapshot SHA-256 de `apohara://protected-files` (AGENTS.md, CLAUDE.md, .apohara/**, .env*). Después del spawn: re-snapshot y diff; si hay cambios en deny-write paths, intenta restaurar desde snapshot; si no se puede, registra `policy_violation` y bloquea el attempt.

**Valor.** Defense-in-depth contra agents que escriben en lugares prohibidos por accidente; protección de archivos de instrucción del agent contra auto-modificación; presets que permiten gradual rollout (`advisory` para debugging, `strict` para producción).

---

### 9. Per-agent scoped API keys con vocabulario de scopes cerrado + rate limit por key

**Qué.** Vocabulario fijo de 14 scopes (`auth:admin`, `ci:read`, `events:read`, `providers:write`, `routing:admin`, `routing:evaluate`, `routing:read`, `reviews:read`, `ship:write`, `tasks:read`, `tasks:write`, `usage:read`, `webhooks:read`, `webhooks:write`). Cada API key tiene `rateLimit: { windowSeconds, maxRequests }` por key (no global). Endpoint `/agent-api-keys/{id}/usage` retorna `byScope[]`, `byOperation[]`, `currentWindow { startedAt, resetAt, used, remaining }`. Rotación con idempotency key. Bootstrap path: una key inicial `auth:admin` que sólo crea otras keys.

**Dónde.**
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/sdk/typescript/src/types.ts:5-19` (vocabulary cerrado)
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/agent-auth-store.ts:295-520` (normalize + rate limit window).
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/docs/integration-guide.md:480-491` (tabla scope-by-responsibility).

**Por qué inspira.** Apohara CLI wrappers (claude/codex/opencode) hoy heredan toda la config del usuario. Si en futuro Apohara expone HTTP API (para Tauri UI remoto, o para que terceros integren), el modelo de scoped keys + rate limit + usage tracking por key es el blueprint correcto.

**Cómo traducir.** Cuando Apohara internal MCP servers expongan auth (ya está en spec), aplicar scope vocabulary + rate limit por key. Persistir usage en orchestration DB SQLite. Comando `apohara key create --scope tasks:read,events:read --rate-limit 60s/600req`.

**Valor.** Least-privilege real; auditoría granular ("¿qué consumió tokens este mes?"); rate limit como circuit breaker contra runaway agents.

---

### 10. Webhook delivery worker con HMAC signing + exponential back-off (8 attempts) + 410 auto-disable

**Qué.** Worker con horario `DELIVERY_SCHEDULE_SECONDS = [0, 10, 30, 90, 300, 900, 1800, 3600]` (8 intentos, ~1.8 hours total). Cada delivery HTTP POST trae headers: `x-agentrail-subscription-id`, `x-agentrail-event-id`, `x-agentrail-event-type`, `x-agentrail-delivery-id`, `x-agentrail-delivery-attempt`, `x-agentrail-signature` (HMAC sha256 del raw body con `subscription.secret`). Response 2xx → delivered. Response **410 Gone** → desactiva subscription (`remote_gone`). Response 5xx → retry. Response 4xx (excepto 410) → failed final.

**Dónde.** `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/event-delivery-worker.ts:12,109-200` (todo el archivo).

**Por qué inspira.** Apohara tiene Agent-hooks HTTP loopback en spec — el patrón de delivery worker formal con back-off curve + HMAC + 410 semantics es directamente reutilizable. También es lo que apohara-bridge necesita para entregar updates a GitHub.

**Cómo traducir.** En Apohara `apohara-hooks` o como sidecar: `HookDeliveryWorker` con la misma curva `[0, 10, 30, 90, 300, 900, 1800, 3600]`, HMAC SHA-256 con secret por subscription, headers con `x-apohara-*`. Sticky semantics: 410 → desactiva, 5xx → reintenta, otros 4xx → failed. Persistir delivery records en orchestration DB.

**Valor.** Webhooks production-ready desde el día 1; suscriptores pueden auto-deregistrarse devolviendo 410; visibilidad de `attempt`/`deliveryId` en logs para debugging.

---

### 11. Telemetry con install-id anónimo + event allowlist + property denylist explícito

**Qué.** `~/.agentrail/config.json` tiene `telemetry: { enabled, installId: "inst_<random>", provider: "posthog", host: "https://eu.i.posthog.com" }`. Install ID generado una vez por home directory, reusado en CLI + server. Telemetry **enabled by default**, override por `AGENTRAIL_TELEMETRY_DISABLED=1`. Eventos en allowlist cerrada: `init_started`, `init_completed`, `provider_connect_*`, `doctor_*`, `agent_created`, `task_imported`, `task_routed`, `task_assigned`, `runner_wake_attempted`, `runner_started`, `runner_failed`, `pr_opened`, `ci_status_observed`, `review_status_observed`, `task_shipped`, `task_blocked`. **Properties denylist explícito**: NO se envían repo slug, GitHub username, Linear keys, issue title/body, PR title/body, branch name, commit SHA, file paths, source code, diffs, prompts, logs, env vars, secrets, tokens, raw payloads. Solo: provider name, runner type, routing mode, outcome category, failure category, duration bucket, counts. Failure categories normalizadas: `auth_failed`, `missing_permission`, `missing_webhook`, `missing_ci_config`, `provider_unreachable`, `runner_missing`, `runner_timeout`.

**Dónde.** `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/docs/superpowers/specs/2026-05-21-product-activation-telemetry-design.md` (todo el archivo, 8.6k).

**Por qué inspira.** Apohara aún no tiene telemetry surface definido. Esta especificación es un template completo y privacy-first que respeta el local-first ethos. El concepto de "activation telemetry" (¿completó setup? ¿corrió primera task? ¿llegó a PR?) es exactamente lo que Apohara necesita para entender drop-off.

**Cómo traducir.** Adoptar la misma estructura: `apohara telemetry status|on|off`. Generar `install_id` en init. Schema de eventos enfocado en activation milestones de Apohara: `init_started`, `roster_configured`, `first_decomposition`, `first_verification_pass`, `first_consolidation`, `first_ledger_commit`, `first_github_pr`. Denylist EXACTAMENTE igual (no enviar nada del repo del usuario). Adopter PostHog EU por defecto.

**Valor.** Privacy-respectful from day 1; debugging real de "dónde se atascan los usuarios"; precedente público que reduce fricción cuando se enable por default.

---

### 12. Two-track wake mechanism: SSE event stream + signed webhooks

**Qué.** Lifecycle events disponibles por DOS rutas paralelas:
- `GET /task-events/stream` SSE con `Last-Event-ID` para reconexión y replay desde cursor. Heartbeat configurable (`heartbeatSeconds`). Filter por `eventTypes` (csv) y `taskId`.
- `POST /event-subscriptions` registra webhook con secret HMAC. Worker entrega async con back-off (ver #10).

Polling es explícitamente "compatibility fallback only" — el modelo es push-first.

**Dónde.**
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/sdk/typescript/src/client.ts:225-280` (`streamEvents` AsyncGenerator con TextDecoder).
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/docs/integration-guide.md:527-535` ("Push Instead of Polling").

**Por qué inspira.** Apohara tiene Two-tier transcript pero no veo SSE stream para Tauri UI o para harnesses externos. Cuando agentes corren en background, el TaskBoard kanban + Tracker workflows necesitan updates push, no polling.

**Cómo traducir.** Apohara HTTP server expone `/events/stream` SSE con cursor (sequence number desde Orchestration DB). Tauri frontend conecta como cliente SSE y reactivamente actualiza TaskBoard. Misma data disponible por webhook subscription para integraciones externas. `Last-Event-ID` para resume tras desconexión.

**Valor.** UI Tauri reactiva sin polling; integraciones de terceros no necesitan polling; resume reliable tras desconexiones.

---

### 13. Task source repair endpoint: corrección de metadata sin recrear task

**Qué.** Endpoint `POST /tasks/{id}/source/repair` para corregir `task.source` metadata corrupto/incompleto (provider, owner, repo, branch, baseBranch, ciProvider, codeReviewPolicy, labels, pullNumber, prUrl, headSha) sin destruir history. CLI command `agentrail task source repair --task-id tsk_... --file source-patch.json`. Toda repair lleva `sourceRef` + `changeReason` + audit trail (`sourceAudit`). Validation: si pasás `owner` debés pasar `repo`; si normalizás a un source inválido, falla.

**Dónde.**
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/task-source-repair.ts` (todo)
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/README.md:144-148` (CLI).
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/cli/task-source-repair.ts` (5.6k).

**Por qué inspira.** Apohara tiene ledger SHA-256 immutable. Pero los metadata laterales de un attempt (ej.: cuál fue el provider que corrió, cuál era el branch, qué hash de prompt se usó) pueden necesitar corrección sin invalidar el ledger entry. Este pattern de "repair endpoint con audit trail" preserva inmutabilidad del log mientras permite enmiendas controladas.

**Cómo traducir.** En Apohara orchestration DB: tabla `task_metadata` separada de `ledger_entries`. Endpoint `apohara task metadata repair --task <id> --patch metadata.json --reason "corrected branch name after force push"`. Genera nuevo audit row con `prev_hash`, `new_value`, `change_reason`, `repaired_at`, `operator`. Ledger sigue inmutable.

**Valor.** Self-healing tras crashes o renames; reduce necesidad de truncate/recreate; deja paper-trail para forensics.

---

### 14. Run context envelope con next-action human-readable labels

**Qué.** Endpoint `/agent-runs/{runId}/context` retorna envelope con `run` (runId, agentId, runner, taskId, worktreePath, branchName), `task` (id, identifier, title, description, status, acceptanceCriteria, availableActions), y **`nextActions: Array<{ id, label }>`** donde el `label` es ya una frase humanizada lista para meter en un prompt: por ejemplo `submit` → `"Finish the code change, leave worktree changes in place, write the result file, then report completion."`, `fix` → `"Fix the task based on the latest CI or review feedback, then report completion."`, `resolve_blocker` → `"Report what is blocked and what user action is required."`. Hay TANTO HTTP endpoint COMO file-based fallback (`AGENTRAIL_RUN_CONTEXT_PATH`).

**Dónde.**
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/managed-run-context.ts:61-90` (`describeManagedRunAction`).
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/cli/run-context.ts` (CLI `agentrail run current` + `agentrail run actions`).

**Por qué inspira.** Apohara Dispatch preamble está en spec, pero este patrón de "scope tan compacto que el CLI provider sólo necesita 3 comandos: `apohara run current`, `apohara run actions`, `apohara agent report`" es lo que evita prompt sprawl. El child agent **NO** lee la API completa — sólo su run-scoped envelope. Y los labels human-readable van directo al prompt.

**Cómo traducir.** En CLI wrappers Apohara: cuando se dispatch un attempt a `claude --pure`, generar `~/.apohara/runs/<run-id>/context.json` con el envelope completo. El wrapper expone subcomandos `apohara run current` (muestra task + label-encoded actions) y `apohara run actions` (lista accionable). El child puede leer su asignación sin tener credenciales para listar OTHER tasks. Apohara-internal MCP server expone solo este scope al child.

**Valor.** Security: child no puede leer tasks que no le pertenecen. Token economy: prompt no incluye toda la API surface, solo "your assignment + how to proceed". Replayable: el context.json es la captura exacta de lo que recibió.

---

### 15. Landing page: anatomía de value props comunicables

**Qué.** El landing `landing-next/` (Next.js + Framer Motion + isometric SVG diagram) estructura los messages así:
- **Hero**: "Coding agents that **close tickets**, end-to-end" + 5-stage rail (Intake / Route / Claim / Review / Ship) con uno marcado "Active".
- **Problem (3 puntos)**: (i) "No lifecycle, just a prompt and a prayer", (ii) "PATs with full repo scope — one compromised run exposes everything", (iii) "CI is a wall, not a feedback loop".
- **BeforeAfter**: diagrama isométrico N×M chaos vs rail-connected.
- **Capabilities (8 primitives grid)**: Tasks · Issue Intake · CI Feedback · Scoped Auth · Event Stream · Webhooks · Review Feedback · Routing Engine — cada uno con endpoint mostrado `POST /v1/tasks`.
- **Lifecycle (5 stages tabs)**: cada uno con code snippet TS.
- **SDK**: "A typed SDK, not a wrapper" + ESM/CJS.
- **Compare table**: OSS vs Cloud feature-by-feature con "Coming soon" badges.
- **Quote**: *"The bottleneck isn't AI writing code. It's AI navigating the systems around code"*.

**Dónde.**
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/landing-next/components/Hero.tsx`
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/landing-next/components/Problem.tsx`
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/landing-next/components/Capabilities.tsx`
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/landing-next/components/Lifecycle.tsx`
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/landing-next/components/Compare.tsx`
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/landing-next/components/SDK.tsx`

**Por qué inspira.** Cuando Apohara tenga landing, el patrón `Problem (3 puntos sharp)` → `Capabilities (8 primitives grid)` → `Lifecycle (numbered stages con code)` → `Compare (free vs paid)` es directamente reusable. Especialmente la decisión de **mostrar endpoints HTTP en la grid de capabilities** ("POST /v1/tasks") comunica que es una API real, no marketing.

**Cómo traducir.** Estructura para apohara.dev:
- **Problem**: (i) "Single-AI orchestration is fragile when one provider rate-limits or hallucinates", (ii) "Verification is conflated with critique — judges and critics need separation", (iii) "Ledgers are spreadsheets, not append-only SHA-256 chains".
- **Capabilities**: 8 primitives — Decomposer · Scheduler · Verification-Mesh (judge≠critic) · Ledger SHA-256 · Consolidator · CLI Wrapper · GitHub Bridge · Tauri UI.
- **Lifecycle**: 5 stages — Specify → Decompose → Verify → Consolidate → Ship.
- **Compare** OSS Apohara vs (futuro) Apohara Cloud.

**Valor.** Comunicación que vende sin sobre-prometer; baseline visual para diseñadores; reduce 4-6 semanas de iteración en landing copy.

---

### 16. Boundary OSS vs Cloud explicito en docs (`docs/cloud.md`)

**Qué.** Documento que define qué partes son OSS (local control plane, SDKs, adapters, CLI, single-instance runtime) vs qué partes son Cloud-only (managed connectors, OAuth apps, durable shared run history, fleet routing, SSO/RBAC/SCIM, audit logs, dashboards, support, compliance). Reglas explícitas de messaging: "Say 'local OSS', 'self-managed OSS', or 'single-instance self-hosting'... Do not claim live provider, SLA, compliance, or production readiness unless the current implementation and validation gates support the claim." Lista negra de features que **NO deben volverse turnkey OSS** (multi-tenant workspace service, hosted OAuth apps, cloud provider reconciliation, governed cross-agent memory) — define el moat.

**Dónde.** `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/docs/cloud.md` (todo).

**Por qué inspira.** Apohara va a enfrentar tensión OSS vs comercial — definir ANTES qué se queda local y qué eventualmente vive en Apohara Cloud evita compromises tóxicos. El moat de "ops complexity for teams" (managed connectors, audit, dashboards) es exactamente el mismo de Apohara.

**Cómo traducir.** Crear `docs/cloud-boundary.md` en Apohara que define:
- OSS: orchestrator, decomposer, scheduler, verification-mesh, ledger, consolidator, CLI wrappers, single-instance Tauri.
- Cloud: hosted multi-machine orchestration, governed cross-attempt memory across teams, hosted OAuth (GitHub App como producto operado), team audit logs, fleet dashboards, SLAs.
- Lista negra: features que NO migran a Cloud-only (el ledger SHA-256 debe seguir local-first).

**Valor.** Prevenir scope creep ambos lados; mensaje honesto con la community; protege ventaja competitiva sin estrangular adopción.

---

### 17. `agentrail doctor` con `--skip-routing-check` flag y check de runner policy compilable

**Qué.** Doctor agrupa checks en taxonomía clara: `health`, `auth`, `profile`, `routing`, `ai_routing`, `runner_policy`, `assigned_task_visibility`. Cada check retorna `{ id, ok, summary }`. El check `runner_policy` no solo valida config — **compila el execution plan** con la policy actual (`compileRunnerExecutionPlan`) y valida que el plan sea ejecutable (`validateRunnerPolicyPlan`). Eso detecta runner+policy combinations imposibles (ej. `runner: cursor + sandbox preset: external_sandbox` sin executable). Flag `--skip-routing-check` permite doctor parcial cuando setup todavía no completó routing.

**Dónde.**
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/cli/doctor.ts:71-86` (taxonomía).
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/src/cli/doctor.ts:19-20` (importa `compileRunnerExecutionPlan`).
- README `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/agentrail/README.md:64-70` ("`doctor` is the success gate").

**Por qué inspira.** `apohara doctor` debe verificar no sólo "Bun está instalado" sino "el plan que voy a ejecutar con esta policy ES compilable y ejecutable". Compilar el plan en dry-run es más fuerte que un binary check.

**Cómo traducir.** `apohara doctor` con secciones: `runtime` (Bun version), `roster` (providers reachable, models accessible), `policy` (compile dry-run plan para cada runner+preset combo), `sandbox` (apohara-sandbox crate operacional), `ledger` (DB writable, hash chain válido), `mcp` (internal MCP servers responsivos). Cada uno con `--skip-<section>` para CI partial checks.

**Valor.** Detecta config inválida antes de que el primer task falle; permite onboarding incremental ("ya está doctor:runtime ok; vamos al próximo paso").

---

## Hallazgos secundarios — no priorizar pero notar

- **`structuredClone` everywhere para inmutabilidad defensiva** en stores Node — Rust ya tiene esto via Clone/borrow, pero el patrón de "siempre clonar al retornar" evita aliasing bugs.
- **NDJSON event store + JSON state store** (`.agentrail/events.ndjson` + `.agentrail/state.sqlite`) — append-only event log + materialized view en SQL — patrón CQRS lite que podría aplicarse al ledger Apohara para evitar lock contention.
- **`tokenBudgetHint: "compact" | "standard"` en responses** — header de meta para que el cliente sepa si la respuesta fue truncada (`truncatedFields[]`) y considere paginar — útil para Tauri UI cuando muestra task lists grandes.
- **`isSetupVerificationTask(identifier)` por prefix `LOCAL-SETUP-`** — convención de naming para identificar tasks especiales sin metadata extra.

---

## Priorización sugerida para Apohara v1.0

**Alta prioridad (estructurales):**
1. `availableActions[]` (#1) — afecta TODOS los contratos
2. Two-track push events SSE + webhooks (#12) — UI Tauri reactiva
3. Per-agent scoped keys + scope vocabulary (#9) — security baseline
4. Runner execution policy presets (#8) — defense-in-depth real
5. Cloud boundary doc (#16) — define el moat ANTES

**Media prioridad (calidad de vida):**
6. Severity vocabulary `must_fix|should_fix|note` (#2)
7. Scheduler con lanes priorizadas (#6)
8. Run context envelope + action labels (#14)
9. Webhook delivery worker (#10)
10. Telemetry privacy-first (#11)

**Baja prioridad pero valiosa:**
11. Idempotency-key embebido en PR body (#3) — para github-bridge
12. Two-tier provider connect/doctor (#4)
13. Setup verification task + doctor gate (#5)
14. Managed run reclaim policy (#7)
15. Task source repair (#13)
16. Doctor con plan-compile check (#17)
17. Landing structure (#15) — cuando tengamos site

Total: 17 hallazgos NUEVOS sustantivos. AgentRail es un excelente reference porque enfrenta exactamente el mismo problema (agent lifecycle plumbing) con stack distinto, lo que hace que los patrones de contrato sean cleanly reportables sin copiar código.