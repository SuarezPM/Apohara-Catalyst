> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

Excelente. Tengo todo el material que necesito. Procedo a entregar el reporte final.

---

# Hallazgos en orca

Orca es un competidor directo de Apohara: orquestador desktop multi-AI (Claude Code, Codex, Grok, Antigravity, OpenCode, +20 más) basado en Electron + React + Node + better-sqlite3. La arquitectura es **wrapper de CLIs vía PTY + agent-hooks HTTP loopback + worktrees git + un coordinador-RPC con DAG de tasks**. Encontré una mina de ideas que Apohara puede absorber casi en bloque. Apunto a 17 hallazgos en 7 categorías; varios de valor ALTO.

Nota meta importante para Apohara: orca **ya tiene la pieza más fuerte que faltaba** en Apohara para multi-agente real con CLIs oficiales: un **agent-hooks server HTTP loopback** que recibe eventos PreToolUse/PostToolUse/Stop/UserPromptSubmit/PermissionRequest de los CLIs nativos vía sus propios `~/.claude/settings.json`-style hooks. Apohara hoy detecta estado vía DAG/scheduler interno; orca detecta estado en vivo desde el CLI mismo. Esto es lo más alto-impacto a portar.

---

## Categoría 1: Wrappers / adapter de CLI agents

### Hallazgo 1: Agent-hooks server HTTP loopback con bearer token + endpoint file
- **Qué**: Servidor HTTP en `127.0.0.1` que cada CLI agent (Claude, Codex, Grok, Cursor, Copilot, OpenCode, Antigravity) llama vía hook scripts instalados en su config nativo (`~/.claude/settings.json`, `~/.grok/hooks/orca-status.json`, `~/.codex/...`, etc.). Eventos: PreToolUse, PostToolUse, PostToolUseFailure, Stop, UserPromptSubmit, PermissionRequest. Auth con bearer token random per-instancia + endpoint file que la PTY puede `source`-ear para refrescar PORT/TOKEN tras restart de Orca.
- **Dónde**: 
  - `src/main/agent-hooks/server.ts` (1131 líneas; ver clase `AgentHookServer` líneas 222–1112)
  - `src/main/claude/hook-service.ts` (script POSIX líneas 92–133 + Windows 71–91)
  - `src/main/codex/hook-service.ts`, `src/main/grok/hook-service.ts`, `src/main/antigravity/hook-service.ts`, `src/main/opencode/hook-service.ts`, `src/main/cursor/hook-service.ts`
  - `src/shared/agent-hook-listener.ts` (~75k, lógica de normalización compartida)
- **Por qué inspira**: Apohara hoy infiere estado del agente solo desde el output del CLI y del scheduler. Esto perde precisión: no sabés cuándo Claude "está pensando" vs "ejecutando una bash tool" vs "pidiendo permiso". El patrón hook-script + HTTP loopback resuelve esto sin tocar fuentes del CLI ni API keys. Habilita el SwarmCanvas DAG de Apohara a mostrar tool en flight, ETA realista, blocked/waiting/done states, y `interrupted` por Ctrl+C.
- **Cómo traducir**: Sidecar Rust mini (`apohara-hooks-server` con `axum` o `hyper`) corriendo en `127.0.0.1:randomport`. En cada spawn de CLI agent inyectar env vars `APOHARA_HOOK_PORT/TOKEN/PANE_KEY/TASK_ID/WORKTREE_ID`. Para Claude Code instalar script en `~/.claude/settings.json`-`.hooks` (idempotente, hash-matched). Para Codex / opencode usar sus mecanismos análogos. Hooks dumpean payload a stdin → POST → Rust sidecar → tokio broadcast channel → Tauri event → React store. Las RPCs ya existentes en Apohara (ledger, scheduler) actualizan sus estados con los eventos de hook reales.
- **Valor**: ALTO

