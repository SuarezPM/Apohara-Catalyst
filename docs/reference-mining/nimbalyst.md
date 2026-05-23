Now I have comprehensive material. Let me compile the exhaustive report.

# Hallazgos en nimbalyst

Lo que sigue es el resultado de un análisis exhaustivo del repo `nimbalyst` con foco en patrones y features reaprovechables para Apohara. He filtrado mobile/voice/Excalidraw/Lexical-puro/PGLite-corruption-fix y otros temas que no aplican a un orquestador multi-AI con stack TS+Bun+Tauri+Rust. Cada hallazgo cita filepath absoluto en `_reference/nimbalyst/`.

---

## Categoría 1: Provider Driver Architecture (CLI + SDK Wrappers)

### Hallazgo 1.1: `BaseAgentProvider` como capa intermedia compartida
- **Qué**: Clase abstracta que centraliza abort controllers, session mapping (Apohara-id ↔ provider-id), permission lifecycle, polling para responses cross-device, security logging y best-effort message logging.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/packages/runtime/src/ai/server/providers/BaseAgentProvider.ts` (398 LOC). Sub-mixins: `ProviderPermissionMixin.ts`, `ProviderSessionManager.ts`.
- **Por qué inspira**: Apohara hoy tiene 21 providers en roster picker; sin una clase base como esta, cada provider re-implementa abort/session-map/permission-poll y diverge. La capacidad de "static dependency injection" (`BaseAgentProvider.setTrustChecker(...)` etc.) elimina dependencias circulares Electron↔runtime.
- **Cómo traducir**: Crear `apohara/src/core/providers/BaseProvider.ts` con la misma topología — TS abstract class, EventEmitter de Node usado vía Bun, inyección estática para `TrustChecker`/`SecurityLogger`/`PermissionSaver` desde Tauri commands. Sub-mixins idénticos pero sin acoplamiento a PGLite — Apohara usa el `ledger` JSONL.
- **Valor**: ALTO

### Hallazgo 1.2: `ProtocolInterface` para normalizar SDKs heterogéneos
- **Qué**: Interface `AgentProtocol` que abstrae Claude SDK, Codex SDK, Codex ACP, OpenCode HTTP/SSE, Copilot ACP detrás de `createSession`/`resumeSession`/`forkSession`/`sendMessage`/`abortSession`. Eventos tipados como discriminated union (`text|tool_call|reasoning|usage|complete`).
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/packages/runtime/src/ai/server/protocols/ProtocolInterface.ts` (250 LOC) + 6 implementaciones en `protocols/*.ts`.
- **Por qué inspira**: Apohara hoy mete 21 providers detrás de un capability-manifest pero el surface CLI wrapper queda ad-hoc por provider. Si los 3 wrappers oficiales (`claude`, `codex`, `opencode --pure`) implementan `AgentProtocol`, el scheduler los puede swap-in sin tocar el verifier ni el consolidator.
- **Cómo traducir**: `apohara/src/core/providers/protocols/AgentProtocol.ts` con la misma shape. Cada CLI wrapper expone una clase que speaks JSON-RPC over stdio (o newline-JSON) y emite `AsyncIterable<ProtocolEvent>`. La discriminated union calza directo con la xyflow event-stream que ya tienen.
- **Valor**: ALTO

### Hallazgo 1.3: Tres patrones de implementación claramente categorizados (Direct-SDK / Protocol-backed / CLI-backed)
- **Qué**: Documentación explícita en `AI_PROVIDER_TYPES.md` que clasifica providers en tres shapes con ejemplos: ClaudeCodeProvider (direct SDK), OpenAICodexProvider (SDK con protocol adapter), CopilotCLIProvider (ACP stdio puro).
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/AI_PROVIDER_TYPES.md` líneas 56-86, 207-272. "Suggested Templates" línea 273.
- **Por qué inspira**: Da una doctrina de "qué pattern usar" cuando agregás un nuevo provider — clave para Apohara con 21 cloud + 3 CLI. También enuncia regla anti-PTY: "Prefer structured protocols: ACP, JSON-RPC over stdio, newline-delimited JSON, local HTTP/SSE; Bad: ANSI scraping, TTY status parsing".
- **Cómo traducir**: Copiar el cuadro categorizador y la "Suggested Templates" list al `apohara/docs/PROVIDER_PATTERNS.md`. Apohara debería sumar un cuarto bucket: "Cloud HTTP wrappers (Openrouter, Together, Groq, ...)" para los 21 cloud providers detrás del roster picker.
- **Valor**: ALTO

### Hallazgo 1.4: Static Dependency Injection bucket (`ClaudeCodeDeps`)
- **Qué**: Patrón de un único objeto módulo-nivel que recolecta TODOS los loaders/ports/checkers que el provider necesita del proceso principal. Setters explícitos llamados una vez en startup.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/packages/runtime/src/ai/server/providers/claudeCode/dependencyInjection.ts` (224 LOC).
- **Por qué inspira**: Apohara tiene runtime (Bun TS) + Tauri main (Rust) y necesita cruzar info como "puerto del Rust indexer", "shell env loader", "permission pattern saver" sin acoplamiento bidireccional. Este patrón evita imports circulares y permite mockear todo en tests.
- **Cómo traducir**: `apohara/src/core/providers/deps.ts` con shape `ApohraDeps = { indexerPort: number | null, ledgerWriter: ..., capabilityManifest: ..., setIndexerPort(p): void, ... }`. El bootstrap de Tauri llena los slots vía un `init.ts`. Tests instalan fakes.
- **Valor**: ALTO

