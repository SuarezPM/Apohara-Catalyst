# Audit: orca (17 hallazgos)

> Cruz cada hallazgo de `docs/reference-mining/orca.md` contra el código actual de Apohara.
> Audit ejecutado 2026-05-22 sobre `feat/apohara-v1` HEAD (`d9372eb feat(npx): npx-installable apohara binary launcher`).

## Resumen

| Status | Cantidad |
|---|---:|
| ✅ COMPLETO | 4 |
| 🟡 PARCIAL | 9 |
| ❌ NO IMPLEMENTADO | 4 |
| 🚫 RECHAZADO | 0 |
| ❓ AMBIGUO | 0 |
| **Total** | **17** |

## Hallazgos

### Hallazgo 1: Agent-hooks server HTTP loopback con bearer token + endpoint file

- **Origen orca**: `src/main/agent-hooks/server.ts` (1131 LOC), `src/main/claude/hook-service.ts`, `src/shared/agent-hook-listener.ts`
- **Apohara actual**: `crates/apohara-hooks-server/` (Rust axum sidecar) + `src/core/hooks-server/{server.ts,installer.ts,scripts.ts}` (Bun TS mirror)
- **Status**: 🟡 PARCIAL
- **Evidencia**:
  - Rust axum server bindea `127.0.0.1` con bearer auth, body limit 256 KiB, endpoint file en `~/.apohara/agent-hooks/endpoint.json` con `EndpointDescriptor {port, token, started_at}` y `rotate_token()` (`crates/apohara-hooks-server/src/lib.rs:99-161`, `endpoint_file.rs`).
  - `event.rs` valida envelope tagged-enum con eventos `PreToolUse`, `PostToolUse`, `PostToolUseFailure`, `Stop`, `UserPromptSubmit`, `PermissionRequest` y discriminator-spoofing guard (`event.rs:13-98`).
  - Bun mirror `src/core/hooks-server/server.ts:75-159` implementa el mismo wire protocol (auth bearer timing-safe, `atomicWriteJson` del endpoint).
  - Per-agent scripts en `src/core/hooks-server/scripts.ts:46-139` para `claude-code-cli`, `codex-cli`, `opencode-go`. Installer idempotente con hash en `installer.ts:41-119`.
- **Gap**: (a) El handler `handle_event` tiene `// TODO Stage 2.3: forward to broadcast channel + orchestration DB` en `event.rs:100`. Hoy SOLO loguea con `tracing::info!` — no hay tokio broadcast channel ni write a la DB de orchestration; la TS counterpart sí tiene `onEvent` callback pero la integración con SSE/ledger es por consumidor (no centralizada). (b) `rotate_token()` actualiza el endpoint file pero no rota el `AuthState` (Stage 2.6 pendiente). (c) Falta hook script para grok/cursor/copilot/antigravity (catálogo solo cubre 3 active).
- **Recomendación**: Cerrar el TODO de `event.rs:100` cableando un `tokio::sync::broadcast` que escriben los handlers y leen orchestrator + Tauri event bus. Tracking en un task dedicado de Stage 4.

### Hallazgo 2: Per-agent prompt injection mode + preflight trust + draft-prefill

- **Origen orca**: `src/shared/tui-agent-config.ts` (271 LOC), `src/main/agent-trust-presets.ts` (134 LOC)
- **Apohara actual**: `src/core/providers/tui-agent-config.ts`, `src/core/providers/trust-presets.ts`, `src/core/providers/agent-config.ts`
- **Status**: ✅ COMPLETO
- **Evidencia**:
  - `tui-agent-config.ts:64-158` define `TUI_AGENT_CATALOG` con 9 agentes (3 active + 6 legacy), cada uno con `promptInjectionMode`, `draftPromptFlag`, `preflightTrust`, `nonInteractive`, `active`.
  - `trust-presets.ts:79-195` implementa pre-write canónico para `claude` (`~/.claude/settings.json` `trustedFolders`), `codex` (`~/.codex/config.toml` `[projects.""] trust_level`), `cursor` (`~/.cursor/projects/<slug>/.workspace-trusted`), `copilot` (`~/.copilot/config.json` `trustedFolders`), `aider` (`~/.aider/projects.json` `auto_confirm`). Usa `canonicalize()` con `realpathSync` para macOS `/tmp` vs `/private/tmp`.
  - Integrado al spawn via `applyTrustForProvider(providerId, workspacePath)` en `trust-presets.ts:46-53`.
