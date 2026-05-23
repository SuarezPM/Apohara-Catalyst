# Reference Mining Sprints — Plan Original (Reconstituido del transcript)

> Reconstituido del JSONL `924f0b67-eab5-4817-8f85-3b67ac992d2d.jsonl` el 2026-05-22.
> Sprints 1-3 ya están ejecutados sobre la branch `feat/apohara-v1`. Este archivo conserva el plan
> original tal como se armó (Tiers 1-3 con T1.x / T2.x / T3.x), y anota qué quedó ejecutado vs.
> propuesto pero no abordado en esta tanda.

---

## Contexto del plan

Resultado del análisis de los 10 reference repos clonados en
`/home/thelinconx/Documentos/Apohara_Ultimate/reference/` (orca, nimbalyst, chorus,
agentrail, vibe-kanban, opencode, claude-octopus, symphony, multica, culture).

Las tareas se agruparon en tres tiers según prioridad:

- **TIER 1** — Lo que cierra "Run no hace nada" (4 tareas, 1-2 semanas).
- **TIER 2** — Visible / Wow factor (6 tareas, 1-2 semanas adicionales).
- **TIER 3** — Estratégico / polish (20 tareas).

Y se ordenaron en tres sprints de 1-2 semanas cada uno (Sprint 1, 2 y 3).

---

## Sprint 1 — Hacer que "Run" funcione end-to-end

**Duración estimada:** 1-2 semanas.
**Estado:** **EJECUTADO** (4 commits sobre `feat/apohara-v1`).

### Tareas

- **T2.4 — opencode driver fix (bug-fix necesario antes que nada)**
  - **Origen:** opencode `packages/opencode/src/cli/cmd/{run.ts,acp.ts}` + `src/config/{config,mcp,plugin}.ts`.
  - **Bugs descubiertos:** provider mal nombrado `opencode-go` (es TS/Bun, no Go); config path equivocado (escribimos `.opencode/settings.json`; lo correcto es `opencode.jsonc`); protocolo subóptimo (usabamos `-p <prompt>` que es `--password`, no `--prompt`; lo correcto es `opencode acp` stdio JSON-RPC o `--format json` NDJSON).
  - **Por qué:** estamos drivando opencode al 10% de su superficie. Con ACP/NDJSON obtenemos session resume/fork, tool-use events en vivo, reasoning streams.
  - **Esfuerzo:** 2 días.
  - **Commit ejecutado:** `5a52031`.

- **T1.1 — Agent-Teams JSON dispatch + Result-file handoff (EL fix)**
  - **Origen:** claude-octopus `scripts/lib/spawn.sh:414-471` + `hooks/subagent-result-capture.sh:38-107`. Más agentrail `src/cli/agent-runner.ts:853-861, 2594`.
  - **El patrón:** `/api/run` recibe prompt -> escribe `<workspace>/.apohara-run/<task_id>.json` con `{agent, role, prompt, result_file, env}`. Worker subprocess: spawn `claude --print` o `opencode acp` con `APOHARA_RESULT_PATH=<result_file>` en env. El CLI escribe su output al result_file (o lo capturamos via PostToolUse hook). Apohara watchea el directorio y emite eventos al ledger al ver writes.
  - **Por qué supera el approach actual:** cero spawn complexity en el bun server, cero API calls, recovery en crash trivial (releemos archivos), cada agente aislado.
  - **Esfuerzo:** 2-3 días.
  - **Commit ejecutado:** `43deb82`.

- **T1.2 — ExecutorAction tree + start_workspace orchestrator**
  - **Origen:** vibe-kanban `crates/executors/src/actions/mod.rs:25-72` + `crates/services/src/services/container.rs:1047-1129`.
  - **El patrón:** tagged enum recursivo `{CodingAgentInitialRequest, FollowUp, ScriptRequest, ReviewRequest}` con `next_action: Option<Box<ExecutorAction>>`. Una sola fn async crea worktree -> session row -> builds ExecutorAction chain -> persiste ExecutionProcess. Setup -> coding -> cleanup en un JSON blob.
  - **Por qué:** el decomposer actual escupe tasks sueltas. Esto da el chain lifecycle que envuelve cada task con setup/run/cleanup determinista.
  - **Esfuerzo:** 3-4 días.
  - **Commit ejecutado:** `d7ffbce`.

