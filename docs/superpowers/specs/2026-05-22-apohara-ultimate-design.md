# Apohara Ultimate — Design Spec

> **Fecha:** 2026-05-22
> **Branch destino:** `feat/apohara-ultimate` (derivada de `feat/apohara-v1`)
> **Relación con spec v1.0** (`docs/superpowers/specs/2026-05-21-apohara-v1-design.md`):
> este spec NO reemplaza al v1.0; lo **extiende** con los 53 hallazgos no implementados
> y los 7 items v1.1+ promovidos. La identidad del producto (33 disciplinas §0,
> Tauri, CLI-wrappers-only, local-first) queda intacta.
> **Métodos:** este spec se construyó tras un re-audit completo donde 10 research
> agents en paralelo cruzaron CADA uno de los 194 hallazgos del análisis original
> contra el código actual. Los reportes individuales viven en
> `docs/reference-mining/audit/<repo>.md` y son la fuente de verdad de las
> categorizaciones ✅ / 🟡 / ❌ / 🚫 / ❓ usadas en este spec.
> **Conteo del audit:** 43 ✅ COMPLETO + 82 🟡 PARCIAL + 65 ❌ NO IMPLEMENTADO +
> 3 🚫 RECHAZADO + 5 ❓ AMBIGUO = 198 hallazgos cruzados (194 canónicos + 4
> sub-findings extra de nimbalyst).

---

## Tabla de contenidos