- **Gap (si PARCIAL)**: N/A. La matriz cubre todos los modos del spec orca; el único faltante explícito es `draftPasteReadySignal` y `draftPromptEnvVar` para Pi (`ORCA_PI_PREFILL`) — el comentario `tui-agent-config.ts:7-9` los descarta intencionalmente.
- **Recomendación**: Verificar provenance comment ("verified against `<binary> <version>`") al estilo orca — hoy los paths trust están justificados en comentarios pero sin versión binaria; cerrar con un test E2E que escriba el archivo y haga el spawn real cuando esté disponible.

### Hallazgo 3: Commit-message agent spec (non-interactive runs)

- **Origen orca**: `src/shared/commit-message-agent-spec.ts` (~500 LOC, parsers líneas 114-205)
- **Apohara actual**: `src/core/git/commit.ts` + `src/core/mcp/servers/apohara-commit.ts` (MCP tool `apohara_commit_proposal`)
- **Status**: 🟡 PARCIAL
- **Evidencia**:
  - `commit.ts:102-218` implementa `proposeCommit({workspace, filesToStage, message, ...})` con lock per-workspace, staging granular, HEAD snapshot, rollback en fallo. Confirma SHA con `git show HEAD --format=%H`.
  - MCP server `apohara-commit.ts:127-142` expone la tool; el mensaje VIENE PREARMADO desde el caller agent (no se genera).
- **Gap**: NO existe un registry/spec de "commit-message agent non-interactive" análogo a orca (Apohara no tiene `non-interactive-agent.ts`). Faltan: (a) `modelSource: 'static' | 'dynamic'` + `modelDiscovery` (binary + args + JSON parser) — Codex `codex debug models` sin implementar. (b) `buildArgs({prompt, model, thinkingLevel})` declarativo por agente. (c) Invocación headless real (`claude -p --output-format text --model sonnet --permission-mode plan --effort low`, `codex exec --ephemeral --skip-git-repo-check -s read-only`). Hoy el commit message lo trae el agent vivo que llama la MCP tool.
- **Recomendación**: Crear `src/core/non-interactive-agent.ts` con la tabla shape de orca; el consolidator lo invocará para auto-generar commit messages y PR bodies cuando consolide worktrees.

### Hallazgo 4: OSC title parsing como fallback para agentes sin hooks

- **Origen orca**: `src/shared/agent-detection.ts` (499 LOC)
- **Apohara actual**: `src/core/hooks/osc-fallback.ts` (planned per plan línea 3425) — NO existe
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**:
  - `find ... grep -l "OSC\|extractLastOsc\|detectAgentStatus"` solo matchea `packages/tui/lib/sanitize.ts` cuyo objetivo es **strip** OSC/CSI (sanitize.ts:14-33), no parsearlo.
  - `Capability::OscTitleUpdates` está declarado en `crates/apohara-types` (spec §3.5 lo menciona como fallback en chain hook>OSC>nada) pero ningún consumer parsea title strings.
  - El plan en `2026-05-22-apohara-v1.md:3425` lista `Create: src/core/hooks/osc-fallback.ts` — file no creado.
- **Recomendación**: Implementar `src/core/hooks/osc-fallback.ts` con `extractLastOscTitle`, símbolos por agente (Claude `✳`, Gemini `✦/⏲/◇/✋`, Pi `π -`, braille `U+2800-U+28FF`) y `createAgentStatusTracker` que dispare `onBecameIdle`. Ruta crítica para R6 del spec.

### Hallazgo 5: Worktree delete preflight (status check antes de killar PTYs)

- **Origen orca**: `docs/worktree-delete-preflight.md`, `src/main/git/worktree.ts:415-433` (`assertWorktreeCleanForRemoval`), `src/main/worktree-removal-safety.ts`
- **Apohara actual**: `crates/apohara-worktree/src/preflight.rs`, `crates/apohara-worktree/src/lifecycle.rs::cleanup()`
- **Status**: ✅ COMPLETO
- **Evidencia**:
  - `preflight.rs:19-52` define `delete_preflight(task_id, repo_path) -> PreflightReport` con variantes `Clean | DirtyFiles(Vec<PathBuf>) | UnpushedCommits(usize) | LiveAgent`. Corre `git status --porcelain --untracked-files=all` excluyendo `.apohara-lock` y `.apohara-meta.json`, luego `git rev-list @{upstream}..HEAD` para contar commits no pusheados.
  - `lifecycle.rs:106-136` integra preflight en `cleanup()` ANTES de cualquier rm: si reporte ≠ Clean routa a `preserve_on_fail` (que crea recovery branch `apohara/task-<id>-failed-<ts>`) sin tocar disco.
