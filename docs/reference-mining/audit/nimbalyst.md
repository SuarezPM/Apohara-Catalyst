> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

# Audit: nimbalyst (45 sub-findings, 41 canónicos)

> Cruz cada hallazgo de `docs/reference-mining/nimbalyst.md` contra el código actual de Apohara.
> Audit ejecutado 2026-05-22 sobre `feat/apohara-v1` HEAD.

## Resumen

| Status | Cantidad |
|---|---:|
| ✅ COMPLETO | 12 |
| 🟡 PARCIAL | 22 |
| ❌ NO IMPLEMENTADO | 10 |
| 🚫 RECHAZADO | 0 |
| ❓ AMBIGUO | 1 |
| **Total** | **45** |

> Nota sobre el conteo: nimbalyst.md tiene 45 sub-findings numerados (1.1-1.7, 2.1-2.4, 3.1-3.4, 4.1-4.4, 5.1-5.4, 6.1-6.3, 7.1-7.3, 8.1-8.8, 9.1-9.2, 10.1-10.3, 11.1-11.2, 12.1) aunque el footer del reporte dice 41. La tabla de adopción del spec §11 lista 39 (omite #4.3, #5.3, #5.4, #3.3, #3.4, #8.8). Este audit cubre los 45 individualmente.

---

## Hallazgos por categoría

### Categoría 1: Provider Driver Architecture

#### Hallazgo 1.1: `BaseAgentProvider` como capa intermedia compartida

- **Origen nimbalyst**: `packages/runtime/src/ai/server/providers/BaseAgentProvider.ts` + mixins.
- **Apohara actual**: `src/core/providers/BaseAgentProvider.ts` (95 LOC) + `src/core/providers/mixins/ProviderSessionManager.ts`.
- **Status**: ✅ COMPLETO
- **Evidencia**: `BaseAgentProvider.ts` es una abstract class con `id/displayName/roles/protocol`, hace env sanitization, trust preset application, session-id mapping vía `ProviderSessionManager`, y delega createSession al protocol. Comentario en línea 2 cita nimbalyst #1.1 explícitamente.
- **Recomendación**: n/a

#### Hallazgo 1.2: `ProtocolInterface` para normalizar SDKs heterogéneos

- **Origen nimbalyst**: `packages/runtime/src/ai/server/protocols/ProtocolInterface.ts` + 6 impls.
- **Apohara actual**: `src/core/providers/protocols/AgentProtocol.ts` (48 LOC) + 3 impls (Claude/Codex/OpenCode).
- **Status**: 🟡 PARCIAL
- **Evidencia**: Interface `AgentProtocol` con `createSession/resumeSession/forkSession/sendMessage/abortSession`, `ProtocolEvent` como discriminated union (text/tool_call/tool_result/reasoning/usage/compact_boundary/permission_request/complete). Pero las 3 impls (`ClaudeCodeProtocol.ts`, `CodexProtocol.ts`, `OpenCodeProtocol.ts` — 20-21 LOC cada una) son SCAFFOLDS — `createSession` retorna `{ providerId: '<provider>-' + Date.now() }`, `sendMessage` yields un único `{ kind: 'complete' }`.
- **Gap**: Falta integración real con los CLIs upstream (claude-sdk, codex-acp, opencode acp/ndjson). El driver real vive en `src/providers/cli-driver.ts` y NO implementa `AgentProtocol`. El scheduler/runner llama al driver legacy, no al protocol.
- **Recomendación**: cerrar el loop reemplazando los stubs por wrappers reales sobre `cli-driver.ts` para que BaseAgentProvider.spawn realmente dispare CLIs. Tarea probable: Sprint 4 / refactor "providers via Protocol".

#### Hallazgo 1.3: Tres patrones de implementación claramente categorizados

- **Origen nimbalyst**: `docs/AI_PROVIDER_TYPES.md`.
- **Apohara actual**: spec §4.5 menciona los buckets, pero NO existe `apohara/docs/PROVIDER_PATTERNS.md` standalone.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `find apohara-v1-impl/docs -name "PROVIDER*"` → 0 hits.
- **Recomendación**: extraer `docs/PROVIDER_PATTERNS.md` con los 3 buckets + "Suggested Templates" más un cuarto bucket "Cloud HTTP wrappers" si vuelve a entrar en roster.

#### Hallazgo 1.4: Static Dependency Injection bucket

- **Origen nimbalyst**: `packages/runtime/src/ai/server/providers/claudeCode/dependencyInjection.ts`.
- **Apohara actual**: `src/core/providers/deps.ts` (38 LOC).
- **Status**: ✅ COMPLETO
- **Evidencia**: Módulo-nivel `ApoharaDeps` interface con `hookEndpoint()`, `indexerSocketPath`, `ledgerPath`, `capabilityStatsPath`. `setApoharaDeps()` setter + `getApoharaDeps()` con guard "not initialized". `resetApoharaDeps()` para tests. `BaseAgentProvider.ts:50` lo consume. Comentario en línea 2 cita nimbalyst #1.4.
- **Recomendación**: n/a

#### Hallazgo 1.5: Sanitización defensiva de API keys del environment

- **Origen nimbalyst**: `claudeCode/sdkOptionsBuilder.ts` líneas 253-255.
- **Apohara actual**: `src/core/persistence/envSanitizer.ts` (119 LOC) + `crates/apohara-sandbox/src/runner/imp.rs::build_sanitized_env`.
- **Status**: ✅ COMPLETO
- **Evidencia**: `sanitizeEnv()` con `DEFAULT_BLOCKLIST` de ~50 patterns regex cubre provider keys, cloud creds, PaaS tokens, DB URLs con creds embebidos, CI tokens, webhook tokens. `BaseAgentProvider.ts:46` y `cli-driver.ts` (mencionado en AGENTS.md incident log) lo usan. AGENTS.md §"NEVER pass `process.env`" documenta el incident.
- **Recomendación**: n/a

#### Hallazgo 1.6: Persistent prompt stream

- **Origen nimbalyst**: `claudeCode/sdkOptionsBuilder.ts` líneas 72-118.
- **Apohara actual**: `src/core/providers/streams/persistentStdin.ts` (66 LOC).
- **Status**: 🟡 PARCIAL
- **Evidencia**: `createPersistentPromptStream<T>()` returns `{ iter, controller }` con `writeMessage(msg)` + `end(reason: "completed"|"aborted"|"interrupted")`. Implementación matches el spec.
- **Gap**: ningún consumer real lo usa todavía — `cli-driver.ts` sigue spawneando con stdin no-persistent. Esto será relevante recién cuando los protocols del 1.2 se conecten al cliente real.
- **Recomendación**: instrumentar al menos `ClaudeCodeProtocol` para que utilice esta primitiva cuando se conecte el SDK real (correlacionado con 1.2).

#### Hallazgo 1.7: `AgentMessageWriteQueue` con coalescing 200ms idle / 200 rows

- **Origen nimbalyst**: `packages/runtime/src/storage/repositories/AgentMessageWriteQueue.ts`.
- **Apohara actual**: `src/core/providers/streams/eventWriteQueue.ts` (83 LOC).
- **Status**: 🟡 PARCIAL
- **Evidencia**: `EventWriteQueue` con `idleFlushMs`, `thresholdRows`, `enqueue/enqueueAwaited`, pressure logging cuando depth > 500 o flush > 200ms. Inflight chain con `.catch` recovery.
- **Gap**: el ledger en `src/core/ledger.ts` NO usa este queue — appendea evento por evento con su propio `writeQueue: Promise<void>` interno (línea 50). Coalescing real al ledger sigue sin existir; chain hash sigue calculado event-by-event vs el "Merkle node por batch" recomendado.
- **Recomendación**: integrar `EventWriteQueue` en `EventLedger` (probablemente Stage 9+); decidir hashing strategy (chain por event vs merkle por batch).

---

### Categoría 2: Session / Worktree Lifecycle

#### Hallazgo 2.1: Two-layer session invariant

- **Origen nimbalyst**: `docs/SESSION_HIERARCHY.md`.
- **Apohara actual**: spec §4 menciona "Two-layer session/DAG hierarchy invariant"; sin doc dedicado.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `find docs -name "DAG_HIERARCHY*"` → 0 hits. Decomposer (`src/core/decomposer.ts`) no enforça depth máximo; consolidator tampoco. No hay migration que normalice runs viejos.
- **Recomendación**: redactar `docs/DAG_HIERARCHY.md` y agregar enforcement triple en decomposer + consolidator + replay migration; relevante cuando lleguen sub-DAGs reales (Sprint 4+).

#### Hallazgo 2.2: WorktreeReliability — 9 failure modes

- **Origen nimbalyst**: `docs/WORKTREE_RELIABILITY_IMPROVEMENTS.md`.
- **Apohara actual**: `src/core/worktree-manager.ts` (334 LOC) + `crates/apohara-worktree`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: `WorktreeManager` cubre subset: in-process pool (acquire/release), filesystem lifecycle (create/adoptOrphan/restoreToProjectRoot/cleanup/list/pruneStale), lock files con `ADOPT_LOCK_AGE_MS` y `PRUNE_LOCK_GRACE_MS`, name pattern enforcement. `pruneStale` GC.
- **Gap**: faltan explícitamente #1 (DB-Git inconsistency on create), #3 (squash destructive sin backup branch), #4 (per-repo operation lock — Map<repoPath, Promise>), #5 (archive queue persistido para crash recovery), #6 (stash-pop failure paths), #7 (startup consistency check), #8 (deletion verificando git index).
- **Recomendación**: implementar al menos el #7 (startup consistency check) antes de cualquier `apohara replay` sobre runs viejos para evitar fork del estado; el resto se puede cerrar en una iteración dedicada.

#### Hallazgo 2.3: `crystal-run.sh` worktree-aware build cache

- **Origen nimbalyst**: `crystal-run.sh` líneas 18-100.
- **Apohara actual**: ningún script equivalente.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `find scripts -type f` → checksum/demo/postinstall/scaffold/install/hooks; nada de worktree bootstrap. Spec §7.5.4 menciona el patrón pero no se materializó.
- **Recomendación**: implementar `scripts/worktree-bootstrap.sh` (o comando Rust en `apohara-worktree`) con content-hash de `package.json + bun.lockb + src/` antes de cada `bun install` en worktrees. Performance crítico cuando scheduler spawnea N worktrees.

#### Hallazgo 2.4: Adjective-noun naming + idempotent retry on collision

- **Origen nimbalyst**: `docs/WORKTREES.md` líneas 86-103.
- **Apohara actual**: `src/core/worktree-manager.ts` `randomSlug()` (líneas 78-107).
- **Status**: 🟡 PARCIAL
- **Evidencia**: Adjective-noun-hex (hopeful-newton-a1b2c3) implementado y matched por `WORKTREE_NAME_PATTERN: /^[a-z]+-[a-z]+-[0-9a-f]{6}$/`. Las tablas son chicas (10 + 10).
- **Gap**: NO hay retry en collision; `create()` no chequea si el dir ya existe (a depender del hex de 6 chars). Race condition aún posible cuando 2 spawns concurrentes generan mismo slug (probabilidad baja pero no idempotente como nimbalyst).
- **Recomendación**: envolver `create()` en retry-on-EEXIST (max 3) + tablas más grandes (adjectives/nouns de 30+ cada una) para reducir colisión.

---

### Categoría 3: Interactive Prompts & Verification Mesh

#### Hallazgo 3.1: Durable interactive prompts

- **Origen nimbalyst**: `docs/INTERACTIVE_PROMPTS.md`.
- **Apohara actual**: `src/core/safety/durablePrompt.ts` (85 LOC).
- **Status**: 🟡 PARCIAL
- **Evidencia**: `DurablePromptStore` con `enqueueRequest/setResponse/waitForResponse` poll-based (10 min timeout, 100ms poll). Comment en línea 5-9 dice "Stage 5 ships an in-memory implementation; Stage 8 will swap the backing store for the JSONL ledger so prompts survive React unmount/remount".
- **Gap**: hoy es in-memory only — un restart del bun process pierde todos los pending prompts. Esto rompe el invariante de "prompt persiste a través de remount/restart" de nimbalyst.
- **Recomendación**: completar el swap a ledger (Stage 8 prometido) antes de cualquier scenario de replay/recovery; sin esto, "apohara replay <run-id>" no puede reproducir prompts.

#### Hallazgo 3.2: Prompt ID alias resolution centralizado

- **Origen nimbalyst**: `codexToolCallResolver.ts`.
- **Apohara actual**: no existe.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `grep "promptIdResolver|prompt_id"` → 0 hits.
- **Recomendación**: deferred — se vuelve crítico cuando un mismo prompt cruza judge+critic+ledger (verification mesh maduro). Por ahora los 3 active providers usan un solo ID space.

#### Hallazgo 3.3: Two-channel waker (exact + session-fallback)

- **Origen nimbalyst**: `docs/INTERACTIVE_PROMPTS.md` líneas 80-90.
- **Apohara actual**: no existe.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `grep "two_channel|fallback channel|wait.*fallback"` → 0 hits. Spec §11 no lo cita.
- **Recomendación**: ignorar hasta que el verification-mesh tenga interacciones async cross-pane reales (probable v1.1+).

#### Hallazgo 3.4: PostMessage polling con exponential backoff

- **Origen nimbalyst**: `BaseAgentProvider.ts` líneas 166-255.
- **Apohara actual**: `durablePrompt.ts` poll cada 100ms FIJO; `isolation.ts:38` usa backoff 1s/4s/16s.
- **Status**: 🟡 PARCIAL
- **Evidencia**: `durablePrompt.ts:47-66` polls fijo cada 100ms hasta el timeout 10min — no exponential.
- **Gap**: bajo carga muchos prompts en parallel queman CPU con poll cada 100ms; no hay exponential backoff (500ms → 5s × 1.5) ni cap de messages buscados.
- **Recomendación**: cuando `durablePrompt` se swap a ledger-backed (3.1), implementar backoff exponencial 500ms→5s.

---

### Categoría 4: Permission System

#### Hallazgo 4.1: Pattern-based permission cache con scopes

- **Origen nimbalyst**: `docs/AGENT_PERMISSIONS.md` + `ToolPermissionService.ts`.
- **Apohara actual**: `src/core/safety/{patterns,permissionCache,permissionService,settingsHierarchy}.ts`.
- **Status**: ✅ COMPLETO
- **Evidencia**: `PermissionScope = "once"|"session"|"always"`. `PermissionService.check()` deny→cache→settings→ask. `PermissionCache` Map<sessionId, Set<pattern>> in-memory para scope=session. `parsePatternString` parsea `Bash(npm test:*)`, `WebFetch(domain:X)`, `Edit(glob)`, `mcp__server__*`. `matchPattern` evalúa con minimatch y normaliza paths.
- **Recomendación**: n/a

#### Hallazgo 4.2: Compound command splitter

- **Origen nimbalyst**: `BashCommandAnalyzer.ts`.
- **Apohara actual**: `src/core/safety/bashCompoundAnalyzer.ts` (180 LOC).
- **Status**: ✅ COMPLETO
- **Evidencia**: `splitCompound()` parser-aware: maneja quotes (single/double), command substitution `$(...)`, backticks, process substitution `<(...)`/`>(...)`, separators `&&|||;|`, newlines, escaped chars. `permissionService.ts:38-45` aplica scopes=["once"] sólo para compound (no "always" leak).
- **Recomendación**: n/a

#### Hallazgo 4.3: Garbage pattern filtering

- **Origen nimbalyst**: `docs/AGENT_PERMISSIONS.md` líneas 448-454.
- **Apohara actual**: `src/core/safety/patternValidator.ts` (29 LOC).
- **Status**: ✅ COMPLETO
- **Evidencia**: `GARBAGE` regex lista bloquea `Bash(const:*)`, `Bash([]:*)`, `Bash(//:*)`, `Bash(```:*)`, `Bash(import:*)`, `Bash(function:*)`, `Bash(class:*)`, `Bash(export:*)`, `Bash(let:*)`, `Bash(var:*)`. `isValidPattern()` también enforça `SHAPE` regex de tools válidos. Spec §11 no lista este hallazgo pero está implementado de todas formas.
- **Recomendación**: n/a

#### Hallazgo 4.4: Three-tier settings hierarchy

- **Origen nimbalyst**: `docs/AGENT_PERMISSIONS.md` líneas 290-320.
- **Apohara actual**: `src/core/safety/settingsHierarchy.ts` (45 LOC).
- **Status**: 🟡 PARCIAL
- **Evidencia**: `SettingsTier` con sources `user_global|project_shared|project_local`. `mergeSettingsTiers()` merges allow+deny con `trustProject` flag — defensive default: untrusted projects NO contribuyen a allow (sólo deny). Bonus de seguridad sobre nimbalyst (hostile repo no escala permisos).
- **Gap**: no se ve loader que efectivamente lea `~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json` y materializa los 3 tiers. Sólo está la fn merge — falta el "wire" desde archivos al merger.
- **Recomendación**: agregar `loadSettingsTiers(workspacePath)` que materialize los 3 archivos antes de pasarlos a `mergeSettingsTiers`. Sin esto la hierarchy es virtual.

---

### Categoría 5: Transcript / Event Pipeline

#### Hallazgo 5.1: Two-tier append-only log + derived canonical events

- **Origen nimbalyst**: `docs/TRANSCRIPT_ARCHITECTURE.md`.
- **Apohara actual**: `src/core/ledger.ts` + `src/core/orchestration/messages.ts`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: Tier 1 (raw append-only ledger) EXISTE — `ledger.ts` con SHA-256 chain, genesis, hash chain. Tier 2 (canonical projection) NO existe — no hay `TranscriptTransformer`, no hay watermark `canonical_last_raw_event_id`, no hay `CURRENT_VERSION` para re-transform.
- **Gap**: replay actual reconstruye estado from raw event-by-event; SwarmCanvas/TaskBoard re-parsean cada vez. Sin canonical projection no se puede hacer FTS/search ni mobile-style sync (aunque éstos están en v1.1+).
- **Recomendación**: agregar `src/core/ledger/projector.ts` con event-type-aware projection cuando lleguen las features de SwarmCanvas / TaskBoard real-time (Stage 9+).

#### Hallazgo 5.2: Provider-agnostic canonical events (parsers as pure functions)

- **Origen nimbalyst**: `IRawMessageParser.ts` + per-provider impls.
- **Apohara actual**: no existe.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `grep "RawMessageParser|ParserContext|providerParser"` → 0 hits. El `cli-driver.ts` directamente escribe respuestas — no hay parser pure-function-style.
- **Recomendación**: deferred junto con 5.1 — sin Tier 2 canonical, no hay punto donde plug-in parsers per-provider.

#### Hallazgo 5.3: Per-step usage vs cumulative usage distinction

- **Origen nimbalyst**: `docs/CONTEXT_WINDOW_USAGE_TRACKING.md`.
- **Apohara actual**: `ProtocolEvent` (AgentProtocol.ts:38) tiene `{ kind: "usage"; stepUsage: TokenUsage; cumulativeUsage: TokenUsage }`. `crates/apohara-token-accounting/src/lib.rs` es placeholder ("Placeholder until Stage 2+ implementations").
- **Status**: 🟡 PARCIAL
- **Evidencia**: Schema tipado existe en `AgentProtocol.ts` con la distinción. Pero no hay consumer ni el crate Rust está implementado.
- **Gap**: nada consume `stepUsage` vs `cumulativeUsage`; TopBar/cost meter (mencionado en spec) no existe en la UI desktop aún. `apohara-token-accounting` está vacío.
- **Recomendación**: implementar el crate Rust + UI cost meter cuando la integración real de protocols esté lista (correlacionado con 1.2). Schema ya está listo.

#### Hallazgo 5.4: Compact-boundary handling

- **Origen nimbalyst**: `docs/CONTEXT_WINDOW_USAGE_TRACKING.md` líneas 52-71.
- **Apohara actual**: `ProtocolEvent` declara `{ kind: "compact_boundary" }` pero no hay consumer.
- **Status**: 🟡 PARCIAL
- **Evidencia**: Schema present en `AgentProtocol.ts:39`. `grep "compact_boundary"` → solo 1 match (la declaración).
- **Gap**: ningún parser emite el evento; ningún listener resetea `lastAssistantUsage`. Schema sin behaviour.
- **Recomendación**: cuando Claude/Codex protocols se conecten al CLI real, hacer que emitan compact_boundary en `/compact` y un listener en el TopBar/cost meter consuma.

---

### Categoría 6: IPC / Centralized Listener Architecture

#### Hallazgo 6.1: Centralized IPC listeners

- **Origen nimbalyst**: `docs/IPC_GUIDE.md` líneas 96-181.
- **Apohara actual**: `src/store/listeners/index.ts` (63 LOC) + `runListeners.ts`.
- **Status**: ✅ COMPLETO
- **Evidencia**: `ListenerRegistry` clase singleton con `register/dispatch/reset`. Comentario en línea 2-10 cita el spec §0.1 y la rule "React components NEVER subscribe to Tauri events directly". `dispatch()` snapshotea el set para evitar concurrent-mutation. Try/catch en cada handler. `spec.watcher.ts:44` usa `listenerRegistry.dispatch("apohara://plan-changed", ...)`.
- **Recomendación**: n/a

#### Hallazgo 6.2: `workspacePath` como parámetro requerido

- **Origen nimbalyst**: `docs/IPC_GUIDE.md` líneas 192-258.
- **Apohara actual**: `BaseAgentProvider.spawn(opts)` requiere `workspacePath: string`; `trust-presets.ts:48` lo requiere.
- **Status**: 🟡 PARCIAL
- **Evidencia**: providers respetan; Tauri commands en `packages/desktop/src-tauri/src/lib.rs:19` aún sin auditar comprehensively.
- **Gap**: no se confirmó que TODOS los Tauri `#[tauri::command]` reciban workspace path explícito; el principio está en el spec pero no hay ESLint/clippy lint que lo enforce.
- **Recomendación**: revisar cada `#[tauri::command]` y los IPC handlers TS para asegurar el param; agregar lint rule en CI.