- **T1.4 — Symphony state machine vocabulary**
  - **Origen:** symphony `SPEC.md §7.1` + `§8.5`.
  - **El patrón:** 5 states (Unclaimed/Claimed/Running/RetryQueued/Released) + 11 run-attempt phases (PreparingWorkspace -> BuildingPrompt -> LaunchingAgentProcess -> InitializingSession -> StreamingTurn -> Finishing -> Succeeded|Failed|TimedOut|Stalled|CanceledByReconciliation). Más reconciliation tick que detecta stalls (`elapsed_ms > stall_timeout_ms` -> kill+retry).
  - **Por qué:** las 7 task statuses actuales son del DOMINIO de usuario, no del runner. Esto agrega las del RUNTIME. Resuelve "qué hace Apohara internamente cuando el agente se cuelga".
  - **Esfuerzo:** 1 día.
  - **Commit ejecutado:** `9e58d80`.

### Outcome del Sprint 1

Click Run -> decomposer corre -> tasks ready -> worker subprocess (con sandbox+worktree) -> CLI escribe result_file -> UI lo lee. Kanban se llena en vivo.

**Bugs colaterales arreglados:** `fs.watch` linux only-dispara-en-tmp -> reescrito a `readdir`-on-every-tick + polling 1s. `ProviderRouter.callOpenCode` (REST path con API key) eliminado por violar "CLI wrappers only". `AGENT_CONFIG["opencode-go"].args = ["--pure"]` (flag inexistente) -> corregido a `["run", "--format", "json"]`.

**Tests:** 453 bun verde, tsc clean, browser e2e verificado.

---

## Sprint 2 — Visible / Wow

**Duración estimada:** 1-2 semanas.
**Estado:** **EJECUTADO** (5 commits sobre `feat/apohara-v1`).
**Orden real de ejecución:** T2.5 -> T2.2 -> T1.3 (re-scoped) -> T2.3 -> T2.1 (estrategia "smallest+independent first" para shipping continuo).

### Tareas

- **T2.5 — agent-trust-presets.ts**
  - **Origen:** orca `src/main/agent-trust-presets.ts:1-133`.
  - **El patrón:** pre-escribir `~/.cursor/projects/<slug>/.workspace-trusted`, `~/.copilot/config.json::trustedFolders`, `~/.codex/config.toml::[projects."<realpath>"] trust_level="trusted"` antes de spawnear cada CLI. Salta los diálogos interactivos de "trust this folder?".
  - **Por qué:** el `trust-presets.ts` actual solo cubre claude + codex parcialmente. Orca tiene los paths reverse-engineered de cada CLI's bundle.
  - **Esfuerzo:** 1 día.
  - **Commit ejecutado:** `0db783f` (5 trust targets: claude/codex/cursor/copilot/aider, idempotente, refuse-on-corrupted).

- **T2.2 — TUI_AGENT_CONFIG: catálogo único de agentes**
  - **Origen:** orca `src/shared/tui-agent-config.ts:1-270` (27 agentes en un `Record<TuiAgent, TuiAgentConfig>`).
  - **Schema robable:** `{ detectCmd, launchCmd, expectedProcess, promptInjectionMode: 'argv'|'flag-prompt'|'flag-prompt-interactive'|'flag-interactive'|'stdin-after-start', draftPromptFlag?, draftPromptEnvVar?, preflightTrust?: 'claude'|'codex'|'cursor', draftPasteReadySignal? }`.
  - **Por qué:** los 3 providers actuales tienen su lógica dispersa en `src/providers/cli-driver.ts` + `BaseAgentProvider`. Esto colapsa todo en una tabla. Setup gratis para soportar Grok, Gemini, Cursor, Antigravity, Aider, etc. — solo agregar entradas.
  - **Esfuerzo:** 1-2 días + 3 días para soportar 5 agentes más (cursor, gemini-cli, aider, grok, antigravity).
  - **Commit ejecutado:** `bbba603` (8 agents con metadata uniforme + 3 nuevos CLI drivers ejecutables: cursor-agent, copilot-cli, aider).