- **Gap**: N/A.
- **Recomendación**: La rama `LiveAgent` está declarada como variant pero no es producida hoy por `delete_preflight()` (solo `Clean / DirtyFiles / UnpushedCommits`). Cuando el agent-hooks server escriba estado live a SQLite, conectarlo aquí para que un PreToolUse activo refuse delete.

### Hallazgo 6: Worktree lineage (parent worktree) explícito

- **Origen orca**: `skills/orca-cli/SKILL.md:152-167`, `src/main/runtime/orca-runtime.ts::removeManagedWorktree`, `src/shared/types.ts` (`parentWorktreeId`)
- **Apohara actual**: `crates/apohara-worktree/src/lineage.rs`, `crates/apohara-worktree/src/lifecycle.rs::WorktreeMeta`
- **Status**: 🟡 PARCIAL
- **Evidencia**:
  - `lifecycle.rs:25-32` define `WorktreeMeta { task_id, created_at, branch, parent_task_id: Option<String>, lineage_root: Option<String> }`.
  - `lineage.rs:6-23` expone `set_lineage(task_id, parent_task_id, lineage_root, repo_path)` que escribe los campos en `.apohara-meta.json`.
- **Gap**: (a) `create()` (lifecycle.rs:44-73) NO infiere parent automáticamente — siempre crea con `parent_task_id: None, lineage_root: None`. Hay que llamar `set_lineage()` explícitamente post-creación. (b) NO existe flag CLI `--parent-worktree active | id:X | branch:Y | --no-parent`. (c) NO hay cascading-delete prompt cuando se borra el parent (la UI no muestra árbol de lineage). (d) Decomposer no setea `lineage_root = objectiveId` al crear sub-tasks.
- **Recomendación**: Agregar parámetros opcionales `parent_task_id` y `lineage_root` a `lifecycle::create()` + flags CLI + cascading-delete check en `cleanup()`.

### Hallazgo 7: Workspace-cleanup tiers (ready / review / protected) con dismissals + fingerprint

- **Origen orca**: `src/shared/workspace-cleanup.ts` (233 LOC)
- **Apohara actual**: `src/core/worktree-manager.ts::pruneStale()` (parcial), `crates/apohara-worktree/src/cleanup.rs::prune_stale()` (parcial)
- **Status**: 🟡 PARCIAL
- **Evidencia**:
  - `worktree-manager.ts:292-330` y `cleanup.rs:20-32` implementan `pruneStale(olderThanMs)` que respeta lock-file grace period y borra dirs vencidos.
- **Gap**: NO existen las categorías `ready` / `review` / `protected`, NO existen blockers nombrados (`main-worktree`, `running-terminal`, `dirty-files`, `unpushed-commits`, `live-agent`), NO hay dismissals con fingerprint (`branch+head+gitClean+lastActivityBucket+classifierVersion`). El prune actual es binario "viejo → borrar / nuevo → mantener" sin escalation a humano.
- **Recomendación**: Portar `workspace-cleanup.ts` 1:1 a `src/core/worktree/workspace-cleanup.ts` con dismissals persistidos en SQLite (junto al ledger). UI panel "Cleanup suggestions" en Sidebar es Sprint posterior.

### Hallazgo 8: Orphan worktree adoption + cross-platform path handling

- **Origen orca**: `src/main/git/worktree.ts` (466 LOC), `src/main/repo-worktrees.ts`, `src/shared/cross-platform-path.ts`
- **Apohara actual**: `src/core/worktree-manager.ts::adoptOrphan()`, `crates/apohara-worktree/src/cleanup.rs::adopt_orphan()`
- **Status**: 🟡 PARCIAL
- **Evidencia**:
  - Apohara `adoptOrphan(path)` (worktree-manager.ts:192-227) y `adopt_orphan(path)` (cleanup.rs:10-18) adoptan dirs HUÉRFANOS bajo `.claude/worktrees/` con `.apohara-meta.json` válido y lock viejo (>5 min).