### Hallazgo 1.5: Sanitización defensiva de API keys del environment
- **Qué**: El provider strippea `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` de `process.env`, `shellEnv`, y `settingsEnv` antes de pasarlos al subproceso, justamente para evitar el incidente "user .env file caused $100 charge to personal Anthropic account".
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/packages/runtime/src/ai/server/providers/claudeCode/sdkOptionsBuilder.ts` líneas 253-255. Razonamiento explícito en `CLAUDE.md` "Never Use Environment Variables as Implicit API Key Sources".
- **Por qué inspira**: Apohara explícitamente NO usa API keys (`opencode --pure`), pero el principio aplica: cuando spawneás un CLI subprocess, los envs que el usuario tiene seteados para otras cosas pueden ser sniffed por el CLI y cambiar su comportamiento (e.g., billing source). El cliente debe partir de un env sanitizado.
- **Cómo traducir**: `apohara/src/core/sandbox/envSanitizer.ts` con una blocklist exhaustiva (no solo API keys; también `*_TOKEN`, `*_SECRET`, AWS/GCP/Azure creds). Aplicar en TODA llamada `child_process.spawn` o `tauri-plugin-shell`. Documentar la lista en `apohara/docs/SECURITY.md`.
- **Valor**: ALTO

### Hallazgo 1.6: Persistent prompt stream para evitar stdin-close mid-turn
- **Qué**: Trampa hallada empíricamente: el SDK cierra el pipe stdin del binario al recibir `type: 'result'`, lo cual rompe los `can_use_tool` tardíos. Solución: usar un `AsyncIterable` infinito controlado por un `PromptStreamController.end(reason)`.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/packages/runtime/src/ai/server/providers/claudeCode/sdkOptionsBuilder.ts` líneas 72-118 (`createPersistentPromptStream`). Comentario explica el bug en detalle.
- **Por qué inspira**: Apohara va a sufrir el mismo bug porque también encadena CLI wrappers con tools tardíos. La regla "isSingleUserTurn=false" se traduce a "el caller necesita decidir cuándo el subprocess realmente puede cerrar stdin".
- **Cómo traducir**: Wrapper genérico `apohara/src/core/providers/streams/persistentStdin.ts` que cualquier driver use cuando spawnea su CLI. Expone `{ writeMessage(msg), end(reason) }`.
- **Valor**: MEDIO

### Hallazgo 1.7: `AgentMessageWriteQueue` con coalescing 200ms idle / 200 rows
- **Qué**: Cola FIFO que coalesce escrituras de chunks del firehose en multi-row INSERTs para evitar starvation de awaited writes (user prompts, permission audits). Pressure logging cuando depth > 500 o flush > 200ms.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/packages/runtime/src/storage/repositories/AgentMessageWriteQueue.ts` (líneas 1-100 leídas, total ~400 LOC).
- **Por qué inspira**: El ledger de Apohara es JSONL con SHA-256 chain — escribir cada chunk es CARO (hash chain, fsync). Lo mismo bug aplica: chunks de stream pueden starve awaited writes (user input, verifier responses).
- **Cómo traducir**: `apohara/src/core/ledger/eventWriteQueue.ts` con misma topología — idle window 200ms, threshold 200 events, batch fsync. Mantiene SHA chain (chunked: hash batch como un Merkle node). El `replay` se beneficia: lee batches enteros en lugar de un fsync por evento.
- **Valor**: ALTO

---

## Categoría 2: Session / Worktree Lifecycle

### Hallazgo 2.1: Two-layer session invariant ("workstream → session", no grandchild)
- **Qué**: Regla de hierarchy enforced en tres lugares: `MetaAgentService.resolveOrCreateWorkstream`, `convertToWorkstreamAtom`, y una migration en `worker.js`. "A worktree IS the workstream" — no separate row.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/SESSION_HIERARCHY.md` completo (93 líneas). Tabla de roles válidos línea 22.
- **Por qué inspira**: Apohara tiene DAGs (xyflow) — un task puede tener subtasks que tienen subtasks, lo que crea exactamente el mismo "third-layer" bug. Una doctrina explícita "max 2 levels en el plano de display" simplifica el TaskBoard kanban y previene el caso "worktree contiene 4 sesiones pero existen 10" (filter swallow).
- **Cómo traducir**: Documentar en `apohara/docs/DAG_HIERARCHY.md` una invariante similar — el DAG puede ser arbitrario internamente, pero el TaskBoard kanban proyecta solo "raíces + 1 nivel", colapsando el resto. Triple enforcement: en `decomposer`, en `consolidator`, y en una migration al cargar runs viejos.
- **Valor**: ALTO