#### Hallazgo 6.3: `safeHandle` / `safeOn` wrappers

- **Origen nimbalyst**: `.claude/rules/main-process-init.md`.
- **Apohara actual**: ninguno.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `grep "safeHandle|safe_handle|apohara_command!"` → 0 hits en `packages/desktop/src-tauri/src/`.
- **Recomendación**: cuando el set de Tauri commands crezca (Stage 7+), crear un macro `apohara_command!` con validation + logging + structured Result. Hoy hay solo 1 command (línea 19), low priority.

---

### Categoría 7: Internal MCP Servers / Tool Catalog

#### Hallazgo 7.1: Internal MCP servers (in-process, localhost-only, port-injected)

- **Origen nimbalyst**: `docs/INTERNAL_MCP_SERVERS.md`.
- **Apohara actual**: `src/core/mcp/base/McpServer.ts` + 5 servers en `src/core/mcp/servers/`.
- **Status**: ✅ COMPLETO
- **Evidencia**: `McpServer` base class con `Bun.serve` localhost (127.0.0.1), bearer auth con `timingSafeEqual` constant-time comparison (resistente a timing attacks), rate limiting via `TokenBucket`, audit logger, payload size limit 64KB. Servers: `apohara-ledger` (read_events/replay_run/get_last_event/search_events), `apohara-runs`, `apohara-settings`, `apohara-indexer`, `apohara-commit`.
- **Recomendación**: n/a

