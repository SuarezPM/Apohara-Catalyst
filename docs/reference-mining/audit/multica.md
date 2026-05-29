> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

# Audit: multica (18 hallazgos)

> Audit ejecutado 2026-05-22 sobre `feat/apohara-v1` HEAD (`d9372eb`).
> Confronta los 14 hallazgos primarios + 4 secundarios del análisis original de multica
> contra el código que efectivamente vive en `src/`, `crates/`, `packages/`.

## Resumen

| Status | Cantidad |
|---|---:|
| ✅ COMPLETO | 3 |
| 🟡 PARCIAL | 5 |
| ❌ NO IMPLEMENTADO | 10 |
| 🚫 RECHAZADO | 0 |
| ❓ AMBIGUO | 0 |
| **Total** | **18** |

> **Nota de scope**: Pablo confirmó que los 5 items deferidos a v1.1+ (cliente-daemon split,
> WS hub dedupe, two-transport heartbeat, profile system, workspace GC tiers) NO son rechazados;
> están scheduled pero NO empezados. Aparecen como ❌ NO IMPLEMENTADO, no 🚫.

---

## Hallazgos

### Hallazgo 1: Arquitectura cliente-daemon separada (server central + daemons distribuidos)

- **Origen multica**: `server/internal/daemon/daemon.go`, `server/internal/daemon/wakeup.go`, `server/pkg/agent/agent.go`, `server/internal/handler/daemon.go`, `CLI_AND_DAEMON.md:156-194`.
- **Apohara actual**: no existe daemon mode. Todo corre en un único proceso Bun (scheduler, dispatcher, hooks-server, providers, dashboard). El `BaseAgentProvider` cumple la función de "Backend interface unificada" pero corre in-process.
  - Evidencia: `src/core/providers/BaseAgentProvider.ts:27`, `src/core/scheduler.ts` (in-process Map de activeTasks), `packages/desktop/src/server.ts` (Bun.serve all-in-one).
- **Status**: **❌ NO IMPLEMENTADO** (Pablo: promovido a Apohara Ultimate, no rechazado).
- **Evidencia adicional**: spec lo difiere explícitamente:
  > `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3116` —
  > *"Cliente-daemon split (server central + daemons por máquina) | multica #1 | Requiere refactor profundo de scheduler + ledger; v1.0 es local-first single-instance"*
  >
  > `docs/superpowers/plans/2026-05-22-reference-mining-sprints.md:230` lo marca como "diferido a v1.1+".
- **Gap**: refactor profundo del scheduler/ledger para extraer un `apohara daemon` binary separado, con WS+HTTP loopback contra `apohara server`. Hoy no hay siquiera un subcomando `apohara daemon`.
- **Recomendación**: planear como Stage 12+ una vez v1.0 GA. Empezar publicando un `apohara daemon` opt-in que se registre contra `apohara server` con bearer token; mover los 3 CLI providers al daemon.

---

### Hallazgo 2: Identidad de daemon estable como UUIDv7 persistido + migración legacy

- **Origen multica**: `server/internal/daemon/identity.go` (244 líneas: UUIDv7 atómico, `LegacyDaemonIDs(hostname, profile)`).
- **Apohara actual**: existe un install ID persistido pero NO es UUIDv7 ni tiene migración legacy.
  - Evidencia: `src/core/telemetry/install-id.ts:14-26` — `"inst_" + 16 random hex chars`, escrito vía `atomicWriteFile` a `~/.apohara/install_id`. Regex de validación: `/^inst_[0-9a-f]{16}$/`.