### Hallazgo 2.2: WorktreeReliability — 9 failure modes específicos con fixes
- **Qué**: Lista de 9 bugs con repros y fixes documentados (DB-Git inconsistency on create, no recovery for partial archive failures, squash destructive without backup, no operation locking, archive queue no persistence, stash pop failures, no health validation, deletion doesn't verify git index, name dedup race).
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/WORKTREE_RELIABILITY_IMPROVEMENTS.md` (183 líneas).
- **Por qué inspira**: Apohara YA tiene `worktree-manager.ts` con `adopt-orphan`/`prune-stale`/`lock files`. Este doc es un checklist de qué más hay que cubrir: backup branch antes de squash, operation locking (Map<repoPath, Promise>), persistent archive queue (JSON crash-recovery), startup consistency check ("sessions archived but worktree not").
- **Cómo traducir**: Implementar cada uno en `apohara-indexer` (Rust crate ya tiene file locks via redb) o `scheduler/worktree-manager.ts`. Crítico el #2 — "startup consistency check" porque Apohara tiene replay del ledger y este check debe correr antes de iniciar nuevas runs.
- **Valor**: ALTO

### Hallazgo 2.3: `crystal-run.sh` worktree-aware build cache
- **Qué**: Script que detecta `.git` como file (worktree) vs directory (main repo), compara source hashes entre worktree y main, y si no hay cambios COPIA el `dist/` del main repo en lugar de rebuildar — speedup masivo para spawning de workers paralelos.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/crystal-run.sh` líneas 18-100 (detect_worktree, package_has_worktree_changes, main_repo_has_dist, copy_dist_from_main_repo, compute_source_hash via `git ls-files`).
- **Por qué inspira**: Apohara puede spawn N worktrees por task con scheduler. Si cada worktree corre `bun install + bun build`, latency es prohibitiva. Cache desde main repo basado en content-hash (no timestamps) es worktree-safe.
- **Cómo traducir**: `apohara/scripts/worktree-bootstrap.sh` (o un comando Rust en `apohara-indexer`) que haga content-hash de `package.json + bun.lockb + src/` y skippee bun install si el main repo ya tiene `node_modules` válido y los hashes coinciden.
- **Valor**: ALTO

### Hallazgo 2.4: Adjective-noun naming + idempotent retry on collision
- **Qué**: Genera nombres tipo `swift-falcon`, `worktree/swift-falcon` como branch. La race condition cuando 2 requests pasan el mismo dedup check se soluciona con optimistic concurrency + retry (max 3) si git falla con "branch already exists".
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/WORKTREES.md` líneas 86-103 y `WORKTREE_RELIABILITY_IMPROVEMENTS.md` #9 línea 152.
- **Por qué inspira**: Apohara YA tiene worktree-manager pero usa probablemente ULIDs o nombres planos. Adjective-noun es MUCHO más user-friendly en TopBar y kanban; el retry pattern es defensivo contra concurrent task spawns del scheduler.
- **Cómo traducir**: Tabla de adjetivos+sustantivos en `apohara/src/core/scheduler/worktreeNames.ts`. La retry en el lock-then-create flow del worktree-manager.
- **Valor**: MEDIO

---

## Categoría 3: Interactive Prompts & Verification Mesh

### Hallazgo 3.1: Durable interactive prompts (no transient UI state)
- **Qué**: 5 tipos de prompts (AskUserQuestion, PromptForUserInput, ExitPlanMode, GitCommitProposal, ToolPermission) persistidos en DB como source-of-truth. Widgets renderizan de `toolCall.arguments`/`toolCall.result`, NUNCA de local state. Esto sobrevive remounts, session switches, process restarts.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/INTERACTIVE_PROMPTS.md` (140 líneas). Implementaciones en `packages/electron/src/main/mcp/tools/interactiveToolHandlers.ts`, `codexToolCallResolver.ts`.
- **Por qué inspira**: Apohara dual-arbiter (judge≠critic) emite prompts al user para resolver disputes. Si cada prompt es ephemeral UI state, el user pierde el contexto cuando hace replay de un run viejo o cambia de pane. Persistir todo en el ledger + render-from-ledger garantiza que `apohara replay <run-id>` muestre el prompt EXACTO con respuesta tal cual.
- **Cómo traducir**: Cada AskUser/Verifier-conflict/ToolPermission emite un evento JSONL al ledger. El SwarmCanvas/CodeDiffPane renderiza desde ledger, no desde React local state. Usar Lexical/Monaco son agnostic.
- **Valor**: ALTO

### Hallazgo 3.2: Prompt ID alias resolution centralizado
- **Qué**: Codex emite el mismo prompt con 3 ids distintos (raw `call_...`, synthetic `nimtc|call_...|ts|idx`, fallback `rui-sessionId-ts`). Centralizado en `codexToolCallResolver.ts` con helpers `resolveToolUseIdFromMcpRequest`, `resolveRequestUserInputPromptTargets`. Persistencia guarda AMBOS `promptId` y `rawPromptId`.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/INTERACTIVE_PROMPTS.md` líneas 26-58. Code en `packages/electron/src/main/mcp/tools/codexToolCallResolver.ts`.
- **Por qué inspira**: Apohara mezcla 24 providers + meta-agents + verifiers — el mismo "approve commit?" puede tener un id en el judge, otro en el critic, otro en el ledger. Centralizar el alias map en un helper evita que cada lugar invente reglas distintas (que es exactamente el bug que ellos describen costó 23 turnos debug).
- **Cómo traducir**: `apohara/src/core/verification-mesh/promptIdResolver.ts` que mapea cualquier id de prompt a su canonical + aliases. El ledger guarda `{ promptId, aliases: [...] }` para que el replay matchee independientemente del path.
- **Valor**: MEDIO

### Hallazgo 3.3: Two-channel waker (exact + session-fallback)
- **Qué**: Cuando el waiter MCP bloquea esperando una respuesta y el renderer puede submitir con un id distinto, además del exact channel hay un session-scoped fallback channel. Validado para evitar abuse: solo se acepta unrelated ids cuando el waiter ya está bloqueado en un synthetic fallback.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/INTERACTIVE_PROMPTS.md` líneas 80-90.
- **Por qué inspira**: Apohara cross-pane communication (SwarmCanvas → AskUserQuestion → ledger → judge espera) puede sufrir el mismo deadlock. El pattern exact+fallback con narrow validation es generalizable.
- **Cómo traducir**: `apohara/src/core/eventbus.ts` con `wait('exact-channel', { fallback: 'session-channel', validate: ... })`.
- **Valor**: MEDIO

### Hallazgo 3.4: PostMessage polling con exponential backoff para DB ↔ IPC bridge
- **Qué**: Cuando el IPC fast-path falla, el waiter polls la DB cada 500ms → 5s (1.5x backoff), max 5 min, max 50 messages. Busca `nimbalyst_tool_result` que matchee el `requestId`, valida shape antes de aceptar.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/packages/runtime/src/ai/server/providers/BaseAgentProvider.ts` líneas 166-255.
- **Por qué inspira**: Apohara verification-mesh espera respuestas async — judge bloqueado pidiendo critic-resolution. Si el critic crashea el judge debería poder reanudar al next launch via DB polling.
- **Cómo traducir**: `apohara/src/core/verification-mesh/pollResponse.ts` que polls el ledger por eventos matching, con validación + backoff.
- **Valor**: MEDIO

---

## Categoría 4: Permission System (Trust + Patterns)

### Hallazgo 4.1: Pattern-based permission cache con tres scopes (once/session/always)
- **Qué**: Permission patterns como `Bash(npm test:*)`, `WebFetch(domain:github.com)`. Tres scopes de aprobación: una vez, sesión completa (Set in-memory), siempre (file `.claude/settings.local.json`). Cache memoria DEBE existir porque el SDK no hot-reloads settings file.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/AGENT_PERMISSIONS.md` líneas 70-200, 335. Implementación en `packages/runtime/src/ai/server/permissions/ToolPermissionService.ts` (no leída, ~varias hundred LOC).
- **Por qué inspira**: Apohara verification-mesh ya tiene SafetyGate (INV-15 JCR). Pero NO tiene un sistema fino de patterns persistidos. El kit de `bash:npm:test:*` + `Bash(git commit:*)` patterns ahorra al user 100 prompts/día y es exactamente lo que un orquestador necesita.
- **Cómo traducir**: `apohara/src/core/safety/patterns.ts` con scopes `once|session|always`. Storage: `apohara/.claude/settings.local.json` (compatible con CLI Claude) — y un global `~/.apohara/settings.json` para defaults user-level. Sesión = Map<string, Pattern> in-memory.
- **Valor**: ALTO

### Hallazgo 4.2: Compound command splitter (`&&`, `||`, `;`)
- **Qué**: SDK bash matching es simple-prefix → `Bash(git status:*)` podría aceptar `git status && rm -rf /`. PreToolUse hook intercepta compound commands y evalúa CADA sub-command separadamente. Pattern `Bash:compound:*` NUNCA se persiste (only once-approve).
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/AGENT_PERMISSIONS.md` líneas 430-447. Implementation en `packages/runtime/src/ai/server/providers/claudeCode/toolPolicy.ts` y `BashCommandAnalyzer.ts`.
- **Por qué inspira**: Apohara va a tener el mismo bug — cualquier verifier que approve un bash pattern puede ser engañado por compound. La regla "compound nunca persiste como always" es defensiva.
- **Cómo traducir**: `apohara/src/core/safety/bashCompoundAnalyzer.ts` con el splitter (parse-aware, no regex), llamado desde el SafetyGate antes de aplicar pattern matching.
- **Valor**: ALTO

### Hallazgo 4.3: Garbage pattern filtering (Claude's output bleeding into bash patterns)
- **Qué**: Patrones tipo `Bash(const:*)`, `Bash([]:*)`, `Bash(//:*)`, `Bash(\`\`\`:*)` son código fragments incorrectly parseados como bash y se rechazan al persistir.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/AGENT_PERMISSIONS.md` líneas 448-454.
- **Por qué inspira**: Apohara va a tener exactamente este bug — el judge/critic emite texto con backticks o code fences que puede llegar al pattern saver.
- **Cómo traducir**: Validation list de "obvious garbage tokens" en `apohara/src/core/safety/patternValidator.ts`.
- **Valor**: BAJO

### Hallazgo 4.4: Three-tier settings hierarchy (~/.claude → .claude/settings.json → .claude/settings.local.json)
- **Qué**: User-global → project-shared (commit to git) → project-personal (gitignored). Merged later-overrides-earlier. Compatible con Claude CLI nativo.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/AGENT_PERMISSIONS.md` líneas 290-320.
- **Por qué inspira**: Apohara puede compartir el MISMO `.claude/settings.local.json` con la CLI oficial de Claude → cero fricción para usuarios que ya usan claude code, y cualquier permission approved en CLI se respeta en Apohara y viceversa.
- **Cómo traducir**: `apohara/src/core/safety/settingsHierarchy.ts` que reads/merges los 3 archivos en mismo orden. Convivencia con `apohara/settings.json` para features apohara-specific.
- **Valor**: ALTO

---

## Categoría 5: Transcript / Event Pipeline

### Hallazgo 5.1: Two-tier append-only log + derived canonical events
- **Qué**: `ai_agent_messages` (raw, append-only, sole source of truth) → `TranscriptTransformer` (single writer) → `ai_transcript_events` (canonical 12-type discriminated union: user_message, assistant_message, tool_call_started, tool_progress, subagent_started, interactive_prompt_created, turn_ended, etc.). Versioned (`CURRENT_VERSION = 4`) → bumping re-transforms everything.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/TRANSCRIPT_ARCHITECTURE.md` (227 líneas). Code en `packages/runtime/src/ai/server/transcript/`.
- **Por qué inspira**: Apohara ledger ES exactamente el "raw append-only" tier. Lo que NO tiene es el "canonical projection" tier. Replay actual reconstruye estado desde raw; agregar projection canonical permitiría: SwarmCanvas render del DAG sin reparsear cada raw, TaskBoard kanban (la proyección que Ultimate v1.0 quiere), search/FTS, y mobile-style sync.
- **Cómo traducir**: `apohara/src/core/ledger/projector.ts` que sigue watermark (`canonical_last_raw_event_id`) y emite canonical events tipados. El SwarmCanvas reads canonical, el ledger sigue siendo raw. `CURRENT_VERSION` para regenerar projections cuando cambian.
- **Valor**: ALTO

### Hallazgo 5.2: Provider-agnostic canonical events (parsers as pure functions)
- **Qué**: Cada provider tiene un `IRawMessageParser` que mapea raw chunks a `CanonicalEventDescriptor[]`. Parsers son funciones puras (no escriben a DB, no traen state), el transformer maneja write + tool-ID tracking. `ParseContext` provee dedup state (`hasToolCall`, `findByProviderToolCallId` DB fallback).
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/packages/runtime/src/ai/server/transcript/parsers/IRawMessageParser.ts` + `ClaudeCodeRawParser.ts`, `CodexRawParser.ts`.
- **Por qué inspira**: Apohara con 24 providers necesita exactamente esto: cada wrapper escribe raw a ledger, un parser por wrapper produce canonical, el SwarmCanvas no necesita saber de qué provider salió cada nodo.
- **Cómo traducir**: `apohara/src/core/providers/parsers/` con `ClaudeParser.ts`, `CodexParser.ts`, `OpenCodeParser.ts` (más uno por cada cloud provider que sume eventos custom). Test contract común.
- **Valor**: ALTO

### Hallazgo 5.3: Per-step usage vs cumulative usage distinction
- **Qué**: Context-fill display lee `chunk.message.usage` (per-step), NO `result.usage` (cumulative — `inputTokens=3,100,000` wildly wrong). Trackean dos campos separados: `usageData` (general) vs `lastAssistantUsage` (per-step, never overwritten by result). Compact-boundary resetea `lastAssistantUsage`.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/CONTEXT_WINDOW_USAGE_TRACKING.md` (109 líneas).
- **Por qué inspira**: Apohara TopBar tiene cost meter. Si suma cumulative tokens va a mostrar números demenciales. El context-fill % es la métrica más usable para el usuario.
- **Cómo traducir**: En cada provider parser, distinguir `step_usage` vs `cumulative_usage`. TopBar muestra "% context" desde step + "$ total turn" desde cumulative. Subagent (sub-DAG en Apohara) NO contamina el parent.
- **Valor**: MEDIO

### Hallazgo 5.4: Compact-boundary handling (no assistant message after `/compact`)
- **Qué**: Cuando user corre `/compact`, el SDK emite `system(compact_boundary)` SIN un `assistant` después, así que `lastAssistantUsage` queda stale. Fix: reset al ver `compact_boundary`, set `contextCompacted: true`, UI clears `currentContext`.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/CONTEXT_WINDOW_USAGE_TRACKING.md` líneas 52-71.
- **Por qué inspira**: Apohara va a sumar `/compact` o equivalente (sub-DAG compaction). El bug "stale usage after compaction" es genérico.
- **Cómo traducir**: El parser de cada provider emite un canonical event `context_compacted` que el TopBar consume para resetear el indicador.
- **Valor**: BAJO

---

## Categoría 6: IPC / Centralized Listener Architecture (aplica a Tauri command/event)

### Hallazgo 6.1: Centralized IPC listeners (1 listener per event, NEVER component-local)
- **Qué**: Rule: React components NUNCA suscriben a IPC events directly. Listeners centralizados en `store/listeners/*.ts` subscribed UNA vez at startup, actualizan Jotai atoms, components leen atoms con `useAtomValue()`.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/IPC_GUIDE.md` líneas 96-181. `IPC_LISTENERS.md` (no leído pero existe). Rule `.claude/rules/ipc-listeners.md`.
- **Por qué inspira**: Apohara va a tener Tauri events para todo (run-started, task-completed, verifier-conflict, ledger-replay). Si cada SwarmCanvas node se suscribe directo, MaxListenersExceededWarning, race conditions on session switch, stale closures. La doctrina centralizada elimina toda una clase de bugs.
- **Cómo traducir**: `apohara/src/store/listeners/runListeners.ts`, `taskListeners.ts`, `verifierListeners.ts`. Cada uno hace `listen('apohara://run-started', ...)` UNA vez al boot, actualiza Jotai/Zustand. Anti-pattern table copy-pasteable a `apohara/docs/EVENTS.md`.
- **Valor**: ALTO

### Hallazgo 6.2: `workspacePath` como parámetro requerido en IPC handlers (no current-workspace fallback)
- **Qué**: Nimbalyst es multi-window: cada workspace es un BrowserWindow. Cualquier IPC workspace-scoped DEBE recibir `workspacePath` como required arg. Main-process services NUNCA caen back a un `currentWorkspacePath` shared porque last-write-wins entre windows → cross-window pollution.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/IPC_GUIDE.md` líneas 192-258. Rule `error-handling.md`.
- **Por qué inspira**: Apohara va a tener N runs concurrentes en N panes/ventanas Tauri. Cualquier servicio Rust que cache un "current run id" tendrá el mismo bug. La rule "if you can't decide, it's scoped → require the param" es muy buena guidance.
- **Cómo traducir**: Todo Tauri command que opera sobre un run, task, o worktree DEBE recibir `runId` o `workspacePath` explícito. Rust services no guardan ningún "currentRun" — el caller siempre pasa.
- **Valor**: ALTO

### Hallazgo 6.3: `safeHandle` / `safeOn` wrappers en lugar de `ipcMain.handle` directly
- **Qué**: Wrappers que añaden logging, validation, error handling consistente. Mencionado en `main-process-init.md` rule.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/.claude/rules/main-process-init.md` línea 4.
- **Por qué inspira**: Apohara debería wrappear los Tauri `#[command]` con un macro o helper que añada (a) validation de required params, (b) logging consistente, (c) error → structured Result.
- **Cómo traducir**: `apohara-tauri/src/commands/safe.rs` con un macro `apohara_command!(name, params, body)` o un trait blanket.
- **Valor**: MEDIO

---

## Categoría 7: Internal MCP Servers / Tool Catalog

### Hallazgo 7.1: Internal MCP servers (in-process, localhost-only, port-injected)
- **Qué**: 4 MCP servers en main process: `nimbalyst-mcp` (screenshots, display_to_user, git proposal), `session-naming` (con dynamic tags from DB), `session-context` (workstream overview, recent sessions), `extension-dev` (build, reload, logs, db_query). Cada uno escucha `127.0.0.1:port` con SSE. Auth via bearer token (`mcpAuthToken`) para evitar malicious page from user's browser invoking tools.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/INTERNAL_MCP_SERVERS.md` (913 líneas con template completo). Source code en `packages/electron/src/main/mcp/`.
- **Por qué inspira**: Apohara puede exponer tools propias (read del ledger, listar runs, inspect verification mesh state, query del indexer) via MCP a CLI wrappers. Esto cierra el loop: el agent puede hacer self-introspection (e.g., "leé el último run summary, comparalo con tu plan").
- **Cómo traducir**: `apohara/src/core/mcp/servers/` con `apohara-ledger.ts` (read ledger events), `apohara-runs.ts` (list/inspect runs), `apohara-indexer.ts` (blast-radius queries vía proxy a Rust). Localhost-only, bearer token desde Tauri secure-storage.
- **Valor**: ALTO

### Hallazgo 7.2: Settings Control MCP server con allow-list / deny-list / rate-limit / audit
- **Qué**: MCP server `settings-control` permite al agent introspectar y cambiar Nimbalyst settings (theme, default model, sync, features toggle). TODO va por `SettingsControlService` con allow-list, deny-list (API keys, share keys), rate-limit 30 writes / 60s, audit log. Kill-switch: `settingsAgentToolsDisabled=true` omite el server. Solo disponible para agents standard, meta-agent excluded.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/INTERNAL_MCP_SERVERS.md` líneas 29-40. Implementación en `packages/electron/src/main/services/SettingsControlService.ts`.
- **Por qué inspira**: Apohara users querrán "agent, cambiá mi default model a sonnet-4.5". Exposing eso sin allow/deny/rate-limit es peligroso. El pattern allow-list explícito + audit log es transferible 1:1.
- **Cómo traducir**: `apohara/src/core/mcp/servers/apohara-settings.ts` con el mismo patrón. Audit log al ledger (cada write es un evento).
- **Valor**: MEDIO

### Hallazgo 7.3: Custom tool widgets registry (replace generic tool display)
- **Qué**: Registry `CustomToolWidgets/index.ts` mapea tool names a React components. RichTranscriptView checkea el registry antes de renderear generic tool UI. Maneja MCP prefixes (`mcp__nimbalyst__capture_editor_screenshot`) auto.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/CUSTOM_TOOL_WIDGETS.md` (84 líneas).
- **Por qué inspira**: SwarmCanvas / CodeDiffPane de Apohara va a renderear tool calls de 24 providers — `Bash`, `Edit`, `apohara.read_ledger`, etc. Hardcodear UI por tool es bad; un registry permite a extensions (si llegan) y a core registrar widgets bonitos para tools comunes (e.g., diff widget para `Edit`, table widget para `read_ledger`).
- **Cómo traducir**: `apohara/src/ui/components/ToolWidgets/registry.ts`. Base: `BashWidget`, `EditWidget` con Monaco diff, `LedgerReadWidget` con virtual table.
- **Valor**: MEDIO

---

## Categoría 8: DevEx & Testing

### Hallazgo 8.1: Plan documents as markdown-with-frontmatter (SPEC.md native)
- **Qué**: Plans como markdown files en `plans/` con YAML frontmatter (`planStatus: { planId, title, status, planType, priority, owner, stakeholders, tags, created, updated, progress, agentSessions[] }`). Real-time metadata caching (4KB bounded reads, SHA hashing). File watcher detecta cambios, atoms se actualizan. Plans Panel sidebar lista todos con filters.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/PLANNING_SYSTEM.md` (316 líneas). Code en `packages/runtime/src/plugins/PlanStatusPlugin/`.
- **Por qué inspira**: Apohara Ultimate v1.0 quiere "SPEC.md parser nativo (Phase 7.2)". Este IS el pattern. Especialmente valuable: `agentSessions` field — el plan tracks qué runs Apohara lanzaron contra él. Permite "open plan → see all runs that touched it → resume one".
- **Cómo traducir**: `apohara/src/core/spec/parser.ts` con same YAML shape. Cache via `apohara-indexer` (Rust con redb ya está). File-watcher (notify crate) emite Tauri event → renderer atoms. TaskBoard kanban surfacea plans con `planStatus`.
- **Valor**: ALTO

### Hallazgo 8.2: Tracker workflows (decision / bug items con structured templates)
- **Qué**: Cuando AI elige entre alternativas → log `tracker_create({ type: "decision", ... })`. Cuando fixea un bug → ensure existe un `tracker_create({ type: "bug", ... })` antes de escribir fix code. Template prose: `## Context / ## Alternatives considered / ## Reasoning / ## Trade-offs accepted` para decisions. `## Symptoms / ## Expected behavior / ## Root cause / ## Fix` para bugs.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/TRACKER_WORKFLOWS.md` (53 líneas).
- **Por qué inspira**: Apohara verification-mesh produce un wealth de decisions (judge accept/reject, critic disagreement) — capturar como tracker items es perfect audit trail. Búsqueda `tracker_list({ type: decision, search: "..." })` antes de re-decidir lo mismo evita re-arguments.
- **Cómo traducir**: `apohara/src/core/trackers/` con `decisionTracker.ts` y `bugTracker.ts`. Items persistidos al ledger como eventos especiales. `apohara tracker list --type decision --search xyz` CLI.
- **Valor**: ALTO

### Hallazgo 8.3: End-to-end verification rule (failing test FIRST, no "fixed" claims sin red→green)
- **Qué**: "For any bug whose verification requires a `/restart` or user manually exercising UI, the FIRST deliverable is a failing test that the fix must make pass. Never announce 'fixed' before observing the bug go from broken to working." Documenta el incident "tracker-body 5-session workstream donde agents announced 'fixed' 4 veces" como costo signal.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/.claude/rules/end-to-end-verification.md` (35 líneas).
- **Por qué inspira**: Apohara verification-mesh ya tiene dual-arbiter judge≠critic — pero los humanos que trabajan en el código de Apohara necesitan la misma discipline. Loggear restart-required como cost signal y forzar tests-first es bueno meta-process.
- **Cómo traducir**: Copiar el rule a `apohara/.claude/rules/` y al `apohara/CONTRIBUTING.md`. Sumar a verification-mesh: si el judge ve "claim resolved without test evidence", flag.
- **Valor**: ALTO

### Hallazgo 8.4: Agent-mistakes.md log (incident postmortems con root cause y lesson)
- **Qué**: Markdown con incidentes detallados — fecha, qué pasó, recovery, lesson. Incluye user feedback verbatim. Ejemplo: "2026-05-02: Ran git stash without permission" con full quote del user.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/.claude/agent-mistakes.md` (85 líneas, 7 incidents).
- **Por qué inspira**: Apohara verification-mesh ledger podría auto-poblar esto cuando ve "judge had to reject 3 turnos seguidos por la misma reason" → ahí sale un incident sin intervention humana. Valor: el formato es excelente para context-engineering — meté el archivo en system-prompt y el agent evita repetir errores conocidos.
- **Cómo traducir**: `apohara/.claude/agent-mistakes.md` empezando con incidents reales del dev del propio Apohara. Plus: `apohara incident extract <run-id>` que reads del ledger y propone una entrada nueva.
- **Valor**: ALTO

### Hallazgo 8.5: Per-test reusable fixture workspace ("Acme API Server")
- **Qué**: `packages/electron/marketing/fixtures/workspace/` es un realistic project con TypeScript src, CSV data, schema.prisma, README, plans/. Copiado a temp dir per test run.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/MARKETING_SCREENSHOTS.md` líneas 184-194.
- **Por qué inspira**: Apohara integration tests necesitan un workspace realista (mix de TS, Rust, docs, lockfiles) para ejercitar el indexer + decomposer + scheduler end-to-end. Tener uno checkeado in-repo y copy-on-test es práctica común pero muy eficaz.
- **Cómo traducir**: `apohara/tests/fixtures/sample-monorepo/` con un microservicio TS + crate Rust + docs. Copy-on-test via Bun's `fs.cp`.
- **Valor**: MEDIO

### Hallazgo 8.6: Cross-arch native binaries en CI con cross-compile guidance
- **Qué**: GitHub Actions workflow detalla cómo instalar binarios native cross-arch en npm (single `npm install --no-save` con MULTIPLE packages — running separately causa pruning del previous como "extraneous"). Maps platform/arch a npm packages (e.g., `@anthropic-ai/claude-agent-sdk-darwin-arm64`).
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/.github/workflows/electron-build.yml` líneas 160-277.
- **Por qué inspira**: Apohara va a shippear Tauri builds cross-OS (macOS arm64+x64, Windows x64+arm64, Linux x64) — los CLI wrappers (claude, codex) tienen native binaries per platform. La trampa "separate npm install prunes the previous" es exactamente el bug que sufrieron en v0.57.40/41 — vale oro saberlo de antemano.
- **Cómo traducir**: `apohara/.github/workflows/release.yml` con matrix idéntico y el single-`bun install` pattern (Bun tiene optional deps similares). Documentar la trampa en `apohara/docs/RELEASING.md`.
- **Valor**: ALTO

### Hallazgo 8.7: Release flow: pre-release on tag push → promote-to-stable
- **Qué**: Push tag `v0.42.61` → GitHub Actions publishes visible **pre-release** (alpha channel). Tested by alpha users via electron-updater `channel='alpha'`. `/promote-public-release` slash command rebuilds cumulative PUBLIC_RELEASE_NOTES.md, lets user edit, flips the SAME release prerelease=false. No second tag.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/RELEASING.md` (328 líneas).
- **Por qué inspira**: Apohara va a necesitar exactly esto — un alpha channel para que power-users testeen antes de stable. Same-tag flip es elegante (no requiere rebuild).
- **Cómo traducir**: Tauri tiene built-in updater similar; el flow `/release-alpha patch|minor|major` → `/promote-public-release` se puede portar como Apohara CLI commands. `apohara/scripts/release.sh` siguiendo el modelo `nimbalyst/scripts/release.sh`.
- **Valor**: MEDIO

### Hallazgo 8.8: `pre-release as of <commit-hash>` placeholder en docs
- **Qué**: Hack chico pero útil: cuando agregás un PostHog event en un commit no liberado todavía, marcás `(pending release as of abc1234)` en el doc. Cuando releasés, find/replace al version real.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/POSTHOG_EVENTS.md` línea 20-23.
- **Por qué inspira**: Apohara docs versionados sufren mismo problem (cuándo está esta feature available?). El placeholder convention ahorra fricción.
- **Cómo traducir**: Convention en `apohara/CONTRIBUTING.md`.
- **Valor**: BAJO

---

## Categoría 9: State Persistence & Migrations

### Hallazgo 9.1: Persisted state safety pattern (defaults + `??` merge)
- **Qué**: TODA interfaz persistida tiene un `createDefault*()` con todos los field defaults y un `init*()` que mergea loaded data con defaults usando `??`. Tabla de anti-patterns clara (`loaded.field` sin default = crash on old data, `{ ...loaded }` sin merge = missing fields undefined).
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/STATE_PERSISTENCE.md` (81 líneas) + rule `state-persistence.md`.
- **Por qué inspira**: Apohara settings.json (Tauri-store), capability-manifest (Thompson Sampling stats), ledger schemas — TODOS necesitan esta defensa. El bug "user updates Apohara, old settings missing newField, crash" es 100% predecible.
- **Cómo traducir**: Convention `apohara/src/core/persistence/defaults.ts` con un `mergeWithDefaults<T>(loaded, defaults): T`. Helpers para Capability-Manifest, RosterConfig, UserSettings.
- **Valor**: ALTO

### Hallazgo 9.2: Deep-merge for workspace state IPC updates
- **Qué**: `workspace:update-state` usa deep merge (not shallow `Object.assign`). Multiple modules pueden update different fields en nested structures sin overwrite. No manual read-modify-write.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/ERROR_HANDLING.md` líneas 18-22.
- **Por qué inspira**: Apohara TopBar updates cost meter, SwarmCanvas updates pane sizes, ContextForge sidecar config — todos escriben a settings concurrent. Sin deep merge, last-write-wins corrupts data.
- **Cómo traducir**: `apohara/src/core/persistence/deepMerge.ts` usado por TODO IPC update path.
- **Valor**: MEDIO

---

## Categoría 10: System Prompt / Context Engineering

### Hallazgo 10.1: System prompt addendum layered architecture (preset + addendum + MCP discovery)
- **Qué**: Three layers: (1) SDK `preset: 'claude_code'` base, (2) Nimbalyst addendum vía `systemPrompt.append`, (3) MCP tool descriptions discovered dynamically. Plus CLAUDE.md files loaded by SDK natively. Addendum tiene `<addendum>` tag que tells the model "esto supersedes lo de arriba".
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/SYSTEM_PROMPT_CUSTOMIZATION.md` (471 líneas). Builder en `packages/runtime/src/ai/prompt.ts` `buildClaudeCodeSystemPrompt()`.
- **Por qué inspira**: Apohara va a necesitar layered prompts: (1) provider base, (2) Apohara role addendum ("you are part of a swarm, judge will verify"), (3) task-specific context, (4) MCP tools del swarm. La técnica `<addendum>` tag mata ambigüedad sobre quién manda.
- **Cómo traducir**: `apohara/src/core/prompt/builder.ts` con conditional sections (worktree warning, git commit guidance, session-naming requirement, voice-mode si aplica algún día). El builder es testable independiente del provider.
- **Valor**: ALTO

### Hallazgo 10.2: Dynamic tool descriptions with runtime data
- **Qué**: `name_session` tool description incluye dynamic tag list desde la DB: `Existing tags in this workspace: ${tagList}`. Claude reusa tags consistentes.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/SYSTEM_PROMPT_CUSTOMIZATION.md` líneas 280-291.
- **Por qué inspira**: Apohara tools (`apohara.read_ledger`, `apohara.list_runs`) pueden incluir dynamic content: "Recent run ids: [r-001, r-002, r-003]" o "Open tasks: [...]" — agent no tiene que adivinar.
- **Cómo traducir**: Cada MCP tool emite description() que builds at request-time con context del ledger/scheduler.
- **Valor**: MEDIO

### Hallazgo 10.3: "Fail fast / never log-and-continue" doctrine
- **Qué**: 4 rules en error-handling.md: never log-and-continue for required params, never fall back to defaults that mask routing issues, always use stable identifiers (workspace paths NOT window IDs), validate at boundaries. "If you're adding code to handle missing required data, you're probably hiding a bug."
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/ERROR_HANDLING.md` (26 líneas) + rule `error-handling.md`.
- **Por qué inspira**: Apohara core (decomposer, scheduler, verification-mesh) necesita esta misma discipline. La trap "console.error && continue with default" es exactamente cómo el ledger pierde consistency.
- **Cómo traducir**: Adoptar en `apohara/CONTRIBUTING.md`. Custom ESLint/eslint-rule que flagea `console.error(...) && continue` patterns. Same for Rust: `clippy::result_unwrap_or_default` lints.
- **Valor**: ALTO

---

## Categoría 11: File-Watcher Diff & Snapshot System

### Hallazgo 11.1: File-watcher-based diff (AI writes direct to disk, watcher → diff mode)
- **Qué**: AI siempre ve el accepted state. PreToolUse hook crea "pre-edit tag" en local history con original content. AI escribe direct to disk. File watcher detecta change, busca pending tag, entra a diff mode (red/green). User accept (keep disk) o reject (restore tagged). Funciona con ANY file modification (AI tools, bash, manual).
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/docs/FILE_WATCHER_DIFF_SYSTEM.md` (138 líneas).
- **Por qué inspira**: Apohara consolidator merge+PR puede usar exactly esto — agent worktrees escriben direct, un watcher reconstruye diffs para review en SwarmCanvas/CodeDiffPane. Beneficio sobre MCP-based: works con cualquier tool, no requiere que el agent use un `applyDiff` específico.
- **Cómo traducir**: `apohara-indexer` (Rust con notify crate) tiene file watching nativo. Crear pre-edit tag in redb antes de cada tool call que touchee files, post-edit reconstruct diff. CodeDiffPane Monaco renders.
- **Valor**: ALTO

### Hallazgo 11.2: OpenCode file-snapshot plugin (before/after captures con SSE event piggyback)
- **Qué**: Plugin que hooks `tool.execute.before` / `tool.execute.after` en OpenCode. Captura content before/after de cualquier file_write tool. Maneja binary detection (null byte check first 8KB), truncation at 1MB, missing files (ENOENT → content: null).
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/packages/opencode-plugin/src/fileSnapshotPlugin.ts` (243 LOC).
- **Por qué inspira**: Apohara consolidator NEEDS before/after snapshots para verifier judge. Este plugin shows the exact tool-list para hookear (`file_write`, `file_edit`, `Write`, `Edit`, `NotebookEdit`, `apply_diff`, `patch`...).
- **Cómo traducir**: `apohara/src/core/providers/plugins/fileSnapshot.ts` con same shape. Binary detection + truncation rules portables 1:1. Snapshots → ledger event como `file_snapshot` para verifier consumption.
- **Valor**: MEDIO

---

## Categoría 12: Worktree-aware Multi-Instance Dev

### Hallazgo 12.1: Per-worktree `userData` directory (avoid file-watcher cross-talk)
- **Qué**: `npm run dev:user2` setea `NIMBALYST_USER_DATA_DIR`, `VITE_PORT=5274`, `--outDir=out2` para spawnear segunda instancia que NO contamina la primera. Worktrees auto-derivan per-worktree userData dir via `crystal-run.sh`.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/nimbalyst/CLAUDE.md` líneas 90-93. Crystal-run script implementation.
- **Por qué inspira**: Apohara va a tener N worktrees corriendo concurrent (scheduler spawn). Cada uno necesita su PROPIO Tauri userData/cache/lockfile para no chocar. Sin esto: "open second window → cross-window pollution" bug ya documentado.
- **Cómo traducir**: Variable `APOHARA_USER_DATA_DIR` parseada en Tauri's setup() hook. CLI helper `apohara worktree dev <name>` que arma el env apropiado.
- **Valor**: ALTO

---

## Resumen ejecutivo

**Total: 41 hallazgos en 12 categorías.**

Top 12 por impacto en core orchestration (ALTO):

1. `BaseAgentProvider` + dependency injection static pattern
2. `ProtocolInterface` unificado para 24+ providers
3. Plan documents as markdown-with-frontmatter (SPEC.md)
4. Two-tier transcript: raw ledger + canonical projection
5. Permission patterns con scopes (once/session/always)
6. Centralized IPC listeners (atoms-only)
7. `workspacePath` required (no current-workspace fallback)
8. Two-layer session/DAG hierarchy invariant
9. Persistent prompt stream + queue-coalescing (200ms idle)
10. Internal MCP servers (apohara-ledger, apohara-runs, apohara-indexer)
11. File-watcher-based diff (works with ANY tool)
12. End-to-end verification rule (failing test first)

Top 6 por DevEx (también ALTO):

- Tracker workflows (decision/bug items)
- Agent-mistakes.md log
- CI cross-arch native binaries pattern (single npm install)
- Per-worktree userData dir for multi-instance
- `crystal-run.sh` worktree-aware build cache
- Sanitización defensiva de API keys del environment

Los hallazgos MEDIO/BAJO son mayormente quality-of-life details (compact-boundary, dynamic tool descriptions, garbage pattern filtering, release placeholder convention).

Recomendación de orden de adopción: empezar por **Categorías 6 (IPC) + 9 (State persistence) + 10 (Error handling doctrine)** porque establecen disciplinas transversales que evitan re-trabajo. Luego **Categoría 1 (Provider architecture)** porque define el contrato sobre el cual todo lo demás (4 permissions, 5 transcript, 7 MCP) se monta.