- **Gap**: (a) NO se hace `git worktree list --porcelain` para descubrir worktrees creados por `git worktree add` externos a Apohara — `grep -rn "git worktree list"` no devuelve resultados. (b) NO hay `cross-platform-path.ts` con `areWorktreePathsEqual` para Windows / WSL. (c) NO detecta sparse-checkout por archivo (`<gitdir>/info/sparse-checkout` vs subproceso por worktree). (d) Tras `worktree remove` no se corre `worktree prune` ni se chequea branch-in-use por sibling.
- **Recomendación**: Crear `crates/apohara-worktree/src/discovery.rs` con `list_git_worktrees() -> Vec<GitWorktreeInfo>` (parse de `--porcelain`), invocado al `register_repo`. Setear `adopted: true, lineage_root: None` para los descubiertos.

### Hallazgo 9: SQLite-backed orchestration (messages + tasks DAG + dispatch_contexts + decision_gates)

- **Origen orca**: `src/main/runtime/orchestration/db.ts`, `coordinator.ts`, `preamble.ts`, `groups.ts`, `types.ts`, `formatter.ts`, `src/cli/handlers/orchestration.ts`, `skills/orchestration/SKILL.md` (211 LOC)
- **Apohara actual**: `src/core/orchestration/{db.ts,messages.ts,tasks.ts,dispatch-contexts.ts,decision-gates.ts,coordinator-runs.ts,groups.ts,preamble.ts,check-wait.ts,drift-probe.ts,circuit-breaker.ts,setup-verification.ts,migrations/001_initial.sql}`
- **Status**: 🟡 PARCIAL
- **Evidencia**:
  - `migrations/001_initial.sql` (73 LOC) replica las 5 tablas centrales: `messages` (con CHECK `type IN (8 valores)` y `priority IN (3 valores)`), `tasks` (status 6 valores, deps JSON), `dispatch_contexts`, `decision_gates` (status `open|resolved`), `coordinator_runs`.
  - `db.ts:22-53` abre WAL + busy_timeout=5000 + foreign_keys ON + `PRAGMA user_version` gating.
  - `messages.ts:38-170` implementa `sendMessage`, `listUnread`, `markRead`, **`claimNextUnread`** (transacción atómica anti-race) — orca también tiene atomic claim pero ese fix es nuevo de Apohara, no de orca.
  - `tasks.ts:73-93` agrega `tryClaimTask(expected, next)` con UPDATE conditional para evitar doble-dispatch.
  - `groups.ts:19-70` resuelve `@all`, `@idle`, `@worktree:<id>`, `@claude/@codex/@opencode/@<provider>` exactamente como orca.
  - `circuit-breaker.ts:14-25` con threshold env-configurable `APOHARA_CIRCUIT_BREAKER_THRESHOLD` (default 3, =orca).
  - `decision-gates.ts:29-104` con `openGate/resolveGate/resolveAllBlockingTask/listOpenGates`. `listReadyTasks` (tasks.ts:95-134) excluye tasks con open decision-gate.
- **Gap**: (a) **NO existe la clase `Coordinator` con polling loop**. orca tiene `src/main/runtime/orchestration/coordinator.ts` que recorre tasks ready, abre dispatches, escucha worker_done, resuelve gates. En Apohara los CRUD módulos están pero falta el conductor central. (b) **NO hay push-on-idle delivery**: el `@idle` resolver query la DB pero nadie emite eventos cuando una dispatch_context pasa a `running` → no-unread; el consumer hace polling. (c) `coordinator-runs.ts` solo expone `startRun/setRunStatus` — falta un binario CLI `apohara run --tag X` que arranque/pare runs. (d) Falta el handler `dispatch` que escriba `dispatch_contexts` + ledger event ANTES del spawn del agente (hoy se hace ad-hoc en `dispatch/dispatcher.ts` fuera del módulo de orchestration).
- **Recomendación**: Crear `src/core/orchestration/coordinator.ts` con loop `setInterval` (o EventEmitter sobre WAL hooks) que: claim ready tasks → dispatch a `@idle` resolvable → escribir dispatch_context → emit ledger → escuchar worker_done. Es ~150 LOC y desbloquea Hallazgo 11.

### Hallazgo 10: Dispatch preamble que enseña al worker cómo comunicarse