- **T1.3 (re-scoped) — Runner phase events (SQLite hooks -> SSE patches)**
  - **Origen original:** vibe-kanban `crates/services/src/services/events.rs:75-180` — SQLx `set_preupdate_hook` + `set_update_hook` capturan TODO cambio de row -> RFC6902 JSON Patches via SSE.
  - **Por qué importa:** el bus actual requiere que el código que escribe al DB recuerde emitir el evento. Esto lo hace automático a nivel SQLite. TaskBoard se actualizaría en vivo desde CUALQUIER mutación.
  - **Esfuerzo original:** 2 días (con la decisión arquitectónica de mover orchestration DB de bun:sqlite a Rust + exponer SSE desde un sidecar, porque bun:sqlite no tiene preupdate hooks nativos).
  - **Re-scope adoptado:** runner phase events (symphony §7.1 phases) emitidos al ledger SSE en lugar del hook-de-DB nativo. El SSE -> bus mapping landing en App.tsx via `task_phase` event.
  - **Commit ejecutado:** `92e9ac9` (runner emite `preparing_workspace -> launching_agent_process -> finishing -> succeeded`).

- **T2.3 — Hook system loopback HTTP server (mejora del existente)**
  - **Origen:** orca `src/main/agent-hooks/server.ts:1-1130` — loopback HTTP con bearer auth, 9 managed scripts por CLI agent (PreToolUse / PostToolUse / Stop / etc), persist a `userData/agent-hooks/last-status.json`.
  - **Diff con `apohara-hooks-server`:** sidecar axum funcional pero NO wired al UI ni a los CLIs. Faltaba: (a) instalar los managed scripts por agente (orca tiene 9: claude-hook.sh, codex-hook.sh, etc); (b) `ORCA_HOOK_PROTOCOL_VERSION` env injection al spawnear cada CLI; (c) persistencia de last-status para UI.
  - **Esfuerzo:** 3-4 días.
  - **Commit ejecutado:** `048905a` (TS loopback HTTP mirror del axum crate + 3 hook scripts shell + lazy boot + env var injection. 10 tests).

- **T2.1 — PTY embedding (Ghostty WASM + node-pty/portable-pty)**
  - **Origen:** orca `src/relay/pty-handler.ts:1-681` + `src/renderer/src/components/terminal-pane/pty-transport.ts` + nimbalyst `packages/electron/src/main/services/TerminalSessionManager.ts:1-118` + renderer Ghostty WASM en `TerminalPanel.tsx`.
  - **El patrón:** Bun side `node-pty` (Bun lo soporta) con replay buffer 100KB por PTY + `APOHARA_PANE_KEY = ${tabId}:${paneId}` env injection + SIGTERM+5s SIGKILL fallback. Renderer: importar `ghostty-web` WASM como display. OSC 7 para CWD, OSC 998 custom para command-state.
  - **Por qué:** los CLIs se spawnean headless. El usuario no ve nada. Esto es el diferenciador visual de Orca ("PTY-embedded multi-agent terminals"). Sin esto, no hay demo video posible.
  - **Esfuerzo:** 5-7 días.
  - **Commit ejecutado:** `075aa77` (node-pty + xterm.js. Registry con 100KB replay buffer, 50 cap, post-exit data capture. 5 HTTP routes: `POST /api/pty`, SSE `stream`, `input`, `resize`, `DELETE`. React `TerminalPane.tsx`).

### Outcome del Sprint 2

8 CLI agents soportados via catalog (3 active + cursor + copilot + aider con runtime + grok/antigravity catalog-only). Trust modales eliminados automáticamente para cursor/copilot/aider además de claude/codex. Phase events en vivo: cada Run muestra 4 task_phase entries en el ledger. Hooks server bootstraped automáticamente en `/api/run` (verified: manual POST a `/event` aterrizó como `hook_event` en el ledger). PTY embedding funcional al nivel HTTP (verified: spawn `/bin/echo` via POST -> exit 0 -> list endpoint).

**Tests:** 480 bun verde, ~2500 LOC nuevos.

**Pendiente arrastrado a Sprint 3:** Mount `TerminalPane.tsx` en `App.tsx` (el componente existía pero no estaba agregado al layout).

---

## Sprint 3 — Producto presentable

**Duración estimada:** 1-2 semanas.
**Estado:** **EJECUTADO** (7 commits sobre `feat/apohara-v1`).

### Tareas

- **Polish — Mount TerminalPane en App.tsx** (arrastrado del Sprint 2)
  - Necesita decisión UX: tab por PTY activo / debajo del kanban / etc.
  - **Commit ejecutado:** `7f565c2` (TerminalView con listado + spawn + render selected).