#### Hallazgo 7.2: Settings Control MCP server con allow-list / deny-list / rate-limit / audit

- **Origen nimbalyst**: `SettingsControlService.ts`.
- **Apohara actual**: `src/core/mcp/servers/apohara-settings.ts` (97 LOC).
- **Status**: 🟡 PARCIAL
- **Evidencia**: `SETTING_ALLOWLIST` (ui.theme/ui.density/roster.preferred/cost.dailyBudget), `SETTING_DENYLIST` (providers.apiKeys/providers.oauth/github.appPrivateKey). Kill switch via `APOHARA_MCP_SETTINGS_DISABLED=1`. Persist via `atomicWriteJson`.
- **Gap**: NO hay rate-limit específico (depende del global de `McpServer`); NO hay audit dedicated separado del audit general; NO hay "meta-agent excluded" gate.
- **Recomendación**: agregar audit specific (`settings_change`) al ledger y rate-limit-30/60s específico antes de exponer a meta-agents.

#### Hallazgo 7.3: Custom tool widgets registry

- **Origen nimbalyst**: `CustomToolWidgets/index.ts`.
- **Apohara actual**: `packages/desktop/src/components/ToolWidgets/registry.ts` + 4 widgets.
- **Status**: ✅ COMPLETO
- **Evidencia**: `REGISTRY` mapea Edit/Write/MultiEdit→EditWidget, Bash→BashWidget, mcp__apohara__read_ledger/list_runs→LedgerReadWidget. `resolveWidget()` fallback a `GenericJsonWidget`. Comentario línea 2-7 cita nimbalyst #7.3.
- **Recomendación**: n/a