- **Origen orca**: `src/main/runtime/orchestration/preamble.ts:38-147`
- **Apohara actual**: `src/core/orchestration/preamble.ts`
- **Status**: ✅ COMPLETO
- **Evidencia**:
  - `preamble.ts:35-75` exporta `buildDispatchPreamble({taskId, dispatchId, coordinatorHandle, taskSpec, baseDrift})`. Genera el bloque "Communication protocol" con prohibición explícita de `AskUserQuestion` y los 3 comandos CLI (`send --type worker_done`, `--type heartbeat`, `ask`). Incluye `## BASE DRIFT WARNING` con los 5 subjects más recientes si `baseDrift.commitsBehind > 0`.
- **Gap**: N/A para el shape — el preamble queda equivalente al orca template (idiomatic markdown + drift section).
- **Recomendación**: Cuando lande el Coordinator (gap del Hallazgo 9), llamar a `buildDispatchPreamble` antes del spawn y pegarlo vía `--prefill` (Claude) / `flag-prompt` (opencode) / `stdin-after-start` (otros) según `tui-agent-config.ts::promptInjectionMode`.

### Hallazgo 11: `orca orchestration check --wait` para reemplazar sleep+poll loops

- **Origen orca**: `src/cli/handlers/orchestration.ts:34-52` (`startCheckHeartbeat`), `:120-163` (`orchestration check`)
- **Apohara actual**: `src/core/orchestration/check-wait.ts` + CLI handler `src/cli/orchestration.ts`
- **Status**: 🟡 PARCIAL
- **Evidencia**:
  - `check-wait.ts:23-60` implementa `checkWait(db, {toHandle, types, timeoutMs, heartbeatStream, heartbeatIntervalMs=15000, pollIntervalMs=250})` con atomic claim, heartbeat lines JSON `{_heartbeat: true, elapsedMs, deadlineMs}`, deadline-aware poll.
- **Gap**: La función EXISTE pero **NO está cableada al CLI handler**. `src/cli/orchestration.ts:35-51` (case `"check"`) solo hace `listUnread(...).limit=1` y emite el primer mensaje o "no_messages" — sin `--wait`, sin `--timeout-ms`, sin heartbeat. La feature está implementada como librería pero no expuesta al worker agent vía `apohara orchestration check --wait`.
- **Recomendación**: Agregar al handler `check`: parsing de `--wait` (boolean), `--timeout-ms <ms>`, y delegar a `checkWait()` cuando esté presente. Output JSON al final (match con `--wait`).

### Hallazgo 12: Drift detection en dispatch + `allow-stale-base: true` opt-in

- **Origen orca**: `src/main/runtime/orchestration/coordinator.ts:36-61` (`DISPATCH_STALE_THRESHOLD`, `parseAllowStaleBaseFromSpec`), `preamble.ts::buildDriftSection`
- **Apohara actual**: `src/core/orchestration/drift-probe.ts`
- **Status**: 🟡 PARCIAL
- **Evidencia**:
  - `drift-probe.ts:9-105` implementa `probeWorktreeDrift(worktreePath, baseRef) -> {commitsBehind, recentSubjects[]}` con `git fetch origin baseRef`, `git rev-list --count HEAD..origin/baseRef`, `git log --pretty=%s -5 HEAD..origin/baseRef`. Envío sanitizado con `sanitizeEnv()`.
  - `shouldRefuseDispatch(drift, spec) -> boolean` chequea threshold (default 20 via `APOHARA_DISPATCH_STALE_THRESHOLD`) y `spec.allowStaleBase === true` opt-in.
  - Drift section integrada a `preamble.ts::buildDispatchPreamble` (líneas 36-45).
- **Gap**: **Ningún caller invoca `probeWorktreeDrift` ni `shouldRefuseDispatch`**. `grep -n "probeWorktreeDrift\|shouldRefuseDispatch" src/` solo matchea la definición. Como no existe Coordinator (Hallazgo 9), no hay nadie que gate el dispatch sobre drift. La librería está pero el wiring no.
- **Recomendación**: Cuando el Coordinator lande, llamar `probeWorktreeDrift` en `claimReadyTask` antes de `insertDispatchContext`; si `shouldRefuseDispatch === true` emitir `DispatchRefusedDrift` event y dejar la task en `pending`.

### Hallazgo 13: Terminal attribution shim (git/gh wrappers que inyectan Co-authored-by)