- **T3.15 — CLAUDE.md "Past incident" pattern**
  - **Origen:** nimbalyst `/CLAUDE.md` + `.claude/rules/*.md`.
  - **Por qué:** rule + session ID + dollar cost + user quote — patrón de "incidente pasado" reciclable.
  - **Esfuerzo:** 1 día.
  - **Commit ejecutado:** `be4847b` (6 incidentes documentados).

- **T3.1 — OpenSpec change-folder convention**
  - **Origen:** chorus `openspec/changes/<slug>/{proposal,design,tasks,specs}`.
  - **Por qué:** spec rigor + audit trail.
  - **Esfuerzo:** 2 días.
  - **Commit ejecutado:** `42b09d7` (validator TS + example change folder, 6 tests).

- **T2.6 — AI commit como MCP tool**
  - **Origen:** nimbalyst `packages/electron/src/main/mcp/tools/interactiveToolHandlers.ts:75-137` + `services/GitCommitService.ts:47-201`.
  - **El patrón:** el agente llama `apohara_commit_proposal({filesToStage, commitMessage, reasoning})` como MCP tool; Apohara renderea widget interactivo para aprobar/rechazar; `autoCommitEnabled` setting permite skip. **El prompt rules viven en la tool description**, no en el system prompt.
  - **Por qué:** los CLIs commitean directo y el user pierde control. Esto es el "approval workflow" visible de nimbalyst — el agente PROPONE, el user APRUEBA.
  - **Esfuerzo:** 3 días (MCP tool en `apohara-mcp-bridge` + git2 commit executor + React widget).
  - **Commit ejecutado:** `8f43be5` (8 tests).

- **T3.4 — gh CLI wrapping**
  - **Origen:** orca `src/main/github/client.ts:1-80+` con rate-limit guard.
  - **Por qué:** PR/Issue/Actions integration en vivo.
  - **Esfuerzo:** 3 días.
  - **Commit ejecutado:** `60f5e1e` (`gh` wrapper con rate-limit rolling 60s, 7 tests).

- **T3.3 — Auto-updater (electron-updater equivalent)**
  - **Origen:** orca `src/main/updater.ts:1-882`.
  - **Por qué:** updates automáticos via GitHub releases.
  - **Esfuerzo:** 3 días.
  - **Commit ejecutado:** `621f349` (semver compare + GH Releases API, 7 tests).

- **T3.5 — npx distribution**
  - **Origen:** vibe-kanban `npx-cli/src/{cli,download}.ts`.
  - **Por qué:** `npx apohara` install.
  - **Esfuerzo:** 2 días.
  - **Commit ejecutado:** `d9372eb` (vibe-kanban atomic upgrade, 5 tests).

### Outcome del Sprint 3

`npx apohara` instala (necesita GitHub Release real para funcionar end-to-end). GitHub PRs creados desde la UI (vía `gh` wrapper). Auto-update funcionando. Demo video factible.

**Tests:** 505 pass / 0 fail / 102 archivos / 7.4s (suite gateada: `tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/`).

**Pendientes manuales del usuario:**
- `git push origin feat/apohara-v1`.
- Para que `npx apohara` funcione real: GitHub Release con assets `apohara-desktop-<slug>` + sidecar `.sha256` por plataforma, y `npm publish` del paquete `npx-cli/`.

---

## Tareas del plan NO ejecutadas en Sprints 1-3

Las siguientes tareas del Tier 3 (catálogo completo) quedaron PROPUESTAS pero no entraron en
Sprints 1-3. Quedaron disponibles para un eventual Sprint 4+ (que NO se planificó en este pase).