- [§1 Visión + scope](#1-visión--scope)
- [§2 Architecture / boundary changes](#2-architecture--boundary-changes)
- [§3 Sprint 4 — Foundation / Bug-barrels](#3-sprint-4--foundation--bug-barrels)
- [§4 Sprint 5 — Mid-stack features](#4-sprint-5--mid-stack-features)
- [§5 Sprint 6 — v1.1+ promovidos (greenfield grandes)](#5-sprint-6--v11-promovidos-greenfield-grandes)
- [§6 Sprint 7 — Ship + Polish (release v1.0.0)](#6-sprint-7--ship--polish-release-v100)
- [§7 Testing strategy](#7-testing-strategy)
- [§8 Error handling + rollback strategy](#8-error-handling--rollback-strategy)
- [§9 Out of scope / non-goals](#9-out-of-scope--non-goals)
- [§10 Referencias cruzadas (audit data agregada)](#10-referencias-cruzadas-audit-data-agregada)
- [§11 Apéndices](#11-apéndices)

---

## §1 Visión + scope

**Apohara Ultimate** es la evolución del v1.0 actual hacia un orquestador multi-AI completo: incorpora los 194 hallazgos del análisis de 10 reference repos en su totalidad, cerrando los 8 "bug-barrels documentados como hechos pero sin código", completando los 82 features parciales con sus gaps específicos, e implementando los 65 no abordados — incluyendo los 7 items que el plan v1.0 había diferido a v1.1+ (SSH worker, cliente-daemon split, Smart Router, Reaction Engine, workspace GC 3-tier, profile system, embedded SSH server).

### Estado de partida

- Branch: `feat/apohara-v1`
- Stages tagged: 11 (Stage 1 Foundation → Stage 11 Release)
- Commits post-stage-11: 16 (Sprints 1-3 ejecutados)
- Suite tests: 505 pass / 0 fail
- Active CLI drivers: 3 (claude-code-cli, codex-cli, opencode-go) + 3 catalog-only (cursor-agent, copilot-cli, aider)

### Estado final esperado

- Branch: `feat/apohara-ultimate` (deriva de `feat/apohara-v1`)
- Commits adicionales: ~150 distribuidos en 4 sprints temáticos (Sprint 4-7)
- Suite tests: ~1300-1400 pass / 0 fail / cross-platform CI verde
- Release `v1.0.0` shippeada con binaries reales en GitHub + `npm publish` del paquete `apohara`
- 10 reference repos absorbidos sin contradecir las 11 decisiones identitarias

### Identidad NO negociable (load-bearing — defines product)

- **Tauri 2**, NO Electron
- **bun:sqlite + Rust SQLx**, NO PostgreSQL ni pgvector
- **Single-user-per-machine**, NO multi-tenant
- **CLI wrappers ONLY**, NO OAuth flows
- **Local-first**, NO cloud sync
- Sin OAuth / Stytch / JWT
- Sin PostHog telemetry (install-id anónimo + denylist OK, spec v1.0 §0.33)
- Sin marketplace business model

### Métricas de éxito

1. Suite de tests **>1300 pass / 0 fail** / cobertura cross-platform (CI matrix verde en Linux + macOS + Windows × Node 20 + 22)
2. `npx apohara` instala y arranca desde una máquina limpia en **<60s**
3. Run end-to-end: prompt → 3 CLIs orquestados con hook events live → resultado verificado → commit propuesto via MCP tool → todo visible en kanban
4. Cost reporting preciso **1×** (no 3× duplicado por bug de token accounting)
5. Restart del bun process **no pierde** pending prompts (DurablePromptStore persistente)
6. **Coordinator class** corre el loop de las 5 tablas; no son librerías sin caller
7. Smart Router clasifica intent con **precision/recall ≥ 0.85** sobre dataset de smoke
8. Daemon split funciona end-to-end con cliente Tauri reconectándose tras crash del daemon

---

## §2 Architecture / boundary changes

### Lo que NO cambia (sigue siendo identidad)

- Workspace Cargo de 17 crates existentes
- Tauri 2 + React 19 desktop UI
- `src/core/` domains TS
- ts-rs SSoT en `packages/apohara-shared/types.ts` — nunca editar a mano (§0.7)
- MCP servers HTTP bearer
- `bun:sqlite` para orchestration DB, Rust SQLx para sandbox/indexer

### Refactors mayores dentro de crates/módulos existentes

| Módulo | Cambio | Razón (del audit) |
|---|---|---|
| `crates/apohara-coordinator/` | Implementar `Coordinator` class con event loop sobre las 5 tablas | orca #9 — librerías sin caller hoy |
| `crates/apohara-hooks-server/` | Cerrar TODO `event.rs:100`: broadcast a orchestration DB + bus | orca #1 — eventos llegan, autentican, mueren |
| `crates/apohara-token-accounting/` | Reescribir 5-LOC placeholder → per-thread absolute counting real | symphony #11 — cost 3-4× duplicado |
| `src/core/providers/` + `src/providers/cli-driver.ts` | Mover spawn real a 3 implementaciones de `AgentProtocol` (Claude/Codex/OpenCode); `cli-driver.ts` queda como coordinador delgado | nimbalyst #1.2 — bloquea 4 features dependientes |
| `src/core/durable-prompts/` | In-memory → JSONL-backed con replay | nimbalyst #3.1 — restart pierde prompts |
| `src/core/safety/runnerPolicy/` | Wiring al spawn path (código existe, solo conectar) | agentrail #8 — feature lista sin cosechar |
| `crates/apohara-mcp-bridge/` | JSONC CST con preservación de comentarios | vibe-kanban #2 + spec v1.0 §0.27 |
| `src/core/config/` | Versioned Config Schema + migration chain | vibe-kanban #10 — release sin formato migrable se rompe |

### Crates / módulos NUEVOS (los 7 promovidos a Ultimate)

| Nuevo módulo | Origen | Sprint |
|---|---|---|
| `crates/apohara-remote-worker/` | symphony #13 (SSH worker) | 6 |
| `crates/apohara-ssh-server/` | vibe-kanban #13 (embedded SSH) | 6 |
| `crates/apohara-daemon/` + `crates/apohara-client/` | multica #1 (cliente-daemon split) | 6 |
| `crates/apohara-ws-hub/` | multica WS hub dedupe + stampede | 6 |
| `crates/apohara-transport/` | multica two-transport heartbeat | 6 |
| `crates/apohara-reaction-engine/` | claude-octopus #13 | 6 |
| `src/core/coordinator/intentClassifier.ts` | claude-octopus #12 (Smart Router) | 6 |
| `src/core/profiles/` | multica (profile system multi-daemon) | 6 |
| `src/core/worktree/gc-tiered.ts` | multica #8 (3-tier expansion) | 6 |
| `src/core/orchestration/yolo-mode.ts` | Chorus `/yolo` pipeline | 6 |

### Bug-barrels documentados como hechos pero sin código (Sprint 4 los cierra todos)

1. `Coordinator` class con loop (orca #9)
2. Broadcast channel en hooks-server (orca #1)
3. Token accounting real (symphony #11)
4. ProtocolInterface real (nimbalyst #1.2)
5. DurablePromptStore persistente (nimbalyst #3.1)
6. Runner policy wired (agentrail #8)
7. Multica #7 (poisoned sessions) + #13 (duplicate prevention) + #17 (settings versioning)
8. JSONC preservation + Versioned Config Schema (vibe-kanban #2 + #10)

---

## §3 Sprint 4 — Foundation / Bug-barrels

**Duración estimada:** ~2 semanas si secuencial, ~7-10 días con paralelización (4 implementers Opus + 6 opencode worktrees).

**Outcome esperado:** cero "spec dice listo, código vacío". Después de Sprint 4 las afirmaciones del spec v1.0 son verificables con código real.

### Tareas (orden por dependencia, no por importancia)

| ID | Tarea | Files clave | Esfuerzo | Bloquea |
|---|---|---|---:|---|
| **T4.1** | Token accounting real | `crates/apohara-token-accounting/src/lib.rs` (5 LOC → ~300 LOC con per-thread absolute counting) | 2 días | nada |
| **T4.2** | DurablePromptStore JSONL-backed | `src/core/durable-prompts/store.ts` (in-memory → JSONL + replay + atomic write) | 1-2 días | nada |
| **T4.3** | Runner policy wired al spawn | `src/providers/cli-driver.ts` + `crates/apohara-sandbox/src/runner/imp.rs` (solo wiring, código ya existe) | 1 día | nada |
| **T4.4** | Multica bug-barrels (3 spec'd sin código) | `src/core/orchestration/{poisonedSessions,duplicatePrevention}.ts` + `src/core/config/versioning.ts` (nuevos) | 3 días | nada |
| **T4.5** | Hooks server broadcast (cierra TODO `event.rs:100`) | `crates/apohara-hooks-server/src/event.rs` + bus forwarding a orchestration DB | 2 días | parcial T4.6 |
| **T4.6** | Coordinator class con event loop | `crates/apohara-coordinator/src/coordinator.rs` (nuevo: clase + loop sobre 5 tablas) | 3-4 días | T4.5 |
| **T4.7** | ProtocolInterface real (3 implementaciones) | `src/core/providers/protocols/{ClaudeCodeProtocol,CodexProtocol,OpenCodeProtocol}.ts` + refactor `cli-driver.ts` → coordinador delgado | 4 días | T4.1 |
| **T4.8** | JSONC CST + Versioned Config Schema | `crates/apohara-mcp-bridge/` (JSONC con preservación de comentarios) + `src/core/config/{schema-v1,migrations}.ts` | 3 días | nada |

### Estrategia de paralelización

- **Wave 1 (días 1-3):** 4 paralelos → T4.1, T4.2, T4.3, T4.8 (zero deps, archivos disjuntos)
- **Wave 2 (días 4-6):** 2 paralelos → T4.4 (3 sub-features paralelizables), T4.5 (prep broadcast)
- **Wave 3 (días 7-10):** secuencial 1 por 1 → T4.6 (Coordinator core), después T4.7 (Protocol refactor — toca boundary grande, mejor solo)

### Tests acumulados al cierre Sprint 4

- Start: 505 tests (Sprint 3 close)
- Sprint 4 esperado: ~620-650 tests (+115-145 nuevos)
- Foco de tests nuevos: token accounting unit + integration multi-provider, DurablePromptStore replay + atomic write + corruption recovery, runner policy wired e2e, multica 3 bug-barrels (poisoned sessions + duplicate prevention + settings versioning), Coordinator loop integration, 3 Protocol implementations, JSONC roundtrip de comentarios, Versioned Config migration chain

### TDD discipline

Cada tarea sigue TDD bite-sized: failing test → minimal impl → passing test → commit. Commits por tarea (no monolíticos). HEREDOC commit messages con `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`.

### Riesgos / decisiones a tomar durante ejecución

- **T4.6 Coordinator:** lo más arquitectónico. Puede revelar que las 5 tablas necesitan schema changes pequeños (FK constraints, índices). Si pasa, separar en T4.6a (schema) + T4.6b (loop). No es regressión — es refactor saludable.
- **T4.7 ProtocolInterface refactor:** toca el código más caliente del repo (`cli-driver.ts`). Riesgo de regressión real. Mitigación: ejecutar AL ÚLTIMO, después de Wave 1+2 completas, con regression suite extra de los 3 providers.

---

## §4 Sprint 5 — Mid-stack features

**Duración estimada:** ~3-4 semanas si secuencial, ~12-15 días con paralelización fuerte.

**Outcome esperado:** el código refleja las 12+ categorías cross-repo identificadas en el análisis original. Después de Sprint 5, queda solo el greenfield grande (Sprint 6) y el polish (Sprint 7).

### Estructura: 9 grupos temáticos

Sprint 5 agrupa los ~147 hallazgos (65 ❌ + 82 🟡) en 9 grupos coherentes. Esto evita listar 75+ tareas sueltas — cada grupo concentra un área de subsistema y se paraleliza en su totalidad.

| Grupo | Tema | # tareas | Esfuerzo | Depende de |
|---|---|---:|---:|---|
| **G5.A** | Providers / Protocols / Streams | ~12 | 8-10 días | T4.7 |
| **G5.B** | State machines + Lifecycle | ~10 | 6-8 días | T4.6 |
| **G5.C** | Hooks + Coordination + Context | ~8 | 5-7 días | T4.5 |
| **G5.D** | Safety + Permissions + Verification | ~7 | 5-7 días | — |
| **G5.E** | Filter DSL + Whisper + Mesh Bus | ~8 | 6-8 días | — |
| **G5.F** | Persistence + Atomic + Drift | ~10 | 7-9 días | T4.2 |
| **G5.G** | Symphony patterns mid-stack | ~10 | 6-8 días | T4.6 |
| **G5.H** | Multica mid-stack (no Sprint 6) | ~6 | 4-6 días | — |
| **G5.I** | Backlog Tier 3 sin asignar | ~8 | 6-8 días | — |

**Total:** ~75 sub-tareas, ~53-71 días si secuencial.

### G5.A — Providers / Protocols / Streams

Depende fuerte de T4.7 (ProtocolInterface real). Sub-features:

- nimbalyst #1.1 — persistent stdin handling
- nimbalyst #1.2 — Protocol implementations completas (continuación de T4.7)
- nimbalyst #1.3 — prompt builders por provider
- nimbalyst #1.4 — step usage attribution
- nimbalyst #1.5 — file snapshot before/after
- nimbalyst #1.6 — persistent stdin → multi-turn session
- nimbalyst capabilities tooling
- nimbalyst #11.2 — file snapshot diff streaming
- T3.7 — EditorHost contract + useEditorLifecycle (foundation Monaco/Markdown/CSV)
- vibe-kanban capabilities-based feature flags wiring (#16 PARCIAL)
- vibe-kanban pure profiles (#18 PARCIAL)
- enum_dispatch resolución (#15 AMBIGUO → resolver con código real)

### G5.B — State machines + Lifecycle

Depende de T4.6 (Coordinator). Sub-features:

- symphony #3 — RunState/RunPhase completar (de PARCIAL a COMPLETO)
- symphony #5 — Reconciliation tick completar (T3.10)
- symphony #10 — Blocked state como primary (PARCIAL → COMPLETO)
- T3.9 — Continuation turns (live thread, token economy)
- agentrail #6 — Scheduler lanes priorizadas (`Lane::{ResumeInProgress, RetryAfterFeedback, StartNew, SetupVerification}`)
- agentrail #5 — Setup task lane dedicada (PARCIAL → COMPLETO)
- chorus state machine completar (varios PARCIAL)
- symphony #4 — Continuation vs Failure retry semánticos
- claude-octopus #6 — Freeze/Careful state
- claude-octopus #7 — TeammateIdle state

### G5.C — Hooks + Coordination + Context

Depende de T4.5 (hooks broadcast). Sub-features:

- claude-octopus #8 — Pre/PostCompact contract re-injection (spec v1.0 §3.5.1 ya describe el código pero no implementado)
- claude-octopus #3 — Statusline bridge (banner inferior con state activo)
- claude-octopus #4 — Context warnings (mostrar cuándo se acerca el límite)
- claude-octopus #10 — Per-worktree env isolation (cada worktree con su `.env` aislado)
- claude-octopus #9 — Learnings dump (sesión-final summary structured)
- chorus H8 — additionalContext en hook output JSON (ya ✅ pero verificar paths nuevos)
- chorus H19 — Notifier multi-subscribe (EventBus support multiple consumers per channel)
- chorus H18 — EventSource onReconnect backfill desde Last-Event-ID

### G5.D — Safety + Permissions + Verification

Sin deps directas. Sub-features:

- agentrail #1 — `availableActions[]` contrato universal (preamble texto libre → enum determinístico)
- T3.11 — Acceptance Criteria dual-status (devStatus + admin status, chorus H4)
- T3.12 — registerPermissionedTool (deny-by-non-registration, chorus H11 / vibe-kanban patterns)
- chorus H5 — Critic system reminders (spec v1.0 líneas 1678-1709, falta `src/core/verification-mesh/prompts/critic.ts`)
- chorus H6 — Hallucination flag (post-spawn verification)
- chorus H10 — Permission grid (AMBIGUO → resolver con modelo concreto)
- agentrail #17 — Doctor.ts placeholder → llamada real a `compileRunnerExecutionPlan`

### G5.E — Filter DSL + Whisper + Mesh Bus

Sin deps directas. Sub-features:

- culture #2 — Filter DSL parser + applier (~200 LoC, sin deps externas, habilita predicados declarativos)
- culture #6 — `explain/overview/learn` universal verbs dispatcher
- culture #7 — Passthrough CLI mode (proxy con interception ligera)
- culture #9 — Decentralized config discovery
- culture #10 — Whisper protocol stderr-side-channel (única vía real-time judge/critic)
- culture #1 — Mesh-as-bus expansion (PARCIAL → COMPLETO con tags estructurados)
- culture #11 — Plugin packaging skills install (PARCIAL → COMPLETO)
- culture #14 — Peek attribution (PARCIAL → COMPLETO)

### G5.F — Persistence + Atomic + Drift

Depende de T4.2 (DurablePromptStore JSONL). Sub-features:

- nimbalyst #5.1 — Two-tier canonical projection (`TranscriptTransformer/projector.ts`, habilita FTS sobre ledger)
- T3.2 — Idempotency-Key + JSONL replay 72h (agentrail patterns, reconnect lossless del UI)
- vibe-kanban #3 — JSON-Patch streaming (RFC6902 patches via SSE)
- vibe-kanban #9 — Preview-proxy del UI dev server
- vibe-kanban #14 — Dev setup automation
- vibe-kanban #11 — AGENTS.md scoped por crate (PARCIAL → COMPLETO con per-crate)
- vibe-kanban #20 — spawn_blocking para libgit2 + tree-sitter (AMBIGUO → resolver)
- vibe-kanban #17 — Sound files para notifications
- agentrail #12 — Last-Event-ID en SSE para resume
- multica atomic writes patterns (PARCIAL → COMPLETO en módulos donde falte)

### G5.G — Symphony patterns mid-stack

Depende de T4.6 (Coordinator). Sub-features:

- symphony #1 — RFC2119 validation profiles (MUST/SHOULD/MAY enforcement levels)
- symphony #2 — Workflow hot-reload con last-known-good fallback (PARCIAL → COMPLETO)
- symphony #6 — PathSafety con symlink-escape (PARCIAL → COMPLETO)
- symphony #7 — Workspace hooks 4-phase lifecycle (PARCIAL → COMPLETO)
- symphony #8 — Line-framed protocol sanitization (PARCIAL → COMPLETO)
- symphony #9 — Dynamic tools + auto-approval heuristics
- symphony #12 — Dashboard humanizer (events → human-readable labels)
- symphony #14 — Self-describing guardrail flags (AMBIGUO → resolver, evento existe sin emisor)
- symphony #15 — Tracker adapter (PARCIAL → COMPLETO)
- symphony anti-thrash strategy rotation (PARCIAL → COMPLETO)

### G5.H — Multica mid-stack (los que NO van a Sprint 6)

Sin deps directas. Sub-features:

- multica #4 — Secret redaction en logs (PARCIAL → COMPLETO)
- multica #6 — Atomic mv para JSONL persistence (PARCIAL → COMPLETO)
- multica #11 — UUID parsing + validation
- multica #14 — Empty-claim cache versioning
- multica #16 — Workspace lifecycle hooks
- multica #18 — Per-thread keying (relación con token accounting de T4.1)

### G5.I — Backlog Tier 3 sin asignar

Los 15 del plan original que quedaron pending:

- T3.6 — WSL handling (Windows users)
- T3.13 — Culture skills install pattern (`apohara skills install claude` deja SKILL.md correcto)
- T3.14 — `apohara learn <provider>` self-teaching
- T3.16 — parseWithFallback zod boundary (IPC TS↔Rust no rompe en version skew)
- T3.17 — OSC 998 command-state escape (mostrar "agent ran X, exit 0" inline)
- T3.18 — Worktree status con `git cherry` (unique_commits_ahead)
- T3.19 — Per-worktree named locks (race prevention multi-agent)
- T3.20 — Multi-tier prompt cache (cache hits de Anthropic)

### Estrategia de paralelización (waves)

- **Wave 1 (días 1-5):** 4 paralelos disjuntos → G5.D, G5.E, G5.H, G5.I (zero deps)
- **Wave 2 (días 6-10):** 3 paralelos → G5.B (depende T4.6), G5.C (depende T4.5), G5.G (depende T4.6 pero archivos disjuntos de G5.B)
- **Wave 3 (días 11-14):** 2 paralelos → G5.A (depende T4.7), G5.F (depende T4.2)

Compatible con patrón Pablo "max paralelización siempre" (4 Claude Opus + 6 opencode worktrees = 10 implementers concurrentes).

### Cómo se desglosa cada grupo en el plan final

Cada grupo va a tener su propia subsección en el plan `writing-plans` step (no en este spec) con tabla `tarea → hallazgo origen → archivos → esfuerzo` y pasos TDD bite-sized.

### Tests acumulados al cierre Sprint 5

- Start Sprint 5: ~620-650 (post-Sprint 4)
- End Sprint 5: ~850-900 (+200-280 nuevos)
- Foco: ProtocolInterface compliance per provider, continuation turn replay, lane priority sort, Pre/PostCompact contract re-inject roundtrip, per-worktree env isolation, `availableActions[]` contract validation, dual-status AC verification, critic system reminders, registerPermissionedTool deny-by-non-registration, Filter DSL parser + applier, Whisper stderr framing, JSON-Patch RFC6902 generator, idempotency-key 72h replay, projector two-tier, RFC2119 validation profiles, hot-reload last-known-good, hooks 4-phase lifecycle, dashboard humanizer, named locks race-prevention, WSL detection, OSC 998 parser, git cherry diff, prompt cache hit-rate.

### Riesgos / decisiones a tomar durante ejecución

- **G5.A** depende fuerte de cómo quedó T4.7. Si T4.7 reveló schema gaps en `AgentProtocol`, revisar antes de arrancar G5.A. Mitigación: review de la interface DESPUÉS de T4.7 close + AJUSTAR G5.A.
- **G5.G** (Symphony) toca muchos archivos pequeños — riesgo de merge conflicts si paraleliza muy agresivamente. Mitigación: dividir G5.G en sub-grupos pequeños, asignar a 1-2 implementers que no se pisen.
- **G5.E** (Filter DSL + Whisper) — culture mid-stack es la categoría con MENOS implementación previa. Riesgo de subestimar esfuerzo. Mitigación: empezar con T-Filter-DSL (200 LoC pero core), después el resto se asienta encima.

---

## §5 Sprint 6 — v1.1+ promovidos (greenfield grandes)

**Duración estimada:** ~5-6 semanas si secuencial, ~15-18 días con 4 implementers paralelos.

**Outcome esperado:** Apohara salta de "wrapper de CLIs local" a "orquestador multi-machine + intent classification + automation pipeline". Es el sprint que define "Ultimate" — los items que el plan v1.0 había diferido por costo de implementación, ahora promovidos por decisión del usuario (Pablo).

### Estructura: 5 grupos por afinidad arquitectónica

| Grupo | Tema | Items | Esfuerzo |
|---|---|---|---:|
| **G6.A** | Multi-process foundation | Cliente-daemon split + WS hub (dedupe+stampede) + two-transport heartbeat + profile system multi-daemon | 10-14 días |
| **G6.B** | Workspace GC tiered | 3-tier expansion (full / artifact-only / metadata-only) | 3-4 días |
| **G6.C** | Distributed compute | Embedded SSH server + SSH worker extension | 8-10 días |
| **G6.D** | Smart automation | Smart Router auto-invoke + Reaction Engine state machine | 8-10 días |
| **G6.E** | Power-user pipeline | `/yolo` full-auto pipeline | 4-6 días |

### G6.A — Multi-process foundation (el más ambicioso)

Este grupo cambia el modelo de proceso de Apohara: pasa de "1 binary monolítico que corre todo" a "daemon process en background + N clientes que conectan".

**Arquitectura propuesta:**

- `crates/apohara-daemon/` — proceso background que corre coordinator + hooks server + orchestration DB
- `crates/apohara-client/` — proceso cliente (UI Tauri, CLI commands) que conecta al daemon vía local socket + WS
- `crates/apohara-ws-hub/` — WS hub embedded en daemon con dedupe (`message_id` exactly-once) + stampede control (max-N concurrent subscribers per event)
- `crates/apohara-transport/` — abstracción de transporte: WS (preferred) + HTTP poll fallback (heartbeat duplo)
- `src/core/profiles/` — `~/.apohara/profiles/<name>.json` con múltiples daemons concurrentes (dev / staging / prod por proyecto)

**Sub-tareas G6.A** (~12 tareas):

- Daemon process bootstrap (systemd + launchd + Windows service via `apohara-persistence` crate ya existente)
- Local socket protocol (length-prefixed frames + envelope versioning)
- Client connect/reconnect con reintentos exponenciales
- WS hub: subscribe / publish / dedupe / stampede control
- HTTP poll endpoint para clientes que pierden WS
- Profile selection en client (`apohara --profile=<name>`)
- Migration de single-process → daemon (config detection)
- Backward-compat shim: si no hay daemon corriendo, arranca en monolithic mode (no-op para Sprint 4/5 outputs)
- Daemon healthcheck endpoint
- Client autostart-daemon-if-missing
- Daemon graceful shutdown + state checkpoint
- Multi-daemon coexistence (test con 3 profiles concurrentes)

### G6.B — Workspace GC 3-tier

`src/core/worktree/gc-tiered.ts` — actualmente solo `pruneStale` mtime-based. Expandir:

- **Tier 1 — Full retention:** worktree completo (~50-500MB cada uno)
- **Tier 2 — Artifact-only:** solo `target/release/`, `dist/`, `.next/`, etc. (~5-50MB)
- **Tier 3 — Metadata-only:** solo `task.json` + `result.json` + log (~1-10KB)

Política: edad + size budget. Cuando el disco supera threshold, downgrade Tier1→2→3. Sub-tareas: ~5.

### G6.C — Distributed compute

- `crates/apohara-ssh-server/` — embedded SSH server (vibe-kanban pattern). Bind 127.0.0.1, key-based auth, `apohara worker` subcommand entry
- `crates/apohara-remote-worker/` — symphony's WorkerLocation enum `{Local, Ssh{host, port}, Docker{image}, Kubernetes{...}}`

Sub-tareas (~10):
- SSH server bootstrap (russh crate)
- Key-based auth obligatorio (no password)
- `apohara worker` subcommand
- WorkerLocation enum + serialization
- Worker handshake protocol
- Task dispatch a worker remoto
- Worker result streaming back
- Worker disconnect recovery (task re-dispatch local)
- Audit-log de workers conectados
- E2E test con docker compose (3 workers en containers)

Caso de uso: workers en otras máquinas (mac remoto, GPU box, sandbox VM). Daemon orquesta; workers ejecutan.

### G6.D — Smart automation

**Smart Router** (`src/core/coordinator/intentClassifier.ts`):

- Greenfield. Intent enum: `Implement | Refactor | Debug | Document | Test | Explain | Review | Other`
- LLM-as-classifier (un Claude Haiku call con prompt cacheable) → enum + confidence
- Repeat-intent detection: si el mismo intent aparece 3× en 5min, auto-spawn al provider más adecuado
- Tabla `intent_classifications` en orchestration DB

**Reaction Engine** (`crates/apohara-reaction-engine/`):

- Expansion del github-bridge existente
- State machine 13 lifecycle states (`issue_opened → triaged → routed → in_progress → reviewing → merged | closed | stale | needs_clarification | blocked | escalated | rejected | rescheduled`)
- `reactions.conf` declarative: condition → action chains
- Sidecar reactor process (parte del daemon en G6.A)

Sub-tareas (~12):
- Intent enum + serialization (ts-rs SSoT)
- Classifier prompt + cache strategy
- Confidence threshold tuning
- Repeat-intent detection logic
- Auto-spawn integration con Coordinator (T4.6)
- Reaction Engine state machine implementation
- `reactions.conf` parser
- Action chain executor
- Sidecar reactor process bootstrap
- GitHub integration (issue → reaction)
- Smart Router precision/recall smoke dataset (50 prompts)
- E2E test Reaction Engine (issue opened → PR merged via reaction chain)

### G6.E — `/yolo` full-auto pipeline

`src/core/orchestration/yolo-mode.ts`. Bypass de approvals (con opt-in explícito), auto-spawn de toda la chain (decompose → dispatch → verify → commit → push → PR), con guardrails de "auto-rollback si N tests fail" + max-cost-per-run cap.

NO es destructivo by default — requiere TRIPLE OFF:
- `APOHARA_YOLO=1` env var
- UI toggle activado
- Per-workspace allowlist (`.apohara/yolo-allowed`)

Sub-tareas (~6):
- Yolo mode entry point
- Triple-gate check
- Auto-rollback on test fail
- Max-cost-per-run enforcement
- UI toggle component
- Per-workspace allowlist parser + check

### Estrategia de paralelización

- **Wave 1 (días 1-7):** 4 paralelos → G6.B (standalone), G6.E (standalone, simple), G6.D-SmartRouter (greenfield TS), G6.D-ReactionEngine (Rust crate)
- **Wave 2 (días 8-14):** 2 paralelos → G6.A (multi-process, 12 sub-tareas, asignar 2 implementers a sub-grupos), G6.C (SSH 10 sub-tareas)
- **Wave 3 (días 15-18):** Integration testing + smoke end-to-end + cross-platform validation

### Tests acumulados al cierre Sprint 6

- Start Sprint 6: ~850-900 (post-Sprint 5)
- End Sprint 6: ~1100-1200 (+250-300 nuevos)
- Foco: daemon lifecycle, client reconnect storms, WS dedupe under concurrent publish, GC tier transitions, SSH worker handshake + execution, Smart Router intent classification precision/recall, Reaction Engine state transitions, `/yolo` guardrails enforcement

### Riesgos críticos / decisiones

- **G6.A es el sprint más arriesgado:** cambiar el modelo de proceso afecta TODO (bootstrap, IPC, telemetry, UI connection). Mitigación: el shim backward-compat permite que toda la app FUNCIONE en monolithic mode si el daemon split no termina; el split queda como upgrade path detrás de feature flag (`APOHARA_DAEMON_MODE=1`).
- **G6.C SSH:** implica abrir un socket SSH local — riesgo de seguridad. Mitigación: bind explícito a 127.0.0.1, key-based auth obligatorio (no password), audit-log de todos los workers conectados.
- **G6.D Smart Router:** depende de LLM-as-classifier. Llamadas a Haiku tienen costo. Mitigación: prompt cache agresivo (sin cambiar el classifier prompt, 90%+ cache hits), max-classifications-per-hour cap.
- **G6.E `/yolo`:** peligro real de "agent rampage" — auto-commit auto-push auto-PR sin supervisión. Mitigación: el guardrail de "auto-rollback si N tests fail" + max-cost cap + per-workspace allowlist son obligatorios; sin uno de los 3, modo deshabilitado.

---

## §6 Sprint 7 — Ship + Polish (release v1.0.0)

**Duración estimada:** ~1-2 semanas si secuencial, ~5-7 días con paralelización.

**Outcome esperado:** `v1.0.0` tagged en GitHub, binaries reales attacheados al release para cada platform slug, `apohara` publicado a npm public registry, README en estado "repo-of-the-day", hero screenshot live, demo completo end-to-end verificado cross-platform.

### Estructura: 6 grupos

| Grupo | Tema | # tareas | Esfuerzo |
|---|---|---:|---:|
| **G7.A** | Release pipeline real | ~8 | 2-3 días |
| **G7.B** | Documentation + landing copy | ~10 | 2-3 días |
| **G7.C** | Polish UI/UX restantes | ~9 | 3-4 días |
| **G7.D** | CI/CD hardening | ~6 | 2 días |
| **G7.E** | Final integration smoke | ~6 | 2-3 días |
| **G7.F** | Release & tag | ~5 | 1 día |

### G7.A — Release pipeline real

Cerrar gaps entre `desktop-release.yml` actual (Tauri matrix Linux x64 / macOS x64+arm64 / Win x64) y lo que `npx-cli` espera (`apohara-desktop-<slug>` + `.sha256` sidecar por slug).

- Refactor `.github/workflows/desktop-release.yml`: agregar `linux-arm64` (cross-compile) + `win32-arm64`, generar `.sha256` sidecar por binary, renombrar artifacts al esquema `apohara-desktop-<slug>`
- Cleanup `.github/workflows/release.yml` legacy (apunta a `isolation-engine/` que ya no existe)
- Nuevo `.github/workflows/npm-publish.yml` para `npx-cli/` en tag push
- Bump `Cargo.toml` workspace version `1.0.0-dev` → `1.0.0`
- Bump `npx-cli/package.json` version `0.1.0` → `1.0.0`
- Bump `package.json` raíz si aplica
- End-to-end smoke test: `npx apohara@1.0.0` desde dir limpio en VM/Docker

### G7.B — Documentation + landing copy

El audit de nimbalyst-landing dejó 6 ❌ + 4 🟡 — todos resolubles con copy-work, no código.

- README principal: incorporar copy pre-escrito en plan §11.6 (pain→relief grid de 5 items + tagline "For builders who ship")
- Trust badges (build passing, tests, license, version) + DOI link al paper INV-15 (`10.5281/zenodo.20114594` de `ROADMAP.md:35`)
- Hero screenshot: ejecutar `seed-demo` button → capture del kanban+VerificationTimeline footer → `docs/img/hero.png`
- `CHANGELOG.md` con notas curated de v1.0 (Sprints 1-7 distilled)
- `docs/architecture.md` (overview + diagram Mermaid)
- `docs/getting-started.md` (5-min quickstart)
- `docs/troubleshooting.md` (common errors + soluciones)
- `apohara doctor` output polish (banners + actionable hints)
- Logo wall placeholder (F4) — fill post-launch
- Testimonials slot (F5) — placeholder vacío

### G7.C — Polish UI/UX restantes

- Permission grid (chorus H10, resolver AMBIGUO)
- Notifier multi-subscribe (chorus H19)
- EventSource onReconnect backfill (chorus H18)
- Last-Event-ID en SSE para resume (agentrail #12)
- Sound files para notifications (vibe-kanban #17)
- Statusline bridge (claude-octopus #3)
- F11 hero screenshot en UI (no solo README)
- F13 footer copy + F7 download CTA en README
- OSC 998 command-state escape rendering (T3.17)

### G7.D — CI/CD hardening

- Expand `.github/workflows/ci.yml` matrix: Node 20 + 22 × Linux + macOS + Windows
- Cargo audit gate en cada PR
- License scan (cargo-deny + license-checker)
- Bundle size guard: regression si crece >10% sin justificación
- Performance regression smoke benchmarks
- E2E test que ejecute `npx apohara@<dev-sha>` desde tarball

### G7.E — Final integration smoke

- End-to-end smoke en máquina limpia: `npx apohara` → arranca UI → seed-demo → click Run → 3 CLIs dispatched → result.json → kanban "Done" → AI commit MCP propone → user approves → commit landed → PR via `gh` wrapper → check PR creado
- Restart scenarios: daemon crash mid-run → client reconnect → state recovery
- SSH worker disconnect: worker remoto pierde conexión → task re-dispatched local
- Cross-platform smoke: el mismo flow en Linux + macOS (M-series + Intel) + Windows
- Suite completa final: ~1300+ tests verde
- Doctor + verify-setup: `apohara doctor` green en las 3 plataformas

### G7.F — Release & tag

- `git tag v1.0.0` + `git push --tags`
- Trigger automático de `desktop-release.yml` + `npm-publish.yml`
- Verify GitHub Release tiene 6 binarios (linux-x64/arm64, darwin-x64/arm64, win32-x64/arm64) + 6 `.sha256` sidecars + .dmg/.deb/.AppImage/.msi bundles
- Verify `npm install -g apohara@1.0.0` funciona y arranca
- Draft de social announcements (no posted hasta OK del usuario)
- Engram memory dump: state final del proyecto + métricas Sprint 4-7

### Tests al cierre Sprint 7

- Start: ~1100-1200 (post-Sprint 6)
- End: ~1300-1400 (+150-200 nuevos)
- Foco: cross-platform smoke matrix, npm install smoke, daemon crash recovery, SSH disconnect, perf regression baselines

### Riesgos / decisiones

- **G7.A platform matrix:** `linux-arm64` cross-compile en `ubuntu-22.04` necesita `cross` o `qemu-user-static`. Si no compila clean, fallback a self-hosted runner ARM. Decisión durante ejecución.
- **G7.E SSH worker recovery:** si el worker remoto NO se recupera limpio, decisión: marcar SSH como "beta opt-in" en v1.0 y mover hardening a v1.1. No bloquea release.
- **G7.F tag v1.0.0 timing:** si Sprint 6 tuvo regressions críticas (ej. G6.A daemon split inestable), opción a re-cortar como `v1.0.0-rc.1` y dejar `v1.0.0` para post-soak. Decisión al cierre de Sprint 6.

---

## §7 Testing strategy

**Filosofía:** TDD bite-sized por tarea (failing test → minimal impl → passing test → commit), suite gateada incremental, OOM-safe en Rust, cross-platform en CI.

### Suite gateada por sprint

| Sprint | Start | Target | Nuevos | Foco |
|---|---:|---:|---:|---|
| 4 (Foundation) | 505 | 620-650 | +115-145 | Token accounting, DurablePromptStore replay, Coordinator loop, Protocol compliance, JSONC roundtrip, Versioned Config migration |
| 5 (Mid-stack) | 620-650 | 850-900 | +200-280 | ProtocolInterface compliance per provider, continuation replay, lane priority, Pre/PostCompact contract, Filter DSL parser, Whisper framing, JSON-Patch, projector, RFC2119 profiles |
| 6 (Promovidos) | 850-900 | 1100-1200 | +250-300 | Daemon lifecycle, client reconnect storms, WS dedupe under concurrent publish, SSH worker handshake, Smart Router precision/recall, Reaction Engine state transitions, /yolo guardrails |
| 7 (Ship) | 1100-1200 | 1300-1400 | +150-200 | Cross-platform smoke matrix, npm install smoke, daemon crash recovery, SSH disconnect, perf regression baselines |

### Comando gate

```bash
bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/
```

`bun test` sin filtro sweepa Playwright e2e specs y rompe (regla earned the hard way). El gate de cada commit usa la suite explícita.

### Rust testing (OOM hazard preserved)

Regla §10 R1 del spec v1.0 — NUNCA `cargo test` bare o `cargo test -p apohara-indexer` (BERT 400MB × lib + integration paralelo = OOM). Mantenemos:

```bash
cargo test -p <crate> --lib
cargo test -p <crate> --test <integration_name>
```

Cada crate nuevo de Sprint 6 (`apohara-daemon`, `apohara-client`, `apohara-ws-hub`, `apohara-transport`, `apohara-ssh-server`, `apohara-remote-worker`, `apohara-reaction-engine`) sigue el mismo patrón. `APOHARA_MOCK_EMBEDDINGS=1` queda como flag obligatorio en CI.

### CI matrix expansion (Sprint 7 / G7.D)

Actual: `[ubuntu-latest, macos-latest, windows-latest]` × bun 1.3.13.

Expandido:
- OS: `[ubuntu-22.04, ubuntu-24.04, macos-13, macos-14, windows-2022]`
- Node: `[20, 22]`
- Rust: `stable`
- Bun: `1.3.13` (pinned)

Total: 5×2 = 10 jobs. `fail-fast: false`.

### Performance regression baselines

Baseline establecido una vez al cierre Sprint 5:
- Decompose time (SPEC.md → tasks manifest) — target <500ms
- Dispatch time (Run click → first task scheduled) — target <100ms
- Run end-to-end (prompt → claude-code-cli → result.json) — target <10s
- Indexer query (FTS5 search) — target <50ms (con `APOHARA_MOCK_EMBEDDINGS=1` skip BERT)

Cada PR corre los benchmarks; falla si regression >10% sin justificación en commit message.

### Cross-platform validation (Sprint 7 / G7.E)

End-to-end smoke en 3 plataformas: Linux + macOS (M-series + Intel) + Windows 11 (WSL2 + nativo).

Ejecuta el flujo completo: instalar → arrancar UI → seed-demo → Run 3 providers → kanban Done → AI commit MCP → PR via `gh`.

### Bundle size guards

- `target/release/apohara-desktop`: regression test falla si crece >10% sin justificación
- `npx-cli/dist/cli.js`: target <500KB
- `packages/desktop/dist/`: bundle size budget por chunk (Vite output)

### Testing antipatterns prohibidos

Reglas earned the hard way en Sprints 1-3:

- **NO** usar `bash -c "echo X"` en PTY tests — bash no flushea stdout via PTY antes de exit (bun 1.3 + node-pty 1.1)
- **NO** usar timeouts arbitrarios — usar event-based waiting o condition polling
- **NO** mockear DB en integration tests — corren contra real bun:sqlite
- **NO** usar `git add .` en implementers paralelos — staging explícito por archivo (race condition con waves)

---

## §8 Error handling + rollback strategy

### Per-task atomic commits

Cada tarea cierra con un commit propio (HEREDOC message + `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>`). Rollback granular: `git revert <commit>` desbloquea una sola tarea sin tocar otras.

### Feature flags obligatorios para items riesgosos

| Sprint | Tarea | Flag | Default |
|---|---|---|---|
| 6 | G6.A daemon split | `APOHARA_DAEMON_MODE=1` | OFF — fallback monolithic |
| 6 | G6.C SSH worker | `APOHARA_REMOTE_WORKERS=1` | OFF |
| 6 | G6.D Smart Router | `APOHARA_SMART_ROUTER=1` | OFF — manual provider selection |
| 6 | G6.E `/yolo` pipeline | `APOHARA_YOLO=1` + UI toggle + per-workspace allowlist | TRIPLE OFF (los 3 requeridos) |
| 6 | G6.D Reaction Engine | `APOHARA_REACTIONS=1` | OFF |

Los items greenfield de Sprint 6 son OPT-IN. Si rompen, el código queda en repo pero usuarios `v1.0.0` no se afectan. v1.1 puede activar default-on cuando madure.

### Migration backward-compat (G6.A foco)

El cliente-daemon split toca el modelo de proceso:

1. Sprint 6 entrega ambos modos coexistiendo (monolithic = default, daemon = `APOHARA_DAEMON_MODE=1`)
2. `apohara doctor` reporta cuál modo está activo + recomendación
3. `apohara migrate-to-daemon` command opcional para usuarios power
4. v1.1 considera flip de default — no en este plan

### Recovery scenarios documentados

Cada sprint produce un `RECOVERY.md` con scenarios verificados:

- Sprint 4: Coordinator crash mid-loop → reconciler tick recovery
- Sprint 5: Provider spawn timeout → runSerialized queue drain
- Sprint 6: Daemon crash → client reconnect con state replay desde JSONL ledger
- Sprint 6: SSH worker disconnect → task re-dispatch local con loss-warning UI
- Sprint 7: npm install corruption → npx-cli sha256 verification rechaza + retry next version

### Rollback per-sprint (no comprometemos main)

Cada sprint en sub-branch derivada de `feat/apohara-ultimate`:

- `feat/apohara-ultimate-sprint-4` → squash-merge a `feat/apohara-ultimate` al cierre
- `feat/apohara-ultimate-sprint-5` → idem
- `feat/apohara-ultimate-sprint-6` → idem
- `feat/apohara-ultimate-sprint-7` → cierra con `v1.0.0` tag desde `feat/apohara-ultimate`

Si un sprint falla irrecuperable al cierre, su sub-branch queda como dead-end documentado; el siguiente sprint deriva de `feat/apohara-ultimate` pre-fallido. NUNCA tocamos `main` hasta merge final post-release.

---

## §9 Out of scope / non-goals

### Identidad del producto (las 11 decisiones "NO robamos" siguen vigentes)

| Lo que NO incorporamos | De dónde | Por qué |
|---|---|---|
| Electron entero | orca + nimbalyst | Apohara es Tauri, 10× más liviano |
| PostgreSQL + pgvector + sqlc | multica + chorus | bun:sqlite + Rust SQLx es local-first correcto |
| Multi-tenant `companyUuid` | multica + chorus | Single-user-per-machine |
| OAuth flows / Stytch / JWT | nimbalyst + multica + chorus | **Hard rule Apohara: CLI wrappers only** (TOS prohíbe OAuth en varios providers) |
| ElectricSQL collab | vibe-kanban | Heavy infra, no cloud sync |
| iOS/Android mobile companion | nimbalyst + orca | Defer hasta v2 |
| PostHog telemetry | varios | Local-first, no spying — install-id anónimo + denylist OK (spec v1.0 §0.33) |
| IRC server engine | culture | Wrong shape para orchestrator |
| GitHub-issue-centric lifecycle | agentrail | github-bridge es opcional opt-in |
| Marketplace business model | nimbalyst | Defer |
| Plugins multi-marketplace (.opencode/.claude/.codex/.cursor/.factory) | claude-octopus | Sin shipping model |

### Items explícitamente diferidos a post-v1.0 (NO Apohara Ultimate)

| Item | Por qué post-v1.0 | Cuándo |
|---|---|---|
| Cloud sync entre máquinas | Necesitaría backend, contradice local-first | v2 (nuevo proyecto) |
| Plan-as-a-service (Apohara hosted) | Modelo de negocio fuera de scope | Nunca con este nombre |
| Voice control (real-time STT) | Heavy ML deps | v2 si demanda |
| Mobile companion | Prioridad baja en user-base actual | v2 |
| Multi-language UI (i18n) | Bilingual ES/EN copy en docs cubre 80% audiencia | v1.1+ si tracción |

### Anti-features (decisión explícita)

- **Sin OAuth para providers**: aún si un provider lo soporta, Apohara NO lo usa. CLI wrappers ONLY.
- **Sin auto-update default-on**: el updater detecta + notifica, NUNCA descarga sin consentimiento.
- **Sin telemetry default-on**: install-id anónimo opt-in con denylist visible.
- **Sin auto-commit default-on**: AI commit propose es opt-in approval.

---

## §10 Referencias cruzadas (audit data agregada)

### Conteos por repo (del re-audit 2026-05-22)

| Repo | ✅ COMPLETO | 🟡 PARCIAL | ❌ NO IMPLEMENTADO | 🚫 RECHAZADO | ❓ AMBIGUO | Total |
|---|---:|---:|---:|---:|---:|---:|
| orca | 4 | 9 | 4 | 0 | 0 | 17 |
| nimbalyst | 12 | 22 | 10 | 0 | 1 | 45 |
| chorus | 2 | 6 | 9 | 2 | 0 | 19 |
| culture | 5 | 4 | 6 | 0 | 0 | 15 |
| claude-octopus | 3 | 8 | 6 | 0 | 0 | 17 |
| symphony | 3 | 7 | 4 | 0 | 1 | 15 |
| agentrail | 6 | 7 | 3 | 0 | 1 | 17 |
| multica | 0 | 6 | 12 | 0 | 0 | 18 |
| vibe-kanban | 4 | 9 | 5 | 0 | 2 | 20 |
| nimbalyst-landing | 4 | 4 | 6 | 1 | 0 | 15 |
| **TOTAL** | **43** | **82** | **65** | **3** | **5** | **198** |

### Distribución de hallazgos por sprint

| Sprint | Cubre | # hallazgos |
|---|---|---:|
| 4 (Foundation) | 8 bug-barrels críticos (~8 hallazgos directos pero impactan ~15-20 dependientes) | ~20 |
| 5 (Mid-stack) | 65 ❌ NO IMPLEMENTADO + 82 🟡 PARCIAL | ~147 |
| 6 (Promovidos) | 7 items v1.1+ originales + 3 adicionales chorus/multica | ~10 |
| 7 (Ship) | 5 hallazgos polish/UX + landing copy (6❌ + 4🟡) | ~15 |

Sprint 4 + 7 cierran cosas que no aparecen 1-a-1 en el conteo de hallazgos porque son cross-cutting (bug-barrels que impactan múltiples áreas, infrastructure de release que no estaba ni siquiera en los reportes originales). Por eso la suma cruza los 198 — un hallazgo puede tocarse en múltiples sprints (ej. Coordinator loop en Sprint 4 + completar comportamiento en Sprint 5).

### Trazabilidad: links a audits individuales

- [Audit orca](../../reference-mining/audit/orca.md) (17 hallazgos)
- [Audit nimbalyst](../../reference-mining/audit/nimbalyst.md) (45 sub-findings)
- [Audit chorus](../../reference-mining/audit/chorus.md) (19 hallazgos)
- [Audit culture](../../reference-mining/audit/culture.md) (15 hallazgos)
- [Audit claude-octopus](../../reference-mining/audit/claude-octopus.md) (17 hallazgos)
- [Audit symphony](../../reference-mining/audit/symphony.md) (15 hallazgos)
- [Audit agentrail](../../reference-mining/audit/agentrail.md) (17 hallazgos)
- [Audit multica](../../reference-mining/audit/multica.md) (18 hallazgos)
- [Audit vibe-kanban](../../reference-mining/audit/vibe-kanban.md) (20 hallazgos)
- [Audit nimbalyst-landing](../../reference-mining/audit/nimbalyst-landing.md) (15 hallazgos)
- [Índice maestro reference-mining](../../reference-mining/README.md)

---

## §11 Apéndices

### A. Glosario

- **Sprint** — unidad de planificación de 1-3 semanas (con paralelización agresiva, ~1 semana real)
- **Wave** — sub-unidad dentro de un sprint: tareas que se ejecutan paralelas porque comparten dependencias resueltas
- **Bug-barrel** — feature documentada en spec v1.0 como implementada pero cuyo código está ausente o stub
- **Promovido** — item del análisis original marcado v1.1+ que se promueve a Apohara Ultimate por decisión del usuario
- **CLI wrapper** — modo único de integración con providers (claude-code-cli, codex-cli, opencode-go) — NUNCA OAuth
- **Audit** — proceso 2026-05-22 donde 10 research agents en paralelo cruzaron 194 hallazgos vs código actual
- **Audit report** — output del audit, vive en `docs/reference-mining/audit/<repo>.md`
- **Identidad del producto** — las 11 decisiones "NO robamos" del sprint plan original que definen qué Apohara NO es

### B. Decisiones explícitas tomadas durante el brainstorming (2026-05-22)

1. **Filosofía estratégica:** Re-evaluar 194 hallazgos vs estado actual (vs. otras opciones: continuar Sprint 3, mix audit+nuevas, ship-first)
2. **Output shape:** Un solo spec gigante (vs. modular por subsistema)
3. **Alcance audit:** Todos los 194 (vs. solo ALTO/MEDIO, solo ALTO, smart sample)
4. **Items v1.1+:** Promover en bloque a Apohara Ultimate (vs. re-evaluar uno por uno, vs. respetar diferimiento)
5. **Estrategia de sprints:** Por capas — foundation → features → polish (vs. por categoría, por valor ROI, ship-first compacto)

### C. Métricas del brainstorming en sí

- Duración del brainstorm (preguntas + audit + secciones): ~2 horas
- Agentes despachados: 10 paralelos de extracción + 10 paralelos de audit = 20 agents
- Tokens consumidos en agents: ~1.5M aproximado
- Archivos generados: 22 (10 hallazgos + 10 audits + 1 sprint plan reconstituido + 1 spec maestro)
- Líneas de spec final: ver `wc -l` de este archivo

### D. Próximos pasos después de aprobar este spec

1. **Step 7 (spec self-review):** Claude pasa este spec por placeholder scan + internal consistency check + ambiguity check. Fix inline.
2. **Step 8 (user reviews spec):** Pablo lee el archivo y aprueba o pide cambios.
3. **Step 9 (transition to writing-plans):** Si Pablo aprueba, Claude invoca skill `superpowers:writing-plans` para producir el plan de implementación per-sprint con pasos TDD bite-sized.

### E. Mantenimiento del spec

Este spec es **fuente de verdad** del scope Apohara Ultimate. Si durante ejecución de Sprint 4-7 algo cambia (ej. T4.7 revela schema gap, G6.A muestra que la migration es más cara, /yolo se recorta), el cambio se documenta en:

1. PR/commit que lo causa
2. Update a este spec en sub-sección "Decisiones tomadas durante ejecución" (a crear cuando aplique)
3. Engram memory entry con `mem_save` (tipo `decision`)

NUNCA dejar drift entre spec y código sin documentar.

---

*Fin del spec Apohara Ultimate.*