### Hallazgo 2: Per-agent prompt injection mode + preflight trust + draft-prefill
- **Qué**: Tabla central `TUI_AGENT_CONFIG` que para cada agente declara `promptInjectionMode` (argv | flag-prompt | flag-prompt-interactive | flag-interactive | stdin-after-start), `draftPromptFlag` (Claude: `--prefill`), `draftPromptEnvVar` (Pi: `ORCA_PI_PREFILL`), `draftPasteReadySignal`, y `preflightTrust` que pre-acepta el "Do you trust this folder?" menu escribiendo el mismo file que el agente escribiría tras click del usuario (Cursor `~/.cursor/projects/<slug>/.workspace-trusted`, Copilot `~/.copilot/config.json#trustedFolders`, Codex `~/.codex/config.toml#[projects."<path>"].trust_level = "trusted"`).
- **Dónde**:
  - `src/shared/tui-agent-config.ts` (271 líneas, todas)
  - `src/main/agent-trust-presets.ts` (134 líneas, todas)
- **Por qué inspira**: Apohara hoy spawnea `claude`, `codex`, `opencode --pure`. No tiene matriz declarativa por agente para: cómo inyectar el prompt inicial, cómo pre-aceptar trust prompts (que ROMPEN bracketed-paste), cómo detectar readiness post-spawn. Esto es exactamente lo que necesita el capability-manifest cuando agregue Cursor, Copilot, Gemini.
- **Cómo traducir**: TypeScript file en `src/core/agent-config.ts` con la misma tabla. Crear `src/core/agent-trust-presets.ts` que escriba los mismos archivos canónicos (POSIX en TS, Windows path-joining con `path` module). Integrar con `scheduler.ts` para que antes de spawn de un agente con `preflightTrust` ejecute el preset. Documentar provenance ("verified against `<binary> <version>`") como hace orca.
- **Valor**: ALTO

### Hallazgo 3: Commit-message agent spec (non-interactive runs)
- **Qué**: Registry separado de los CLI agents "interactivos" (TUI) para runs **non-interactive** que generan commit messages: `binary`, `promptDelivery: 'argv' | 'stdin'` (stdin para evitar argv limits con diffs grandes), `buildArgs({prompt, model, thinkingLevel})`, `modelSource: 'static' | 'dynamic'` con `modelDiscovery` (binary + args + parser) — Codex usa `codex debug models` y parsea JSON.
- **Dónde**: `src/shared/commit-message-agent-spec.ts` (líneas 1–500+); parsers en líneas 114–205
- **Por qué inspira**: Apohara va a tener un consolidator que merge + PR. Necesita generar commit messages y PR bodies "Y quién mejor que el agente que hizo el trabajo". Esto separa explicitamente el modo "agente vivo en TUI" del modo "tirá `codex exec --ephemeral` y devolveme texto".
- **Cómo traducir**: `src/core/non-interactive-agent.ts` en TS — mismo shape. `consolidator.ts` lo consume cuando llega el momento de generar commit/PR body. Para `claude`: `claude -p --output-format text --model sonnet --permission-mode plan --effort low`. Para `codex`: `codex exec --ephemeral --skip-git-repo-check -s read-only --model gpt-5.5 -c model_reasoning_effort=low`. Caching del model-discovery output (cambia rara vez).
- **Valor**: MEDIO-ALTO

### Hallazgo 4: OSC title parsing como fallback para agentes sin hooks
- **Qué**: `extractLastOscTitle` + `extractAllOscTitles` + `detectAgentStatusFromTitle` + `createAgentStatusTracker`. Parsea símbolos específicos por agente (Claude `✳`, Gemini `✦`/`⏲`/`◇`/`✋`, Pi `π - `, braille spinners U+2800-U+28FF). Regex con look-arounds asimétricos para no falsos-positivos en paths que contengan "ready" / "working" / etc.
- **Dónde**: `src/shared/agent-detection.ts` (499 líneas, todo el archivo)
- **Por qué inspira**: Apohara ya hace algún parseo de output pero no usa OSC titles. OSC titles son una capa **independiente** del transcript que muchos CLI agents ya emiten (Claude, Gemini, Pi). Sirve como segundo signal cuando los hooks no llegan (agente sin hook integration, hook crashed). El tracker fire-on-transition (working→idle = `onBecameIdle`) es el pattern para que el scheduler de Apohara detecte "el agente ya terminó" sin polling de output.
- **Cómo traducir**: `src/core/agent-osc-detection.ts` en TS. El indexer/PTY-reader Rust ya recibe los bytes del PTY; agregar pre-procesado en el lado Rust que extraiga OSC y mande evento up. Idle/working transitions se publican al mismo bus que los agent-hooks; el resolver downstream prioriza hook > OSC > nada (igual que orca hace en `smart-attention.ts:resolveAttention`).
- **Valor**: ALTO