---

### Categoría 8: DevEx & Testing

#### Hallazgo 8.1: Plan documents as markdown-with-frontmatter

- **Origen nimbalyst**: `docs/PLANNING_SYSTEM.md` + `PlanStatusPlugin/`.
- **Apohara actual**: `src/core/spec/{planDocuments,watcher,planStatusCache}.ts`.
- **Status**: ✅ COMPLETO
- **Evidencia**: `PlanDocument` interface con planId (sha1 of filepath+title), title, status (draft|active|paused|done), planType, priority, owner, stakeholders, tags, created, updated, progress, agentSessions, objective, acceptanceCriteria, outOfScope, context. `parsePlanDocument()` parses YAML frontmatter + body sections. `PlanStatusCache` con mtime+size fast path + full-file SHA secondary check. `startPlanWatcher()` con chokidar + debounce + `awaitWriteFinish` para evitar racing on partial writes.
- **Recomendación**: n/a

#### Hallazgo 8.2: Tracker workflows (decision / bug items)

- **Origen nimbalyst**: `docs/TRACKER_WORKFLOWS.md`.
- **Apohara actual**: `.apohara/trackers/decisions/TEMPLATE.md` + `.apohara/trackers/bugs/TEMPLATE.md`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: Templates con frontmatter (id, status, authors, related_runs, supersedes/superseded_by) + secciones Context/Alternatives/Reasoning/Trade-offs/Consequences. `.gitkeep` files indican que la estructura existe.
- **Gap**: no hay CLI command `apohara tracker create|list|search`; no hay MCP tool `tracker_create`; no hay tracker_list({ type: decision, search: "..." }) anti-recurrence query.
- **Recomendación**: implementar `apohara tracker` CLI (`create`, `list --type`, `search`) + MCP tool en `apohara-mcp-bridge` para que el agent pueda log decisions antes de re-decidir.