- **Origen orca**: `src/main/attribution/terminal-attribution.ts` (~400 LOC, código 32-183), `ATTRIBUTION_SHIM_VERSION='6'`
- **Apohara actual**: NO existe — `find ... grep -l "attribution\|Co-authored\|Co-Authored\|terminal-attribution\|enableGitHubAttribution"` no devuelve coincidencias en `src/` ni `packages/`
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `grep -l "Co-authored\|enableGitHubAttribution"` en `src/` y `packages/` (excluyendo `node_modules`/`target`) sin resultados. Los commits que crea `commit.ts::proposeCommit()` NO inyectan trailer `Co-Authored-By:`.
- **Recomendación**: Implementar `src/core/attribution/terminal-shim.ts` que genere wrappers POSIX (`.sh`), Windows (`.cmd`+`.ps1`) en `<userData>/apohara-terminal-attribution/{posix,win32}/`, los prepend al PATH SOLO en PTYs spawneados por Apohara, y resuelva real-git via `APOHARA_REAL_GIT` env var. Trailer `Co-Authored-By: Apohara <noreply@apohara.dev>`.

### Hallazgo 14: Smart Attention class para sort/filter worktrees por urgencia

- **Origen orca**: `src/renderer/src/components/sidebar/smart-attention.ts` (382 LOC, 4 clases ordinales)
- **Apohara actual**: `packages/desktop/src/components/TaskBoard/hooks/smart-attention.ts` + `use-taskboard-smart-attention.ts` + `crates/apohara-attention/src/lib.rs`
- **Status**: 🟡 PARCIAL
- **Evidencia**:
  - `smart-attention.ts:36-75` define `classifyTask`, `sortByAttention`, `promotePaneClass` con tiers `NeedsYou | Working | Done | Idle` y `TIER_ORDER`. Tie-break por `attentionTimestamp DESC`.
  - `crates/apohara-attention/src/lib.rs:13-128` agrega state machine determinista `Band {Hot, Warm, Cool, Idle}` con per-band hold timers + saturate `last_promote.max(now)` anti-rewind (culture #3 inspiration).
- **Gap**: (a) Apohara NO implementa el detalle "hook authority es per-pane (no per-worktree)" — orca permite que un worktree con dos panes (Claude en A, OpenCode en B) tenga hook authority distinto. Apohara TaskBoard razona sobre `DagTask`, no sobre panes. (b) Falta `attentionTimestamp` con semánticas distintas por clase: `Class 3 Working` debe usar `mostRecentAttentionInHistory` para que worktrees recientemente done→working ranking arriba. (c) NO hay defensive guards contra `NaN`/`Infinity` en timestamps corrupted (el orca `min-of-pane-classes` también promueve la pane más urgente). (d) `interrupted` (Ctrl+C) se degrada a idle (orca behavior) — Apohara no tiene state `interrupted`.
- **Recomendación**: Cuando agent-hooks server escriba a SQLite per-pane (Hallazgo 1 gap), extender `smart-attention.ts` para razonar sobre `agentStatusByPaneKey` Map y aplicar `min-of-pane-classes` antes de clasificar el worktree.

### Hallazgo 15: Workspace Kanban con drag-to-status, area-selection, columnas custom, pin-drop-target

- **Origen orca**: `src/renderer/src/components/sidebar/WorkspaceKanban*.tsx` + ~15 hooks `use-workspace-kanban-*.ts`
- **Apohara actual**: `packages/desktop/src/components/TaskBoard/{TaskBoard.tsx, TaskBoardLane.tsx, TaskBoardCard.tsx, TaskBoardDrawer.tsx}` + 7 hooks
- **Status**: 🟡 PARCIAL
- **Evidencia**:
  - `TaskBoard.tsx:9-33` renderiza lanes desde `useTaskBoardStore().tasksByStatus`.
  - Hooks present: `use-taskboard-pointer-drag.ts` (native pointer events, NO HTML5 DnD — `:18-43`), `use-taskboard-area-selection.ts`, `use-taskboard-column-resize.ts` (con persistencia localStorage `:13-35`), `use-taskboard-shift-wheel-scroll.ts`, `use-taskboard-outside-dismiss.ts`, `use-taskboard-smart-attention.ts`.
- **Gap**: (a) **NO existe `use-taskboard-selection.ts`** (multi-select para bulk actions; el `area-selection` está pero el selection store no). (b) **NO hay pin-drop-target** (la columna pinneable de orca que se queda visible al scroll). (c) **NO hay status appearance popover** (custom colors/emojis por columna). (d) **NO existe "custom columns"** persistidas: las columnas son fijas (statuses del DAG). El test plan menciona `custom_column.spec.ts` pero el archivo de test no está creado y ningún source matchea "custom column" creator.
- **Recomendación**: Cerrar `use-taskboard-selection.ts` (bulk archive es valor inmediato), después pin column y custom columns (persistidas en SQLite junto al ledger).

### Hallazgo 16: Skills discovery (escanea ~/.claude/skills, ~/.codex/skills, ~/.agents/skills, repo .claude/skills, repo .agents/skills)

- **Origen orca**: `src/main/skills/discovery.ts` (270 LOC), `src/shared/skill-metadata.ts`
- **Apohara actual**: `skills/apohara-cli/SKILL.md`, `skills/apohara-orchestration/SKILL.md` — pero NO existe discovery code
- **Status**: 🟡 PARCIAL
- **Evidencia**:
  - `skills/` shipea 2 SKILL.md propias.
  - `find ... grep -l "skills.*discovery\|SKILL.md\|discoverSkills\|skill-metadata"` no devuelve coincidencias en código.
- **Gap**: NO existe scanner recursivo de `~/.claude/skills`, `~/.codex/skills`, `~/.agents/skills`, repo `.claude/skills`, repo `.agents/skills` con depth=4/9, frontmatter parsing, dedup por skillFilePath, sourceKind, fileCount. Las skills propias se shipean pero no se "instalan" automáticamente en `~/.claude/skills/apohara-orchestration/`.
- **Recomendación**: Crear `src/core/skills/discovery.ts` con la lógica 1:1 + un installer que copie `skills/apohara-orchestration/SKILL.md` al home del agente activo al `apohara setup`.

### Hallazgo 17: Dashboard agent rows con stale-decay + freshness scheduler

- **Origen orca**: `src/renderer/src/components/dashboard/useDashboardData.ts` (195 LOC), `src/renderer/src/store/slices/agent-status-freshness-scheduler.ts`, `src/main/agent-hooks/server.ts:937-1021` (hydrate from disk)
- **Apohara actual**: NO existe — `find ... grep -l "stale-decay\|AGENT_STATUS_STALE\|freshness.*scheduler\|isExplicitAgentStatusFresh\|agent-status-freshness"` no devuelve coincidencias
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: No hay agent-status freshness scheduler, no hay decay (`working → idle` cuando expira TTL `AGENT_STATUS_STALE_AFTER_MS=30min`), no hay persistencia `last-status.json` con TTL `7 días`. El `crates/apohara-attention` SÍ tiene decay band Hot→Warm→Cool→Idle pero opera sobre el **target de atención** (¿necesito atender X?), no sobre el **estado del agente** (Claude está working/idle/blocked).
- **Recomendación**: Crear `src/store/agent-status-freshness.ts` con `setInterval` cada `STALE/4` ms que itere `agentStatusByPaneKey`, decay `working|blocked|waiting → idle` cuando entry no es fresh (last event > 30min). `done` NUNCA decae. Persistir `last-status.json` en `<userData>/apohara/agent-status.json` con atomic-rename + per-entry TTL 7 días.

---

## Top 3 gaps de mayor valor

1. **Hallazgo 9 — Coordinator polling loop**: las 5 tablas + CRUD + groups + circuit-breaker + decision-gates + drift-probe + check-wait están implementadas pero **no hay un actor central que las orqueste**. Sin esto, los hallazgos 10/11/12 quedan como librerías huérfanas. ROI más alto del audit.
2. **Hallazgo 11 — `check --wait` no cableado al CLI**: la función `checkWait()` con heartbeats JSON está implementada pero el CLI handler todavía hace `listUnread().limit=1`. ~30 LOC para conectar + 1 test. Bloquea workers de hacer sleep+poll loops.
3. **Hallazgo 1 — Broadcast channel TODO**: `crates/apohara-hooks-server/src/event.rs:100` tiene `// TODO Stage 2.3: forward to broadcast channel + orchestration DB`. Sin esto, los hook events llegan al server pero no se entregan al resto del sistema; toda la cadena agent-hooks → smart-attention → freshness scheduler queda ciega.