---

## Categoría 2: Worktree lifecycle & lineage

### Hallazgo 5: Worktree delete preflight (status check antes de killar PTYs)
- **Qué**: `assertWorktreeCleanForRemoval` corre `git status --porcelain --untracked-files=all` **antes** de killear procesos. Orden actual `kill → git remove` causa que cuando git falla por dirty/untracked, los PTYs ya están muertos y el worktree queda en disco sin terminales. Nuevo orden: `canonicalize → ssh-check → archive-hook → symlink-cleanup → preflight → kill → git remove`. Casos "orphan" (`is not a working tree`, `not a git repository`, `ENOENT`) caen por el path existente sin teardown.
- **Dónde**:
  - `docs/worktree-delete-preflight.md` (78 líneas)
  - `src/main/git/worktree.ts:415-433` (`assertWorktreeCleanForRemoval`)
  - `src/main/worktree-removal-safety.ts`
- **Por qué inspira**: Apohara crea worktrees en `.claude/worktrees/`. Cuando un usuario o el consolidator borra un worktree con cambios sin commit, va a quedar el mismo estado roto. Preflight es ~50 líneas de código y un cambio de orden con tests de regresión.
- **Cómo traducir**: `worktree-manager.ts:removeWorktree` en Apohara: agregar `assertWorktreeCleanForRemoval` que invoque `git status --porcelain --untracked-files=all`. Si non-empty y `!force`, throw `WorktreeNotCleanError` ANTES de cualquier `taskbus.killTasksForWorktree(...)`. Orphan path (`ENOENT`, "not a git repository") sigue al cleanup actual.
- **Valor**: ALTO

### Hallazgo 6: Worktree lineage (parent worktree) explícito
- **Qué**: Cuando creás worktree, `--parent-worktree active | id:X | branch:Y` o `--no-parent`. Lineage es **intent**, no propiedad del branch. La UI usa esto para agrupar related work, para "delete cascade prompt" cuando se borra el parent, para que el coordinator pueda inferir qué worktrees son hijos de cuál task.
- **Dónde**:
  - `skills/orca-cli/SKILL.md` líneas 152–167 (Worktree Lineage)
  - `src/main/runtime/orca-runtime.ts` `removeManagedWorktree` lineage handling
  - `src/shared/types.ts` (campo `parentWorktreeId`)
- **Por qué inspira**: Apohara decomposer crea N tasks de un objective. Sin lineage, perdés la trazabilidad: ¿este worktree es spawn de qué decomposition? ¿se puede borrar sin afectar siblings? Lineage también es la base de "cascading cleanup" (delete parent → suggest delete children).
- **Cómo traducir**: Agregar `parentWorktreeId?: string | null` y `lineageRoot?: string` a la struct `Worktree` en Apohara. CLI/UI: cuando crea worktree desde otro worktree, default = inferred parent; flag `--no-parent` para opt-out. Decomposer setea `lineageRoot = objectiveId`.
- **Valor**: MEDIO

### Hallazgo 7: Workspace-cleanup tiers (ready / review / protected) con dismissals + fingerprint
- **Qué**: Sistema de cleanup automático para worktrees abandonados. Worktrees clasificados en `ready` (auto-select), `review` (needs human review), `protected` (no se puede borrar). Reasons: `archived` (7d idle), `idle-clean` (30d idle). Blockers: `main-worktree`, `running-terminal`, `dirty-files`, `unpushed-commits`, `live-agent`, etc. Dismissals con `fingerprint` (branch+head+gitClean+lastActivityBucket+classifierVersion) — si el worktree cambió desde el dismiss, se revisa de vuelta.
- **Dónde**: `src/shared/workspace-cleanup.ts` (233 líneas, todo el archivo)
- **Por qué inspira**: Apohara va a acumular worktrees rápido (1 por task, paralelos). Sin cleanup automático con confianza ("este sí lo podés borrar / este NO porque hay un agente vivo"), el usuario termina con 50+ worktrees y 10 GB de disk waste.
- **Cómo traducir**: `src/core/workspace-cleanup.ts` 1:1 en TS — mismas categorías, mismos blockers. Integrar con `coordinator` para que reporte `live-agent`, con `scheduler` para `running-terminal`. UI: panel "Cleanup suggestions" en el Sidebar. Persistir dismissals en SQLite junto al ledger.
- **Valor**: MEDIO