#### Hallazgo 8.3: End-to-end verification rule

- **Origen nimbalyst**: `.claude/rules/end-to-end-verification.md`.
- **Apohara actual**: `PRINCIPLES.md` §3 (INV-15) + `AGENTS.md` past incidents.
- **Status**: 🟡 PARCIAL
- **Evidencia**: INV-15 JCR gate (judge/critic/invariants) está documentado y enforce en spec §0.5. `AGENTS.md` lista 5 past incidents (env leak, fs.watch atomic-rename, spawn serialization, PTY echo, opencode config, ts-rs SSoT).
- **Gap**: ninguna mention explícita de "failing test FIRST, no fixed claims sin red→green". El meta-process es para el JCR runtime, no para los humanos/agents que escriben código de Apohara.
- **Recomendación**: agregar rule en `CLAUDE.md`/`AGENTS.md` o `.claude/rules/end-to-end-verification.md` (compatible con Claude CLI). Útil cross-agent.

#### Hallazgo 8.4: Agent-mistakes.md log

- **Origen nimbalyst**: `.claude/agent-mistakes.md`.
- **Apohara actual**: `.apohara/agent-mistakes.md`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: Archivo existe con template documentado (date, run, provider, what happened, root cause, lesson, fix, user feedback verbatim). Header dice "Auto-populable from ledger events `repeated_rejection`".
- **Gap**: NO hay entries reales todavía — sólo el template. NO existe `apohara incident extract <run-id>` CLI command que poble desde el ledger.
- **Recomendación**: poblar con las 5 incidents existentes en `AGENTS.md` past-incidents (env leak, fs.watch, spawn, PTY, opencode) para boostrappear el log; agregar el CLI extract a Stage 7+ junto con tracker CLI (8.2).