- **Status**: **🟡 PARCIAL**.
- **Gap**: (a) no es UUIDv7, sino 16 hex random. (b) no hay función `LegacyDaemonIDs` para merge cross-host/cross-profile. (c) no hay separación machine-scoped vs profile-scoped. El install ID actual sirve como anonymous telemetry tag, no como identity para daemon registration.
- **Recomendación**: cuando llegue daemon mode (#1), reescribir `install-id.ts` como `daemon-identity.ts` con UUIDv7 (`crypto.randomUUID()` no sirve — generar UUIDv7 explícito por timestamp ms + 74 bits random) y un array de legacy IDs derivados de hostname.

---

### Hallazgo 3: Stampede control para recovery distribuida (in-flight + per-workspace coalesce)

- **Origen multica**: `server/internal/daemon/daemon.go:238-394` — `handleRuntimeGone`, `tryClaimRegisterSlot`, `recordRegisterCompletion`. Triple-guard: `runtimeGoneInflight`, `reregisterNextAttempt` (30s coalesce), `reregisterLastCompletedAt` (catch stragglers).
- **Apohara actual**: el reconciler tiene stall detection pero NO stampede control para recoveries duplicadas.
  - Evidencia: `src/core/dispatch/reconciler.ts:47-123` — `runReconcilerTick` itera sessions y marca stalled tras N segundos; no hay dedupe de checkers concurrentes.
  - El `tryClaimTask` en `src/core/orchestration/tasks.ts:73-93` resuelve double-dispatch via conditional UPDATE, pero no es el mismo problema (es claim-race, no recovery-storm).
- **Status**: **❌ NO IMPLEMENTADO**.
- **Gap**: no hay maps `recovery_inflight`, `recovery_next_attempt`, `recovery_last_completed` en el ledger. Si tres componentes (reconciler, hooks-server, dispatcher) detectan que un agent se cayó al mismo tiempo, los tres dispararían recovery.
- **Recomendación**: cuando el reconciler madure (Sprint 4+), agregar las 3 maps en SQLite + el patrón "entryAt + dual-gate + failure backoff" verbatim. Es testeable sin sleeps.

---

### Hallazgo 4: WebSocket hub con dedupe IDs + per-runtime authentication scoping

- **Origen multica**: `server/internal/daemonws/hub.go` (449 líneas): `byRuntime`, ring dedupe buffer 128, `select {} default {}` slow eviction, scope validation.
- **Apohara actual**: NO hay WebSocket hub. Todo el real-time del dashboard va por SSE.
  - Evidencia: `packages/desktop/src/server.ts:9-77` y siguientes —  `GET /api/session/:id/events → SSE`. `packages/desktop/src/server.ts:526-548` — `GET /api/pty/:id/stream → SSE`.
  - Búsqueda `grep -rn "WebSocket\|wsHub" packages/desktop/src/` retorna 0 matches en código de producción (sólo `node_modules` types).
- **Status**: **❌ NO IMPLEMENTADO** (Pablo: promovido a Apohara Ultimate, no rechazado).
- **Gap**: SSE es unidireccional y no tiene dedupe per-connection; no hay ring buffer ni slow-client eviction. Para Smart Attention bidireccional WS sería necesario.
- **Recomendación**: cuando el dashboard necesite bidireccionalidad (e.g. permission requests round-trip), introducir un Bun `WebSocket` server al lado del Bun.serve, copiar `markSeen`/`notifyFrame`/scope-validation literal.

---

### Hallazgo 5: Empty-claim cache con versioning anti-stale (Redis pattern)

- **Origen multica**: `server/internal/service/empty_claim_cache.go` (197 líneas).
- **Apohara actual**: hay `tryClaimTask` race-free pero NO empty-claim cache con version tagging. El scheduler simplemente itera `listReadyTasks` cada tick.
  - Evidencia: `src/core/orchestration/tasks.ts:95-134` — `listReadyTasks` corre 2 queries SQL en cada llamada sin caché.
  - El único cache version-aware tangencialmente relacionado es `src/core/contextforge-client.ts:63-65` con un dedup window de 60s para `contextforge_unavailable` events, que NO es el mismo patrón.
- **Status**: **❌ NO IMPLEMENTADO**.
- **Gap**: no hay `bump_version`/`cache_entry(key, value, version)` en el ledger. Spec lo difiere: *"§3.5: Empty-claim cache con version tagging — Optimization para multi-runner; v1.0 single-runner no la necesita"* (`docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3118`).
- **Recomendación**: junto con verification-mesh caching (Sprint 5+), aplicar el patrón "tag with version observed BEFORE the read, validate at read time" en el ledger SQLite.

---

### Hallazgo 6: Protocol envelope `{type, payload}` con eventos versionados por dominio

- **Origen multica**: `server/pkg/protocol/messages.go` + `server/pkg/protocol/events.go` (124+ event types categorizados).
- **Apohara actual**: existe la envelope shape pero más reducida.
  - Hooks events: `src/core/hooks/events.ts:15-21` — discriminated union TS de 6 kinds (`pre_tool_use`, `post_tool_use`, etc.) con `RawEnvelope { type, payload }` + `parseHookEvent` validation.
  - Orchestration messages: `src/core/orchestration/messages.ts:6-9` — union de 8 `MessageType`s (`status | dispatch | worker_done | merge_ready | escalation | handoff | decision_gate | heartbeat`).
  - Spec lo marca como adoptado: `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3218` — *"multica #6 | Protocol envelope versionado | §3.6 (message types)"*.
- **Status**: **🟡 PARCIAL**.
- **Gap**: cobertura ~14 event types vs 124 en multica. No hay categorización por dominio explícita (`task:`, `agent:`, `inbox:`, etc.). Falta forward-compat discipline con `omitempty` analogue.
- **Recomendación**: consolidar `messages.ts` + `events.ts` en un único `protocol/` paquete TS con event names estilo `domain:verb` y types versionados por adición opcional. Aprovechar ts-rs (§0.7) para que el protocol viva en `crates/apohara-types/src/protocol.rs`.

---

### Hallazgo 7: Pattern de protección contra agent "session poisoning"

- **Origen multica**: `server/internal/daemon/poisoned.go` — taxonomía `iteration_limit | agent_fallback_message | api_invalid_request | codex_semantic_inactivity` + `poisonedOutputMaxLen=320`.
- **Apohara actual**: NO hay clasificador de poisoned sessions. El consolidator no consulta resumability antes de armar resume command.
  - Evidencia: `src/core/consolidator.ts:50-80` — el `run()` simplemente itera `state.json` por successful/failed worktrees sin distinción de razón.
  - `grep -rn "poisoned" src/` retorna sólo `crates/apohara-indexer/src/embeddings.rs:120` (Rust `Mutex` poisoning, no relacionado).
  - Spec lo marca adoptado: `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3219` — *"multica #7 | Poisoned session classification | §3.4 (consolidator pre-resume check)"*.
- **Status**: **❌ NO IMPLEMENTADO** (adoptado en spec, no en código).
- **Gap**: no existen `classifyPoisonedOutput`, `classifyPoisonedError`, `classifyResumeUnsafeTimeout` ni `failure_reason` enum en el ledger.
- **Recomendación**: incorporar antes de habilitar resume-mode automático. ~150 LOC TS + columna `failure_reason` en `event_log`. Sin esto, una tarea fallida con "iteration limit reached" se reproducirá N veces.

---

### Hallazgo 8: Workspace GC con tres modos (full task / orphan / artifact-only)

- **Origen multica**: `CLI_AND_DAEMON.md:186-193` + `server/internal/daemon/gc.go` (3 tiers, `.gc_meta.json`, patterns basename-only).
- **Apohara actual**: hay `WorktreeManager` con `pruneStale` (1 tier: mtime-based eviction).
  - Evidencia: `src/core/worktree-manager.ts:292-330` — `pruneStale(olderThanMs)` itera `baseDir`, evita worktrees con lock fresco (<60s), borra entera la carpeta si mtime > threshold.
  - Sólo escribe `LOCK_FILE = ".apohara-lock"` + `META_FILE = ".apohara-meta.json"` (sin `gc_meta`); contenido del meta es `{taskId, createdAt, branch}`, sin `last_active`/`agent_id`/`status`.
  - No hay artifact-only mode (no borra `node_modules`/`.next`/`.turbo` preservando `source/`).
- **Status**: **🟡 PARCIAL** (Pablo: promovido a Apohara Ultimate, no rechazado).
- **Gap**: faltan los 3 modos (full task / orphan / artifact-only); el tier `artifact-only` con basename patterns es crítico para evitar path traversal. Spec lo difiere: `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3122` — *"v1.0 prune-stale suficiente"*.
- **Recomendación**: extender `WorktreeManager` con `gcArtifactOnly(patterns)` + `gcOrphan()` + `gcFullTask(ttl)`. Validar patterns sin `/` ni `\` (basename-only). Escribir `.apohara_gc_meta.json` con `{issue_id, last_active, agent_id, status}` para soportar tier-1.

---

### Hallazgo 9: Two-transport heartbeat: WS preferred + HTTP fallback con freshness window

- **Origen multica**: `server/internal/daemon/daemon.go:526-570` + `server/pkg/protocol/messages.go:114-176` — `wsHeartbeatRecentlyAcked(runtimeID, 2*interval)` skip de HTTP cuando WS sano.
- **Apohara actual**: hay HTTP-only hooks loopback. NO existe WS heartbeat ni freshness window.
  - Evidencia: `src/core/hooks-server/server.ts:75-159` — Bun HTTP server con `GET /health` y `POST /event`, bearer auth, body limit 256KiB, NO WS endpoint.
  - El crate `apohara-hooks-server` (Rust axum sidecar) tampoco implementa WS — `crates/apohara-hooks-server/src/lib.rs` exporta `HooksServer` HTTP-only.
- **Status**: **❌ NO IMPLEMENTADO** (Pablo: promovido a Apohara Ultimate, no rechazado).
- **Gap**: no hay WS transport, no hay `wsHBLastAck`/`clearWSHeartbeatAcks`. Spec lo difiere: `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3119` — *"Requiere daemon mode"*.
- **Recomendación**: post-daemon-mode (#1), añadir WS endpoint a `apohara-hooks-server` con ack que carry pending actions. Mapear el patrón completo de Apohara cuando ya haya cliente↔daemon en marcha.

---

### Hallazgo 10: Profile system con múltiples daemons isolated por máquina

- **Origen multica**: `CLI_AND_DAEMON.md:253-268` + `apps/desktop/src/main/daemon-manager.ts:57-78` — `~/.multica/profiles/<name>/` + `healthPortForProfile = DEFAULT + 1 + (hash(name) % 1000)`.
- **Apohara actual**: NO existe concepto de profile. Single config dir `~/.apohara/`.
  - Evidencia: `grep -rn "profile" src/core/cli/ crates/apohara-persistence/src/` retorna 0 matches; `grep -rn "--profile" src/` retorna 0 matches.
  - Único uso de "profile" es `crates/apohara-sandbox/src/profile/syscalls.rs` (seccomp profile, semántica distinta).
- **Status**: **❌ NO IMPLEMENTADO** (Pablo: promovido a Apohara Ultimate, no rechazado).
- **Gap**: no hay `--profile <name>` CLI flag ni mapeo a `~/.apohara/profiles/<name>/`; no hay puerto determinístico.
- **Recomendación**: cuando llegue daemon mode, añadir `apohara --profile <name>` que mapea a `~/.apohara/profiles/<name>/{config.yaml, ledger.sqlite, logs/}` + hash determinístico para puertos efímeros.

---

### Hallazgo 11: Sidecar CLI bundling para Electron desktop (binary auto-resolve cascade)

- **Origen multica**: `apps/desktop/scripts/bundle-cli.mjs` (169 líneas) + `apps/desktop/src/main/daemon-manager.ts:301-495` — cascade `cached → bundled → managed → auto-install → PATH` + deferred restart.
- **Apohara actual**: existe Tauri v2 scaffold y un `npx-cli/` para distribución, pero NO sidecar bundling con resolve cascade.
  - Evidencia: `packages/desktop/src-tauri/tauri.conf.json` — NO declara `tauri.bundle.externalBin`. No hay sidecar definido.
  - El `npx-cli/` (commit `d9372eb` T3.5) sí descarga binarios via GitHub releases pero no aplica la cascade multi-tier.
  - Spec lo marca adoptado: `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3220` — *"multica #11 | Sidecar CLI bundling | §0.24 + §8.1"*.
- **Status**: **🟡 PARCIAL** (adopción declarativa en spec; ejecución parcial en npx-cli).
- **Gap**: faltan (a) `externalBin` en `tauri.conf.json`, (b) cascade resolve `bundled → managed → auto-install → PATH`, (c) deferred restart "until active tasks drain", (d) version mismatch detection daemon↔CLI.
- **Recomendación**: cuando el desktop entre en pre-1.0 packaging, agregar `pnpm tauri:bundle-server` script + cascade resolution + check de version mismatch con deferred restart.

---

### Hallazgo 12: Pattern de mention expansion (`MUL-117` → `[MUL-117](mention://issue/<uuid>)`)

- **Origen multica**: `server/internal/mention/expand.go` (197 líneas, RTL replace + skip code blocks/inline code/markdown links).
- **Apohara actual**: NO existe. `grep -rn -i "mention" src/` retorna sólo (a) `qualityGates/frontendGate.ts:12` (ARIA mentions, semántica distinta) y (b) `crates/apohara-attention/src/lib.rs:4` (Hot band trigger by `@mention` en source de hook event, no expansion).
- **Status**: **❌ NO IMPLEMENTADO**.
- **Gap**: spec lo difiere: `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3131` — *"Nice-to-have, no critical"*. No hay regex + skip regions + RTL replace para IDs `APO-`.
- **Recomendación**: cuando el SPEC.md parser indexe refs cruzados (`[REQ-12]`), portar el patrón regex+skip-regions directamente. ~150 LOC TS, 0 deps.

---

### Hallazgo 13: Issue active-duplicate prevention con Postgres advisory lock

- **Origen multica**: `server/internal/issueguard/duplicate.go` (87 líneas) — `(workspace_id, project_id, parent_issue_id, normalize(title))` + lock + `ActiveDuplicateError`.
- **Apohara actual**: NO existe. `tryClaimTask` previene double-dispatch (race en claim), pero NO previene insert duplicado en el decomposer.
  - Evidencia: `src/core/decomposer.ts` no normaliza títulos ni busca activos antes de crear; el agent-router/scheduler no tienen `--allow-duplicate` flag.
  - Spec lo marca adoptado: `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3221` — *"multica #13 | Issue active-duplicate prevention | §3.3 (decomposer)"*.
- **Status**: **❌ NO IMPLEMENTADO** (adoptado en spec, no en código).
- **Gap**: faltan (a) `normalize(title)` helper, (b) `BEGIN IMMEDIATE` SQLite emulando advisory lock, (c) `DuplicateError` con identificador del duplicado, (d) `--allow-duplicate` escape hatch.
- **Recomendación**: agregar en el siguiente sprint del decomposer/autopilot. Patrón clave: `strings.ToLower(strings.Join(strings.Fields(title), " "))` → busca activo → si existe, devolver con `identifier`. Sin esto, decomposer va a crear duplicates inevitablemente.

---

### Hallazgo 14: Backend handler UUID parsing convention (3 helpers + Past Incident)

- **Origen multica**: `CLAUDE.md` "Backend Handler UUID Parsing Convention" + `server/internal/handler/daemon.go` — 3 helpers (`parseUUIDOrBadRequest`, `loadIssueForUser`, `parseUUID`-panic) + Past Incident #1661.
- **Apohara actual**: el patrón "Past Incidents" SÍ existe (inspirado por nimbalyst) en `CLAUDE.md:113-` con 5 incidents documentados. Pero NO hay convención específica para parseo de IDs.
  - Evidencia: `grep -rn "parseTaskId\|parseTaskIdOrError\|assertTaskId" src/` retorna 0 matches. No existe `src/lib/ids.ts` ni equivalente.
  - El `id` field es libre — `agent-router.ts:207-285` lo trata como `string | undefined` sin parsing helper.
  - Spec lo marca adoptado: `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3222` — *"multica #14 | UUID parsing convention | §0.3 (disciplina)"*.
- **Status**: **🟡 PARCIAL** (pattern de Past Incident sí; helpers de parsing no).
- **Gap**: faltan los 3 helpers (`parseTaskIdOrError`, `resolveTaskHandle`, `assertTaskIdInternal`) + sección "ID Parsing Convention" en `CLAUDE.md`.
- **Recomendación**: crear `src/lib/ids.ts` con los 3 helpers y documentar la convención en `CLAUDE.md` antes de que el handler surface crezca. ~80 LOC.

---

### Hallazgo 15 (secundario): CLI_INSTALL.md como prompt para AI agents

- **Origen multica**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/multica/CLI_INSTALL.md` (doc explícitamente diseñado para Claude/Codex).
- **Apohara actual**: NO existe `APOHARA_INSTALL.md`. La instalación se documenta en `docs/superpowers/plans/2026-05-22-apohara-v1.md` (plan, no prompt) y `scripts/install.sh` (curl|sh).
- **Status**: **❌ NO IMPLEMENTADO**.
- **Gap**: no hay doc step-by-step en root del repo diseñado para que un agente externo lo lea y ejecute.
- **Recomendación**: tras release v1.0, escribir `APOHARA_INSTALL.md` en formato "agent-readable" (heading-driven, command-per-line). El propio Apohara podría instalarlo en repos targets cuando se enrole un nuevo agente externo.

---

### Hallazgo 16 (secundario): Issue metadata como typed KV map con bar alto

- **Origen multica**: `CLI_AND_DAEMON.md:455-479` — KV map (max 50 keys, 8KB blob), docs explícitas: *"the bar for writing is high"*.
- **Apohara actual**: el `event_log` tiene un `metadata?: EventLog["metadata"]` libre (JSON sin schema). No hay quota ni bar formal.
  - Evidencia: `src/core/orchestration/module.ts:106` — `metadata?: EventLog["metadata"]` pasado a `log()`.
- **Status**: **❌ NO IMPLEMENTADO**.
- **Gap**: no hay límite de keys/size, no hay schema validation, no hay "bar for writes" documentado.
- **Recomendación**: si plan documents necesitan KV bookkeeping persistido, definir tabla `plan_metadata(plan_id, key, value)` con check de 50/8KB y doc en CLAUDE.md.

---

### Hallazgo 17 (secundario): Workspace settings versioning + repo allowlist hash

- **Origen multica**: `server/internal/handler/daemon.go:200-211` — `reposVersion := sha256(sorted_urls)` para skip refresh.
- **Apohara actual**: NO existe `state_version` per workspace/branch.
  - Evidencia: `grep -rn "state_version\|reposVersion\|workspaceVersion" src/` retorna 0 matches.
- **Status**: **❌ NO IMPLEMENTADO**.
- **Gap**: las re-evaluaciones de mesh/indexer no saltan por hash de input. Spec lo marca adoptado: `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3223` — *"multica #17 | Workspace settings versioning + repo allowlist hash | §0.11"*, pero no se ejecutó.
- **Recomendación**: añadir columna `state_version` (sha256 de inputs) a tablas relevantes del ledger + skip-if-equal en verification-mesh.

---

### Hallazgo 18 (secundario): Client-side secret redaction como safety net

- **Origen multica**: `packages/views/common/task-transcript/redact.ts` (11 patterns: AWS, GitHub tokens, JWT, bearer, conn strings).
- **Apohara actual**: SÍ hay redaction central, pero del lado server/Bun, no del lado view.
  - Evidencia: `src/lib/sanitize.ts:7-21` — 5 patterns (OpenAI, Gemini, Anthropic, AWS keys, generic 40-char base64) + `redact`, `redactObject`, `wrapConsole`, `safeAppendFile`, `containsApiKey`, `countApiKeys`.
  - El env sanitizer en `src/core/persistence/envSanitizer.ts` cubre la frontera de spawn (~30 patterns con `*_API_KEY`, `*_TOKEN`, providers, CI, webhooks).
  - El TUI tiene `stripUnsafeChars` (`packages/tui/lib/sanitize.ts`) pero es para control chars, no API keys.
  - El desktop UI (`packages/desktop/src/components/`) NO tiene capa cliente-side de redaction antes de renderizar agent output.
  - Spec lo marca adoptado: `docs/superpowers/specs/2026-05-21-apohara-v1-design.md:3224` — *"multica #18 | Client-side secret redaction | §4.6"*.
- **Status**: **🟡 PARCIAL**.
- **Gap**: faltan (a) defense-in-depth render-side en desktop UI antes de pintar transcripts, (b) `redactSecrets` reutilizable en `packages/apohara-shared/` para que tanto TUI como desktop importen el mismo set.
- **Recomendación**: extraer las 5+ patterns de `src/lib/sanitize.ts` a `packages/apohara-shared/redaction.ts` (con regeneración ts-rs friendly) y aplicarlas en cada componente de desktop que renderice output crudo (Transcript, PTY stream, hooks panel).

---

## Apéndice: enrutamiento spec → código

Lo que dice cada referencia spec vs lo que realmente vive en `src/`:

| multica # | Status spec | Status código (este audit) |
|---|---|---|
| #1 cliente-daemon | "diferido v1.1+" | ❌ |
| #2 UUID identity | "no crítico single-instance" | 🟡 install-id existe, no UUIDv7 |
| #3 stampede control | (no listado en adoptados) | ❌ |
| #4 WS hub dedupe | "diferido v1.1+" | ❌ |
| #5 empty-claim cache | "optimization multi-runner" | ❌ |
| #6 protocol envelope | "adoptado §3.6" | 🟡 partial coverage |
| #7 poisoned classification | "adoptado §3.4" | ❌ (declarativo, no ejecutado) |
| #8 GC tiers | "v1.0 prune-stale suficiente" | 🟡 1 tier |
| #9 two-transport heartbeat | "requiere daemon mode" | ❌ |
| #10 profile system | "requiere daemon mode" | ❌ |
| #11 sidecar bundling | "adoptado §0.24/§8.1" | 🟡 npx-cli existe, sin cascade |
| #12 mention expansion | "nice-to-have" | ❌ |
| #13 duplicate prevention | "adoptado §3.3" | ❌ (declarativo, no ejecutado) |
| #14 UUID parsing convention | "adoptado §0.3" | 🟡 Past Incidents sí; helpers no |
| #15 INSTALL.md prompt | (no listado) | ❌ |
| #16 typed KV metadata | "útil cuando crezca SPEC.md" | ❌ |
| #17 settings versioning | "adoptado §0.11" | ❌ (declarativo, no ejecutado) |
| #18 client-side redaction | "adoptado §4.6" | 🟡 server-side sí, view-side no |

> 3 items spec-adoptados quedaron sin ejecutar: #7, #13, #17. Recomendación: priorizar #13 (duplicate prevention) y #7 (poisoned classification) — los dos son barriles de bugs latentes en cuanto el autopilot/decomposer corra solo más tiempo.