### Hallazgo 8: Orphan worktree adoption + cross-platform path handling
- **Qué**: Cuando hace `git worktree list --porcelain`, parsea path/HEAD/branch/bare/sparse; reconcilia con metadata persistida; detecta sparse-checkout por archivo (`<gitdir>/info/sparse-checkout`) en lugar de subproceso por worktree (perf: 2 órdenes de magnitud). `areWorktreePathsEqual` usa `win32` normalization en Windows / WSL paths. Después de `worktree remove` corre `worktree prune` y solo borra branch si NO está en uso por sibling.
- **Dónde**:
  - `src/main/git/worktree.ts` (466 líneas)
  - `src/main/repo-worktrees.ts` (37 líneas, incluye folder-mode)
  - `src/shared/cross-platform-path.ts`
- **Por qué inspira**: Apohara hoy crea worktrees pero no adopta los pre-existentes. Si el usuario hizo `git worktree add` manualmente, Apohara los ignora. La adopción permite onboardear repos con state previo.
- **Cómo traducir**: En el indexer Rust (que ya conoce git), agregar `list_git_worktrees()` que devuelve `Vec<GitWorktreeInfo>`. Cada `register_repo` corre adopción: para cada `GitWorktreeInfo` que no tenga entry en Apohara, crear `Worktree { adopted: true, lineageRoot: null, parentWorktreeId: null }`. La detección de sparse via `fs.metadata` (no subproceso) es directamente copiable a Rust.
- **Valor**: MEDIO

---

## Categoría 3: Multi-agent orchestration (esto es el core que orca cocinó)

### Hallazgo 9: SQLite-backed orchestration: messages + tasks DAG + dispatch contexts + decision gates
- **Qué**: Sistema completo de orquestación con DB SQLite (better-sqlite3, WAL, 5s busy_timeout, schema_version=4). Tablas: `messages` (id, from_handle, to_handle, subject, body, type CHECK in 8 values, priority CHECK in 3, thread_id, payload JSON, read bit, delivered_at), `tasks` (id, parent_id, created_by_terminal_handle, spec, status CHECK in 6, deps JSON array, result, completed_at), `dispatch_contexts` (separa task de la dispatch — task se mantiene clean cuando dispatch falla y se reintenta), `decision_gates` (human-in-the-loop blocking), `coordinator_runs`. **Message types**: `status`, `dispatch`, `worker_done`, `merge_ready`, `escalation`, `handoff`, `decision_gate`, `heartbeat`. **Push-on-idle delivery**: messages entregados cuando el receptor pasa a idle (no polling). **Circuit breaker**: 3 fallos seguidos → task fails. **Group addresses**: `@all`, `@idle`, `@claude`, `@codex`, `@worktree:<id>`.
- **Dónde**:
  - `src/main/runtime/orchestration/db.ts` (schema + CRUD; ver líneas 56–250)
  - `src/main/runtime/orchestration/coordinator.ts` (clase Coordinator, polling loop, DAG resolution)
  - `src/main/runtime/orchestration/preamble.ts` (preamble que se inyecta al worker)
  - `src/main/runtime/orchestration/groups.ts`, `types.ts`, `formatter.ts`
  - `src/cli/handlers/orchestration.ts` (CLI verbs)
  - `skills/orchestration/SKILL.md` (211 líneas — documentación completa del modelo)