#### Hallazgo 8.5: Per-test reusable fixture workspace

- **Origen nimbalyst**: `packages/electron/marketing/fixtures/workspace/`.
- **Apohara actual**: `tests/fixtures/sample-monorepo/`.
- **Status**: ✅ COMPLETO
- **Evidencia**: `tests/fixtures/sample-monorepo/` contiene `crates/parser/`, `docs/plans/`, `packages/api/`, `packages/shared/` — mix TS + Rust + docs. Usado por `tests/integration/spec_parser_out_of_scope.test.ts:28`. `tests/integration/ledger_replay.test.ts:25` también usa fixtures.
- **Recomendación**: n/a

#### Hallazgo 8.6: Cross-arch native binaries en CI con cross-compile guidance

- **Origen nimbalyst**: `.github/workflows/electron-build.yml`.
- **Apohara actual**: `.github/workflows/release.yml` + `desktop-release.yml`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: `release.yml` cubre matrix linux-x64/darwin-x64/darwin-arm64/win32-x64 para Rust isolation-engine binaries. `desktop-release.yml` mencionado en `release-flow.md` para Tauri bundles.
- **Gap**: NO existe doc `RELEASING.md` standalone que documente el trap "single npm install with multiple optional deps" — solo cita corta en spec §8. NO se ve el bun-with-optionalDependencies-trap mitigated en CI.
- **Recomendación**: redactar `docs/RELEASING.md` con la lección y validar que el CI Bun install no caiga en pruning.

#### Hallazgo 8.7: Release flow: pre-release on tag push → promote-to-stable

- **Origen nimbalyst**: `RELEASING.md` (328 líneas).
- **Apohara actual**: `docs/release-flow.md`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: 6-stage flow documentado (pre-release auto on `v*.*.*-rc*` tag → smoke test → manual flip to stable → Homebrew → install script → announcement). Rollback procedure incluido.
- **Gap**: NO hay slash-command `/promote-public-release` ni script `release.sh` equivalente — el flip de pre-release a stable es manual via GitHub UI ("uncheck 'This is a pre-release'"). Lo dice nimbalyst que NO requiere second tag — Apohara sí requiere push de tag canónico v1.0.0 además, ergo NO es same-tag flip.
- **Recomendación**: portar `release.sh` con `--alpha` + `--promote-stable` flags si querés zero-friction; alternativamente documentar que Apohara intencionalmente usa double-tag (rc + canonical) y vivir con eso.