| # | Feature | Origen | Esfuerzo | Por qué importa |
|---|---|---|---|---|
| T3.2 | Idempotency-Key + JSONL replay 72h | agentrail `src/task-event-store.ts:74,101` | 2 días | Reconnect lossless del UI tras crash |
| T3.6 | WSL handling | orca `src/main/wsl.ts:1-182` | 1 día | Windows users |
| T3.7 | EditorHost contract + useEditorLifecycle | nimbalyst `packages/extension-sdk/src/types/editor.ts` | 4 días | Foundation para Monaco/Markdown/CSV editors |
| T3.8 | Per-runner sandbox policy compiler | agentrail `src/runner-execution-policy.ts:227,309,348,450` | 3 días | Una policy -> Codex/Claude/Cursor flags |
| T3.9 | Continuation turns (live thread) | symphony §10.3, §16.5 | 2 días | Token-economy massive (un system prompt, N cheap continuations) |
| T3.10 | Reconciliation tick stall detector | symphony §8.5 + §16.3 | 2 días | Detecta agentes colgados y los reintenta |
| T3.11 | Acceptance Criteria dual-status | chorus `prisma/schema.prisma:242-266` | 2 días | Verification con devStatus + admin status |
| T3.12 | registerPermissionedTool (deny-by-non-registration) | chorus `src/mcp/tools/register-helpers.ts:26` | 1 día | MCP tools invisibles si falta perm |
| T3.13 | culture skills install pattern | culture `culture/cli/skills.py:151-224` | 2 días | `apohara skills install claude` deja SKILL.md correcto |
| T3.14 | `apohara learn <provider>` self-teaching | culture `learn_prompt.py:35-120` | 1 día | Prompt tailored para que el agente aprenda Apohara |
| T3.16 | parseWithFallback zod boundary | multica `packages/core/api/schema.ts` | 1 día | Apohara IPC TS<->Rust no rompe en version skew |
| T3.17 | OSC 998 command-state escape | nimbalyst `Terminal/TerminalPanel.tsx` | 1 día | Mostrar "agent ran X, exit 0" inline |
| T3.18 | Worktree status con git cherry (unique_commits_ahead) | nimbalyst `GitWorktreeService.ts` | 1 día | Mejor diff visibility |
| T3.19 | Per-worktree named locks | vibe-kanban `worktree_manager.rs:60-130` | 0.5 día | Race prevention multi-agent |
| T3.20 | Multi-tier prompt cache | claude-octopus `spawn.sh:94-262` | 1 día | Cache hits de Anthropic |

---

## Lo que NO robamos (decisión explícita)

| Lo qué | De dónde | Por qué no |
|---|---|---|
| Electron entero | orca + nimbalyst | Apohara es Tauri, 10x más liviano |
| PostgreSQL + pgvector + sqlc | multica + chorus | bun:sqlite + Rust SQLx es local-first correcto |
| Multi-tenant `companyUuid` | multica + chorus | Apohara es single-user-per-machine |
| OAuth flows, Stytch auth, JWT | nimbalyst + multica + chorus | Hard rule Apohara: CLI wrappers only |
| ElectricSQL collab | vibe-kanban (remote crate) | Heavy infra, no necesitamos cloud sync |
| iOS/Android mobile companion | nimbalyst + orca | Defer hasta v2 |
| PostHog telemetry | varios | Local-first, no spying |
| IRC server engine | culture | Wrong shape para orchestrator |
| GitHub-issue-centric lifecycle | agentrail | No queremos ser ticket-runner |
| Marketplace business model | nimbalyst | Defer |
| Plugins .opencode / .claude / .codex / .cursor / .factory bloat | claude-octopus | Multi-marketplace shipping no aplica |

---

## Items que el análisis explícitamente difirió a v1.1+ (10 ítems)

| Ítem | Origen |
|---|---|
| Cliente-daemon split | multica |
| WS hub dedupe + stampede control | multica |
| Two-transport heartbeat WS+HTTP | multica |
| Profile system multi-daemon | multica |
| Workspace GC tiers | multica |
| Embedded SSH server | vibe-kanban |
| SSH worker extension | symphony |
| Smart Router auto-invoke | claude-octopus |
| Reaction Engine state machine | claude-octopus |
| `/yolo` full-auto pipeline | Chorus |

---

## Resumen ejecutivo

- **Sprints planificados:** 3.
- **Sprints ejecutados:** 3 (todos cerrados sobre `feat/apohara-v1`).
- **Commits totales del plan:** 16 (4 en Sprint 1 + 5 en Sprint 2 + 7 en Sprint 3, incluyendo polish).
- **Tests acumulados al cierre:** 505 pass / 0 fail.
- **Sprint 4 NO planificado** en el transcript — los Sprints 1-3 cubrieron los hallazgos de mayor
  prioridad pero NO agotan los 194 hallazgos originales del análisis de los 10 reference repos.
  El análisis original estimaba ~25-30 sprints para incorporar todo.