- **Por qué inspira**: Apohara tiene scheduler + DAG, pero el modelo de **mensajes inter-agente con types semánticos** (`worker_done`, `escalation`, `decision_gate`, `heartbeat`) **separado del DAG** es mejor que tener todo dentro del scheduler. Los `decision_gate` son el "Coordinator semántico" que pide el spec de Ultimate v1.0, sin tener que inventarlos. El **push-on-idle** elimina polling. El **circuit breaker** previene infinite retry. Los **groups** son perfectos para `@idle` (despachar al primer agente libre) y `@worktree:X` (broadcast a todos los agentes de un worktree).
- **Cómo traducir**: Apohara ya usa `bun:sqlite` (o better-sqlite vía Bun). Portar schema 1:1 (`src/core/orchestration/db.ts`). Coordinator en TS con `setInterval` o EventEmitter pattern. Preamble es un template string — Apohara puede generarlo desde el decomposer. CLI: `apohara orchestration {send,check,reply,inbox,task-create,task-list,task-update,dispatch,dispatch-show,gate-create,gate-resolve,gate-list,run,run-stop,reset}` — mismos comandos. Para `@idle` query rápido al agent-hooks server cache. Importante: el `coordinator-handle` y `task-id` viajan en env var injectada en el spawn de cada agente, así el agente sabe a quién mandar `worker_done`.
- **Valor**: ALTO — esto convierte a Apohara de "DAG planner+ejecutor" en "verdadero multi-agente con backchannel"

### Hallazgo 10: Dispatch preamble que enseña al worker cómo comunicarse
- **Qué**: Cuando el coordinator dispatch-ea una task a un agente, le inyecta vía stdin/argv un **preamble** que explica: "Sos worker, coordinador es X, task es Y. CLI commands: `orca orchestration send --type worker_done`, `--type heartbeat` (cada 5min), `orca orchestration ask --to X --question Y --options ...` (NUNCA uses AskUserQuestion porque coordinador no la ve)". El preamble ya viene con drift detection (si el worktree base está N commits behind, lista los 5 subjects más recientes). Test-only env var `ORCA_HEARTBEAT_INTERVAL_MS` para acelerar en tests.
- **Dónde**: `src/main/runtime/orchestration/preamble.ts` (líneas 38–147 = el template completo)
- **Por qué inspira**: Apohara hoy spawnea agentes con un prompt pero no les explica el **protocolo** de respuesta. Sin esto, cada agente improvisa: imprime resultado a stdout, deja un archivo, manda algo a Claude. El preamble es ~80 líneas y resuelve esto. La **prohibición explícita de `AskUserQuestion`** + el `ask` wrapper es brillante (resuelve el "agente hangea esperando humano que no está").
- **Cómo traducir**: `src/core/orchestration/preamble.ts` con la misma function `buildDispatchPreamble({ taskId, dispatchId, coordinatorHandle, taskSpec, devMode, baseDrift })`. Pegar el preamble vía `--prefill` (Claude), `flag-prompt` (opencode), o `stdin-after-start` (resto). Apohara coordinator (que ya existe en `core/scheduler`) lo construye e inyecta. El consolidator dispatches al "PR writer" con preamble que explica que mande `merge_ready` cuando esté listo.
- **Valor**: ALTO

### Hallazgo 11: `orca orchestration check --wait` para reemplazar sleep+poll loops
- **Qué**: El comando `orca orchestration check --wait --types worker_done,escalation --timeout-ms 300000` bloquea el agente hasta que llega un mensaje matching o expira el timeout. Si ya hay unread, retorna inmediatamente. Heartbeat lines a stderr cada 15s (JSON-shaped para no romper `jq`) durante la espera, así Claude Code Bash tool no auto-backgroundea el subprocess por silencio >2min.
- **Dónde**: `src/cli/handlers/orchestration.ts` líneas 34–52 (`startCheckHeartbeat`), 120–163 (`orchestration check`)
- **Por qué inspira**: Apohara va a tener este mismo problema: si un coordinator hace `while ! check; do sleep 5; done`, cada agente involucrado quema tokens innecesarios. `--wait` es la primitiva correcta.
- **Cómo traducir**: Implementar en `apohara orchestration check --wait` usando Bun's `await Promise.race([messageNotification, timeout])` sobre el `EventEmitter` del orchestration DB. Heartbeat lines a stderr exactamente como orca (15s, JSON `{_heartbeat: true, elapsedMs, deadlineMs}`).
- **Valor**: ALTO