#### Hallazgo 8.8: `pre-release as of <commit-hash>` placeholder en docs

- **Origen nimbalyst**: `docs/POSTHOG_EVENTS.md`.
- **Apohara actual**: no convention.
- **Status**: ❓ AMBIGUO
- **Evidencia**: ninguna mention; `grep "pending release as of"` → 0 hits. Pero esto es una doc convention low-value y el spec no lo lista.
- **Recomendación**: low priority, ignorar hasta que docs versionadas tengan churn alto.

---

### Categoría 9: State Persistence & Migrations

#### Hallazgo 9.1: Persisted state safety pattern (defaults + `??` merge)

- **Origen nimbalyst**: `docs/STATE_PERSISTENCE.md`.
- **Apohara actual**: `src/core/persistence/defaults.ts` (48 LOC).
- **Status**: ✅ COMPLETO
- **Evidencia**: `mergeWithDefaults<T>(defaults, loaded)` + `deepMerge<T>(base, overlay)`. Plain-object detection con `isPlainObject` (proto check). Arrays son FULL OVERRIDES (matches intent "I configured these exact 2"). Comentario línea 2 cita spec §0.2.
- **Recomendación**: n/a

#### Hallazgo 9.2: Deep-merge for workspace state IPC updates

- **Origen nimbalyst**: `docs/ERROR_HANDLING.md` líneas 18-22.
- **Apohara actual**: `deepMerge` exportado de `defaults.ts` reusable.
- **Status**: 🟡 PARCIAL
- **Evidencia**: La utility existe (`deepMerge` línea 20).
- **Gap**: no se ve consumer en un IPC update path — el patrón "workspace:update-state" no existe como tal. Sin uso real, el tooling está pero el discipline no se materializa.
- **Recomendación**: cuando lleguen IPC updates concurrentes (TopBar cost meter + SwarmCanvas pane sizes + ContextForge sidecar concurrent), agregar wrapper `updateWorkspaceState(delta)` que use `deepMerge`.

---

### Categoría 10: System Prompt / Context Engineering

#### Hallazgo 10.1: System prompt addendum layered architecture

- **Origen nimbalyst**: `docs/SYSTEM_PROMPT_CUSTOMIZATION.md` + `buildClaudeCodeSystemPrompt()`.
- **Apohara actual**: `BaseAgentProvider.spawn(opts.systemPrompt)` passes a single string through al protocol.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `grep "addendum|<addendum>|buildSystemPrompt|appendSystemPrompt"` → 0 hits. `runner.ts:122` prepends como single system message; no hay layered builder.
- **Gap**: sin layered architecture (preset base + Apohara role addendum + task-specific + MCP tools), no se puede componer prompts sin mezclar concerns. Anti-ambigüedad `<addendum>` tag tampoco.
- **Recomendación**: cuando providers reales se conecten (correlacionado con 1.2), agregar `src/core/prompt/builder.ts` con `buildSystemPrompt({ role, taskContext, mcpTools, includeWorktreeWarning })`.

#### Hallazgo 10.2: Dynamic tool descriptions with runtime data

- **Origen nimbalyst**: `docs/SYSTEM_PROMPT_CUSTOMIZATION.md` líneas 280-291.
- **Apohara actual**: MCP tools tienen `handler` pero no `description(): string` dinámica.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `ToolRegistration` (McpServer.ts:36) solo tiene `{ name, handler }`. No hay `description` lazy con runtime context.
- **Recomendación**: extender `ToolRegistration` con `description?: () => Promise<string>` y wire al schema response del MCP server cuando un agent inicie sesión.

#### Hallazgo 10.3: "Fail fast / never log-and-continue" doctrine

- **Origen nimbalyst**: `docs/ERROR_HANDLING.md`.
- **Apohara actual**: spec §0.3 (Fail fast doctrine), PRINCIPLES.md, AGENTS.md past incidents.
- **Status**: 🟡 PARCIAL
- **Evidencia**: spec §0.3 cita la rule de nimbalyst verbatim. PRINCIPLES.md §4 (blast radius) y los past-incidents documentan casos donde no se hizo. La discipline está escrita.
- **Gap**: NO hay ESLint custom rule ni clippy `result_unwrap_or_default` enforcement automatizado. La discipline es manual.
- **Recomendación**: agregar regla ESLint custom `no-log-and-continue` cuando el codebase escale; clippy.toml con denylist relevante.

---

### Categoría 11: File-Watcher Diff & Snapshot System

#### Hallazgo 11.1: File-watcher-based diff (AI writes direct, watcher → diff mode)