### Hallazgo 12: Drift detection en dispatch + `allow-stale-base: true` opt-in
- **Qué**: Antes de cada dispatch, `probeWorktreeDrift(worktreeSelector)` corre `git fetch` + cuenta commits behind del base ref. Si `behind > DISPATCH_STALE_THRESHOLD (=20)` la dispatch **falla** (refuse). El task spec puede contener `allow-stale-base: true` como bypass explícito. El preamble del worker incluye una sección `--- BASE DRIFT ---` con los 5 subjects más recientes del base que no están en el worktree. Threshold único, sin warn/refuse split.
- **Dónde**:
  - `src/main/runtime/orchestration/coordinator.ts` líneas 36–61 (`DISPATCH_STALE_THRESHOLD`, `parseAllowStaleBaseFromSpec`)
  - `src/main/runtime/orchestration/preamble.ts` `buildDriftSection`
- **Por qué inspira**: Apohara va a despachar tasks a worktrees creados hace horas/días. Sin drift detection, un agente trabaja sobre código stale, produce edits que conflictan al merge, el consolidator pelea con conflicts. El refuse-by-default es agresivo pero correcto para apohara que apunta a auto-merge.
- **Cómo traducir**: `src/core/orchestration/drift-probe.ts` en TS. Si el coordinator agarra una task ready: probe `git fetch origin && git rev-list --count HEAD..origin/base`. Si `>=20`, fail dispatch a menos que `parseAllowStaleBaseFromSpec(taskSpec).allowStale`. El threshold y la regex en un solo file así tuning es 1 línea.
- **Valor**: ALTO

---

## Categoría 4: Permissions, trust, attribution

### Hallazgo 13: Terminal attribution shim (git/gh wrappers que inyectan Co-authored-by)
- **Qué**: Cuando `enableGitHubAttribution` está on, Orca escribe wrappers `git` y `gh` (POSIX `.sh`, Windows `.cmd` + `.ps1`) en `<userDataPath>/orca-terminal-attribution/{posix,win32}/` y los prepend-ea al `PATH` de cada PTY (NO al PATH global). Los wrappers detectan si es `git commit` y agregan `--trailer "Co-authored-by: Orca <help@stably.ai>"`. Para `gh pr create` agregan footer "Made with [Orca](url) 🐋". El wrapper resuelve el real-git via `ORCA_REAL_GIT` env var (Windows-pre-resolved) o `command -v git` con PATH limpio (POSIX). Versión del shim (`ATTRIBUTION_SHIM_VERSION='6'`) en file `VERSION` así re-genera solo cuando cambia.
- **Dónde**: `src/main/attribution/terminal-attribution.ts` (todo el archivo, ~400 líneas; key code 32–183)
- **Por qué inspira**: Apohara va a generar PRs y commits via consolidator. Necesita **attribution consistente** sin pedirle al usuario que recuerde `--trailer` ni configurar `git commit.template`. El shim también funciona para CLI runs externos (el usuario abre terminal en Apohara y hace `git commit -m "..."`).
- **Cómo traducir**: `src/core/attribution/terminal-shim.ts` en TS. Generar bash + powershell + cmd wrappers (templates inline). Prepend `PATH` solo en PTYs spawneados por Apohara (NO en el shell del usuario). Trailer: `Co-Authored-By: Apohara <noreply@apohara.dev>` + `Co-Authored-By: <Provider> <noreply@<provider>>`. Settings toggle "Apohara Attribution" on/off. Test que verifica que `git commit` con todos los flags posibles inyecta trailer en `git commit -m`, `git commit`, `git commit -F file`, etc.
- **Valor**: MEDIO

### Hallazgo 14: Smart Attention class para sort/filter worktrees por urgencia
- **Qué**: 4 clases ordinales — Class 1 "Needs you" (`blocked`/`waiting` hook + title-heuristic `permission`), Class 2 "Done" (no interrupted), Class 3 "Working", Class 4 "Idle". Min-of-pane-classes (pane más urgente promueve worktree). Hook authority es **per-pane** (no per-worktree), porque un worktree puede tener Claude en pane A con hook fresh y un OpenCode en pane B sin hook. `attentionTimestamp` se computa por clase con semánticas distintas (Class 3 usa el `mostRecentAttentionInHistory` para que worktrees recién transicionados done→working ranking arriba). Defensive guards contra `NaN`/`Infinity` en timestamps corrupted. `interrupted` `done` (Ctrl+C) se degrada a idle.
- **Dónde**: `src/renderer/src/components/sidebar/smart-attention.ts` (382 líneas, todo el archivo)
- **Por qué inspira**: Apohara DAG view es eficiente para el grafo, pero el usuario también necesita una "what needs me NOW" list. Esta es la heurística correcta y bien-explained.
- **Cómo traducir**: `src/store/smart-attention.ts` en TS. Inputs: `agentStatusByPaneKey` (del agent-hooks store) + tabs + worktrees + (opcional) `runtimePaneTitles` para fallback. Output: `Map<worktreeId, WorktreeAttention>`. Lo consume el TaskBoard kanban (Hallazgo 15) para ordenar columnas, y un nuevo "Needs You" toast/sidebar widget.
- **Valor**: ALTO

---

## Categoría 5: UI/UX

### Hallazgo 15: Workspace Kanban con drag-to-status, area-selection, columnas custom, pin-drop-target
- **Qué**: Vista kanban de worktrees con columnas custom (por status), drag pointer (no HTML5 DnD), area-selection (drag rectángulo sobre múltiples cards), columna resize, shift-wheel-scroll horizontal, outside-dismiss, pin drop target, status appearance popover. **Mucha** modularización: cada concerns es un hook separado (`use-workspace-kanban-card-pointer-drag`, `use-workspace-kanban-area-selection`, `use-workspace-kanban-shift-wheel-scroll`, `use-workspace-kanban-column-resize`, `use-workspace-kanban-outside-dismiss`, `use-workspace-kanban-selection`).
- **Dónde**: `src/renderer/src/components/sidebar/WorkspaceKanban*.tsx` + ~15 hooks `use-workspace-kanban-*.ts`
- **Por qué inspira**: Apohara Ultimate v1.0 va a tener TaskBoard kanban. Esto es exactamente la implementación de referencia: hooks-per-concern, status lanes custom, pin column, drawer al click. Reescribirla desde cero es ~3 sprints; portar la arquitectura es 1.
- **Cómo traducir**: `src/components/TaskBoard/` con la misma estructura modular: `TaskBoardLane.tsx`, `TaskBoardCard.tsx`, `TaskBoardDrawer.tsx`, hooks `use-taskboard-{drag,selection,column-resize,wheel-scroll}`. Status del task (orchestration DB: `pending`/`ready`/`dispatched`/`completed`/`failed`/`blocked`) son las columnas default; usuario puede agregar status customs persistidos. Drag de un card a otra columna = `task-update --status <col>`. Drag a "ready" promueve. Drag a "blocked" crea decision gate.
- **Valor**: ALTO

### Hallazgo 16: Skills discovery (escanea `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`, repo `.claude/skills`, repo `.agents/skills`)
- **Qué**: Escaneo recursivo (depth=4 normal, 9 plugin) de `SKILL.md` files en directorios canónicos por agente + plugin caches (`~/.codex/plugins/cache`) + per-repo (`<repo>/.claude/skills`, `<repo>/.agents/skills`). Cada skill: id (hash sha1 del path), name (del YAML frontmatter), description, providers, sourceKind (home/repo/plugin/bundled), updatedAt (mtime), fileCount. Dedup por skillFilePath.
- **Dónde**: `src/main/skills/discovery.ts` (270 líneas, todo); `src/shared/skill-metadata.ts` (parser de frontmatter)
- **Por qué inspira**: Apohara va a querer enseñar skills personalizados a sus agentes. Hoy cada CLI agent tiene su propio directorio; Apohara puede surface "this worktree has these skills available" en UI sin redefinir el formato. Además, las skills `orchestration` y `orca-cli` que orca distribuye via `npx skills add <repo> --skill X --global` son **exactamente** lo que Apohara necesita: skill para `apohara orchestration ...` + skill para `apohara worktree/terminal/...` que se instala en `~/.claude/skills/apohara-orchestration/SKILL.md`.
- **Cómo traducir**: `src/core/skills/discovery.ts` 1:1 en TS. Apohara crea sus propias skills `apohara-cli` y `apohara-orchestration` en `skills/` del repo, las publica al installer. UI: panel "Skills" muestra discovered + install button para las built-in. Add to capability-manifest.
- **Valor**: MEDIO