- **Origen nimbalyst**: `docs/FILE_WATCHER_DIFF_SYSTEM.md`.
- **Apohara actual**: `src/core/safety/runnerPolicy/fsSnapshot.ts` (snapshot-based, NOT watcher-based).
- **Status**: 🟡 PARCIAL
- **Evidencia**: `snapshotProtectedPaths(workspace, patterns)` toma snapshot SHA-256 antes; `detectViolations(before, workspace)` compara después. Es un modelo "snapshot N+1 antes/después" no un live file watcher con pre-edit-tag.
- **Gap**: no es "AI writes direct → watcher catches → diff mode" — es "agente declara patterns protegidos → snapshot pre → compare post". Funciona para safety gate pero no para CodeDiffPane live diff visible UX.
- **Recomendación**: cuando llegue CodeDiffPane visible UX, implementar pre-edit tag via `apohara-indexer` (Rust con `notify` crate) — guarda content original en redb antes de cada tool call, reconstruct post-edit. Independiente del snapshot-based runner policy actual.

#### Hallazgo 11.2: OpenCode file-snapshot plugin

- **Origen nimbalyst**: `packages/opencode-plugin/src/fileSnapshotPlugin.ts`.
- **Apohara actual**: no existe.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `grep "fileSnapshotPlugin|tool.execute.before"` → 0 hits en código (sólo en docs/hooks-server/scripts.ts comentario). Hooks scripts en `scripts/hooks/*.sh` existen pero no proveen snapshot before/after.
- **Recomendación**: cuando OpenCodeProtocol esté wired (correlacionado con 1.2), agregar el plugin para que `apohara_run` reciba snapshots para verifier judge.

---

### Categoría 12: Worktree-aware Multi-Instance Dev

#### Hallazgo 12.1: Per-worktree `userData` directory

- **Origen nimbalyst**: `CLAUDE.md` líneas 90-93 + `crystal-run.sh`.
- **Apohara actual**: `crates/apohara-worktree/src/paths.rs` (13 LOC).
- **Status**: 🟡 PARCIAL
- **Evidencia**: `per_worktree_user_data_dir(task_id)` returns `~/.local/share/apohara/worktrees/<task_id>`. Test en `tests/lineage.rs:28` confirma que dos task_ids dan paths isolados. Spec §7.5.3 lo documenta.
- **Gap**: NO se ve consumer — el `Tauri setup()` hook en `lib.rs` no lee `APOHARA_USER_DATA_DIR` env var ni invoca a este helper. La función está creada pero nadie la llama desde el spawn path real. CLI helper `apohara worktree dev <name>` no existe.
- **Recomendación**: wire desde el scheduler (al spawn de worktree) para que setea `APOHARA_USER_DATA_DIR` env antes del Tauri/CLI spawn; tests de cross-worktree pollution.

---

## Apéndice: tabla compacta de status

| # | Sub-finding | Status |
|---|---|---|
| 1.1 | BaseAgentProvider | ✅ |
| 1.2 | ProtocolInterface | 🟡 |
| 1.3 | 3-patterns categorizados (doc) | ❌ |
| 1.4 | Static DI bucket | ✅ |
| 1.5 | Env sanitization | ✅ |
| 1.6 | Persistent prompt stream | 🟡 |
| 1.7 | Event write queue | 🟡 |
| 2.1 | Two-layer hierarchy invariant | ❌ |
| 2.2 | Worktree reliability (9 fixes) | 🟡 |
| 2.3 | Worktree-aware build cache | ❌ |
| 2.4 | Adjective-noun naming | 🟡 |
| 3.1 | Durable interactive prompts | 🟡 |
| 3.2 | Prompt ID alias resolution | ❌ |
| 3.3 | Two-channel waker | ❌ |
| 3.4 | Polling exponential backoff | 🟡 |
| 4.1 | Permission cache scopes | ✅ |
| 4.2 | Compound command splitter | ✅ |
| 4.3 | Garbage pattern filtering | ✅ |
| 4.4 | 3-tier settings hierarchy | 🟡 |
| 5.1 | Two-tier log + canonical | 🟡 |
| 5.2 | Per-provider parsers | ❌ |
| 5.3 | Step vs cumulative usage | 🟡 |
| 5.4 | Compact-boundary handling | 🟡 |
| 6.1 | Centralized IPC listeners | ✅ |
| 6.2 | workspacePath required | 🟡 |
| 6.3 | safeHandle/safeOn wrappers | ❌ |
| 7.1 | Internal MCP servers | ✅ |
| 7.2 | Settings MCP allowlist | 🟡 |
| 7.3 | Tool widgets registry | ✅ |
| 8.1 | Plan markdown + frontmatter | ✅ |
| 8.2 | Tracker workflows | 🟡 |
| 8.3 | End-to-end verification rule | 🟡 |
| 8.4 | Agent-mistakes.md | 🟡 |
| 8.5 | Per-test fixture workspace | ✅ |
| 8.6 | Cross-arch CI binaries | 🟡 |
| 8.7 | Pre-release → stable flow | 🟡 |
| 8.8 | Pre-release placeholder docs | ❓ |
| 9.1 | Defaults + ?? merge pattern | ✅ |
| 9.2 | Deep-merge IPC updates | 🟡 |
| 10.1 | System prompt addendum layered | ❌ |
| 10.2 | Dynamic tool descriptions | ❌ |
| 10.3 | Fail-fast doctrine | 🟡 |
| 11.1 | File-watcher-based diff | 🟡 |
| 11.2 | OpenCode file-snapshot plugin | ❌ |
| 12.1 | Per-worktree userData dir | 🟡 |