### Hallazgo 17: Dashboard agent rows con stale-decay + freshness scheduler
- **Qué**: `useDashboardData` aggregates agentes por worktree con state-decay: si `entry.state` es working/blocked/waiting y `!isExplicitAgentStatusFresh(entry, now, AGENT_STATUS_STALE_AFTER_MS=30min)`, decay a `idle` (porque el agente murió sin mandar final update). `done` NUNCA decae (es terminal). `agentStatusEpoch` se incrementa cuando una freshness boundary cruza (sin nuevo PTY data), forzando re-render. La hidratación on-disk de `last-status.json` (Hallazgo 1) sobrevive restart con TTL `7 días`.
- **Dónde**:
  - `src/renderer/src/components/dashboard/useDashboardData.ts` (195 líneas)
  - `src/renderer/src/store/slices/agent-status-freshness-scheduler.ts`
  - `src/main/agent-hooks/server.ts` líneas 937–1021 (hydrate from disk)
- **Por qué inspira**: Apohara va a mostrar agentes en SwarmCanvas + TaskBoard. Sin stale-decay, un agente que crashea silenciosamente queda "Working forever" en la UI. El epoch+effect pattern para re-render-on-deadline (sin coupling a wall-clock time) es elegante.
- **Cómo traducir**: `src/store/agent-status-freshness.ts` con `setInterval` que tick-ea cada `AGENT_STATUS_STALE_AFTER_MS / 4`. Decay logic en el selector que computa el view-model de los nodes del DAG. `last-status.json` se persiste en `<userData>/apohara/agent-status.json` con atomic-rename + per-entry TTL.
- **Valor**: ALTO

---

## Recomendaciones de orden de adopción para Apohara Ultimate v1.0

Si tuviera que rankear por **impacto/esfuerzo**:

1. **Hallazgo 1** (agent-hooks server) — el unlock más grande. ~1 sprint. Sin esto, los hallazgos 4, 11, 17 quedan en muletas.
2. **Hallazgo 9** (orchestration SQLite + DAG + dispatch contexts) — el unlock semántico. ~1.5 sprints. Coordinator semantic + decision_gate del spec quedan triviales.
3. **Hallazgo 10** (preamble) — 50 líneas, 1 día, multiplica calidad de cada worker run.
4. **Hallazgo 11** (`check --wait`) — 1 día, elimina sleep+poll en el coordinator. Heartbeat para Claude Code Bash tool.
5. **Hallazgo 2** (TUI agent config + preflightTrust) — 2 días, blueprint completo para agregar agentes futuros.
6. **Hallazgo 5** (worktree delete preflight) — 1 día, prevent fleet de worktrees rotos.
7. **Hallazgo 15** (Workspace Kanban) — TaskBoard del spec Ultimate v1.0, ~5 días con la arquitectura modular de orca como referencia.
8. **Hallazgo 14** (smart-attention) — ~1 día, base para "Needs you" UX.
9. **Hallazgo 4** (OSC parsing) — ~1 día, fallback para agentes sin hooks.
10. **Hallazgo 12** (drift detection) — ~1 día, defense-in-depth para el consolidator.
11. **Hallazgo 17** (stale-decay + freshness scheduler) — ~1 día, cierra el loop con (1).
12. **Hallazgo 7** (workspace-cleanup tiers) — ~3 días.
13. **Hallazgo 3** (commit-message agent spec) — ~2 días, alimenta consolidator.
14. **Hallazgo 13** (terminal attribution shim) — ~2 días.
15. **Hallazgo 6** (worktree lineage) — ~1 día.
16. **Hallazgo 16** (skills discovery + publish apohara-skills) — ~2 días, ayuda a UX onboarding.
17. **Hallazgo 8** (worktree adoption + cross-platform paths) — ~2 días.

**Total**: ~6 sprints de 1 dev senior para adoptar todo. Los primeros 4 hallazgos (~3 semanas) ya transforman Apohara en un orquestador multi-agente real con backchannel semántico, que es el gap principal hoy contra orca.