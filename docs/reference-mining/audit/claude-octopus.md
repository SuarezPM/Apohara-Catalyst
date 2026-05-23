# Audit: claude-octopus (17 hallazgos)

> Audit ejecutado 2026-05-22 sobre `feat/apohara-v1` HEAD.
> Cruzado contra el sprint plan `docs/superpowers/plans/2026-05-22-reference-mining-sprints.md` (Pablo promovió Smart Router + Reaction Engine a Apohara Ultimate; no son `RECHAZADO`).

## Resumen

| Status | Cantidad |
|---|---:|
| ✅ COMPLETO | 5 |
| 🟡 PARCIAL | 6 |
| ❌ NO IMPLEMENTADO | 6 |
| 🚫 RECHAZADO | 0 |
| ❓ AMBIGUO | 0 |
| **Total** | **17** |

## Hallazgos

### Hallazgo 1: Output Compressor + bin/octo-compress pipe
- **Origen claude-octopus**: `hooks/output-compressor.sh`, `bin/octo-compress`, `hooks/post-tool-dispatch.sh:43-50`.
- **Apohara actual**: `src/core/contextforge-client.ts`, `src/core/verification-mesh.ts:478-519`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: Apohara tiene un sidecar de compresión de _contexto_ (ContextForge HTTP `/tools/get_optimized_context`, line 41 `strategy: "apc_reuse" | "compress" | ...`) y compresión de file signatures vía indexer en verification-mesh (`buildCompressedContext`, líneas 417-438). NO existe compresión **inline en cada tool call** ni binario CLI tipo `octo-compress` pipeable; tampoco se emite ledger event `output.compressed` por tool-event. El spec lo difiere a v1.1 explícitamente (`§11`, "claude-octopus #1 — deferred v1.1").
- **Gap**: falta compresor inline tool-by-tool con auto-detección por content-type y CLI standalone pipeable; ledger event de compresión ausente.
- **Recomendación**: Para v1.0 dejar como está (ContextForge cubre el "ahorro de tokens" en agregado); para v1.1 implementar `apohara-compress` Bun binary + ledger event `output.compressed`.

### Hallazgo 2: Strategy Rotation (anti-loop) hook
- **Origen claude-octopus**: `hooks/strategy-rotation.sh`.
- **Apohara actual**: `crates/apohara-anti-thrash/src/lib.rs` (stub), `src/core/anti-thrash/strategyRotation.ts` (153 líneas, implementación funcional).
- **Status**: ✅ COMPLETO
- **Evidencia**: `FailureTracker` class en `strategyRotation.ts:47-153` mantiene contador per-tool (`bash_failures`, `edit_failures`, `write_failures`, `web_failures`) persistido a JSON via `atomicWriteFile`, threshold configurable (default 2), `recordFailure()` retorna `RotationAlert` con `additionalContext` injectable, `recordSuccess()` resetea contadores, `dispose()` limpia archivos al terminar tasks. El `composeRotationDirective` (linea 143-152) replica el mensaje "STRATEGY ROTATION ALERT" de octopus. Path-safety via `sanitizeTaskId` (linea 39-45) defiende contra `../` injection. El crate Rust homónimo es stub (`lib.rs`: solo `version()`); la TS es la implementación real.
- **Gap**: ninguno funcional.
- **Recomendación**: ninguna (completo).

### Hallazgo 3: Multi-tier statusline (Node HUD → bash+jq → pure bash)
- **Origen claude-octopus**: `hooks/octopus-statusline.sh`, `hooks/octopus-hud.mjs`.
- **Apohara actual**: `packages/desktop/src/components/TaskBoard/hooks/smart-attention.ts`, `packages/tui/components/Dashboard.tsx`.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: No hay `~/.apohara/runtime/statusline-${SESSION}.json` bridge file; no aparece "statusline", "bridge.json", "HUD" en ningún archivo TS/Rust de Apohara. Hay TaskBoard + dashboard pero NO contract de bridge file desacoplado entre proceso Bun core y desktop/TUI para coordinar warnings.
- **Gap**: bridge file pattern entre wrapper-CLI y UI no existe.
- **Recomendación**: para v1.0 no es crítico (Tauri es siempre Tauri); para v1.1 implementar bridge JSON en `~/.apohara/runtime/statusline-${SESSION}.json` como contract entre procesos.

### Hallazgo 4: Context-awareness percentage warnings con escalación
- **Origen claude-octopus**: `hooks/context-awareness.sh`.
- **Apohara actual**: `crates/apohara-attention/src/lib.rs`, `packages/desktop/src/components/TaskBoard/hooks/smart-attention.ts`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: Apohara tiene Smart Attention con 4 bandas (`Band::Hot/Warm/Cool/Idle`, `apohara-attention/src/lib.rs:13-22`) y 4 tiers de UI (`smart-attention.ts:22-29`). Tiene token-accounting per-thread (`crates/apohara-token-accounting`). Sin embargo, NO emite warnings escalonados por porcentaje (65%/75%/80%) ni mensajes phase-aware ("Research phase active — consider X"). Las bandas se basan en stimulus/decay temporal, no en context usage %.
- **Gap**: falta integración explícita context% → mensaje fase-específico con thresholds escalados.
- **Recomendación**: añadir reglas thresholds (65/75/80) a `apohara-attention` o crear `src/core/context/percentageWarnings.ts` que mapee `{phase, severity, remaining_pct}` → mensajes parametrizados.

### Hallazgo 5: Domain-specific quality gates por persona
- **Origen claude-octopus**: `hooks/architecture-gate.sh`, `security-gate.sh`, `perf-gate.sh`, `code-quality-gate.sh`, `frontend-gate.sh`, `sysadmin-safety-gate.sh`.
- **Apohara actual**: `src/core/verification/qualityGates/` (6 gates + types + index).
- **Status**: ✅ COMPLETO
- **Evidencia**: `qualityGates/index.ts:9-16` registra los 6 gates: `architectureGate`, `securityGate`, `perfGate`, `codeQualityGate`, `frontendGate`, `sysadminSafetyGate`. Cada uno implementa `QualityGate` interface (`types.ts:14-18`) con `appliesTo` (per-persona filter) + `evaluate` (return pass|block). `securityGate.ts:3` valida `2+ OWASP categories + severity + remediation`. `architectureGate.ts:9-14` exige `trade-off + alternatives considered`. `sysadminSafetyGate.ts:3-9` bloquea `rm -rf /`, `firewall disable`, `curl|sudo sh`, chmod 777, raw disk write. `runAllGates` (`index.ts:23-33`) ejecuta todos como pre-judge layer. Tests en `tests/core/verification/qualityGates/gates.test.ts` validan los 6.
- **Gap**: ninguno funcional.
- **Recomendación**: ninguna (completo).

### Hallazgo 6: Freeze Mode + Careful Mode (write-boundary enforcement)
- **Origen claude-octopus**: `hooks/freeze-check.sh`, `hooks/careful-check.sh`.
- **Apohara actual**: `src/core/safety/permissionService.ts`, `src/core/safety/runnerPolicy/presets.ts`, `crates/apohara-sandbox/src/permission.rs`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: Apohara tiene 3-tier permission hierarchy (`permissionService.ts:31-79`), runner policy presets `STRICT/BALANCED/PERMISSIVE` (`presets.ts:40-75`) con `protectedPaths`, `readonlyPaths`, `writableScope: "workspace"`. SandBox tiene `PermissionTier::ReadOnly/WorkspaceWrite/DangerFullAccess` (`permission.rs:10-23`). Esto cubre **boundaries estáticos**. NO existe `FREEZE_MODE` per-session dinámico (`apohara freeze <dir>` que escriba a sandbox state) ni `Careful mode` (asks vs blocks). Es complementario, no equivalente.
- **Gap**: falta CLI `apohara freeze`/`unfreeze` que tweak boundaries per-session sin tocar settings; falta variante "ask" (vs deny) para drift detection workflow.
- **Recomendación**: implementar `src/commands/freeze.ts` + sandbox state que el wrapper-CLI consulte antes de dispatch; añadir scope "ask" complementario al "block" actual en sysadmin-safety-gate.

### Hallazgo 7: TeammateIdle dispatch (queue-driven multi-agent)
- **Origen claude-octopus**: `hooks/teammate-idle-dispatch.sh`.
- **Apohara actual**: `src/core/dispatch/dispatcher.ts`, `src/core/dispatch/executor-action.ts`, `src/core/scheduler.ts`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: Apohara tiene `ExecutorAction` chain (`dispatcher.ts:32-37`, `executor-action.ts:actionChain`) que walks tasks sequentially con `priorResultAsContext` (linea 82-85) emitiendo continuation prompts. El `Reconciler` (`reconciler.ts:47-60`) detecta stalled tasks. Sin embargo, NO existe `TeammateIdle` hook event reactivo (Apohara hook events: `pre_tool_use`, `post_tool_use`, `stop`, `user_prompt_submit`, `permission_request` — `events.ts:15-21`, NO `teammate_idle`). El dispatcher es push-based (chain pre-construida), no pull-based reactivo a agent-idle.
- **Gap**: falta endpoint `next-task` consultado via MCP cuando agent finaliza turno, sin re-spawn; el spec lo difiere a v1.1 (`§11`, "claude-octopus #7 — pattern complementario al agent-hooks server actual").
- **Recomendación**: para v1.1 añadir `apohara://next-task` endpoint en Internal MCP + wrapper-CLI detection de output-stream-finalized para inyectar continuation.

### Hallazgo 8: Pre/PostCompact con snapshot+restore + workflow enforcement re-injection
- **Origen claude-octopus**: `hooks/pre-compact.sh`, `hooks/post-compact.sh`, `hooks/instructions-loaded.sh`.
- **Apohara actual**: `src/core/orchestration/preamble.ts`, `crates/apohara-hooks-server/src/lib.rs`, `src/core/hooks/events.ts`.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: Dispatch preamble existe (`preamble.ts:35-75` `buildDispatchPreamble`) con drift section, pero NO hay PreCompact/PostCompact hooks. `events.ts:15-21` enumera los hook kinds soportados: NO incluye `pre_compact` ni `post_compact`. `apohara-hooks-server/lib.rs:110-115` solo expone `/health` y `/event` — no `/snapshot/contract`. El spec lo describe en detalle como **ADOPTED §3.5.1** (líneas 802-886) con bash hooks de ejemplo y server-side endpoint, pero no está implementado. Tampoco hay `~/.apohara/snapshots/contract-<task>.json` ni TTL-aware re-injection.
- **Gap**: hook events PreCompact/PostCompact ausentes, server endpoint ausente, snapshot file ausente, tests `pre_compact_snapshot_persists` / `post_compact_reinjects_when_fresh` no existen.
- **Recomendación**: alta prioridad (es uno de los 20 patterns transversales del spec §11.20). Implementar PreCompact handler + snapshot endpoint en `apohara-hooks-server` + hook scripts en `scripts.ts`.

### Hallazgo 9: Cross-session learnings layer + auto-memory bridge
- **Origen claude-octopus**: `hooks/session-end.sh:79-130`, `hooks/session-start-memory.sh`.
- **Apohara actual**: `src/core/memory-injection.ts`, `src/core/indexer-client.ts`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: Apohara tiene memory injection via indexer semántico (`memory-injection.ts:91-103` `fetchAndFormatMemories` → `<apohara_memory>` XML block). Esto es **search-based** (top-K por similarity), NO markdown append cap-50-entries cross-session. NO existe `~/.apohara/projects/<hash>/learnings.md` con `{workflow, phase, agent_calls, errors, debate_used}` ni cap por bytes ni rotación 30d. No hay `SessionEnd` hook que serialize prefs/learnings ni `SessionStart` que reload.
- **Gap**: falta el patrón markdown-append liviano alternativo al indexer; spec lo adopta como `§7.5.2 complementa mistakes log`.
- **Recomendación**: implementar `src/core/persistence/learningsLog.ts` con append-prepend cap-50 + sidecar `apohara-learnings-extract` que corre al SessionEnd y emite top-5 insights desde ledger.

### Hallazgo 10: Provider-key isolation via per-worktree `.octopus-env` file
- **Origen claude-octopus**: `hooks/worktree-setup.sh`.
- **Apohara actual**: `src/core/persistence/envSanitizer.ts`, `crates/apohara-worktree/`, `src/providers/cli-driver.ts:31`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: Apohara sanitiza env por DEFAULT_BLOCKLIST (`envSanitizer.ts:13-86`) que bloquea 50+ patterns (`_API_KEY$`, `_TOKEN$`, `^ANTHROPIC_`, etc.) en cada spawn. El cli-driver llama `sanitizeEnv(process.env)` en cada call (`cli-driver.ts:31`). Atomic writes a 0o600 (`atomicWrite.ts:32`), audit logs a 0o600 (`auditLogger.ts:8`). Sin embargo, NO existe `.apohara-env` file **per-worktree** con umask 077, escrito por worktree setup hook. El approach es runtime-sanitize, no on-disk credential file. Hay `crates/apohara-worktree/src/uds.rs:42-50` que usa 0o600 para UDS pero es para socket, no env file.
- **Gap**: falta `.apohara-env` per-worktree (whitelist de bearer tokens MCP + provider keys explícitos) generado al `worktree_create`.
- **Recomendación**: añadir paso a `apohara-worktree` para escribir `.apohara-env` con umask 077 conteniendo bearer tokens MCP internos. Wrapper-CLI source-ea al spawn. Apohara ya tiene la pieza de blocklist; falta el bookkeeping per-worktree.

### Hallazgo 11: DONE Criteria heurística para compound tasks
- **Origen claude-octopus**: `hooks/done-criteria.sh`.
- **Apohara actual**: `src/core/decomposer.ts`, `src/core/decomposer/manifests.ts`.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `decomposer.ts:78` `decompose()` invoca LLM con prompt sistema (linea 85+) que pide breaking down en `tasks[]`. NO hay heurística regex pre-LLM que detecte compound (numbered lists, action+conjunctions, bullet lists) y genere `verification.criteria[]` por subtask. `verification-mesh.ts` no consume criterios per-subtask. El spec lo adopta en `§3.3 decomposer pre-split` pero no se implementó.
- **Gap**: pre-split heurística regex ausente; verification-mesh no exige evidence file por criterio.
- **Recomendación**: añadir `src/core/decomposer/compoundDetector.ts` con 3 patterns regex (numbered, verbs+conj, bullets); modificar `DecomposedTask` para incluir `verificationCriteria?: string[]`.

### Hallazgo 12: Smart Router con confidence (HIGH/LOW) + auto-invoke modes
- **Origen claude-octopus**: `hooks/user-prompt-submit.sh`, `hooks/auto-router-inject.sh`.
- **Apohara actual**: `src/core/agent-router.ts`, `crates/apohara-coordinator/src/`.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: `agent-router.ts` existe (búsqueda de archivos lo confirma) pero NO contiene `intent_classifier`, `auto_invoke`, `repeat_intent`, `smart_router`, `OCTOPUS_AUTO_ROUTER_MODE`, `difflib` ni equivalentes (`grep -li "smart.router\|intent_classif\|auto.*invoke\|repeat.*intent"` → 0 archivos). `apohara-coordinator/src/lib.rs` solo define conflict matrix + manifest + scheduler decision; no hay step "classify intent before decompose". Pablo confirmó que este item se **promueve a Apohara Ultimate** (no es RECHAZADO).
- **Gap**: classificador intent + auto-invoke mode + repeat-intent detection completo.
- **Recomendación**: implementar en `src/core/coordinator/intentClassifier.ts` con keyword tables HIGH/LOW + mode env (`APOHARA_AUTO_ROUTER_MODE=off|suggest|invoke`) + repeat-intent counter en orchestration DB. Ledger event `auto_routed=true` para auditability.

### Hallazgo 13: Reaction Engine (CI/PR lifecycle automation)
- **Origen claude-octopus**: `scripts/reactions.sh`, integrado en `/octo:parallel`, `/octo:sentinel`.
- **Apohara actual**: `packages/github-bridge/src/poller.ts`, `pr-builder.ts`, `webhook.ts`, `src/core/github/gh.ts`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: Github-bridge tiene PR builder (`pr-builder.ts:152-179` `createOrUpdatePR` con idempotency-key), poller polling-only (`poller.ts:44-` `pollOnce` con label filter), webhook stub que retorna 501 (per CLAUDE.md), y `gh.ts` wrapper con rate-limit. NO existe **state machine con 13 lifecycle states** (`running → pr_open → ci_pending → mergeable → merged`), NO existe `reactions.conf` (`grep -li "lifecycle_state\|ci_failed\|changes_requested\|reactions.conf"` → 0). NO hay tabla `agent_lifecycle_states` en orchestration DB. Pablo confirmó que este item se **promueve a Apohara Ultimate** (no es RECHAZADO).
- **Gap**: state machine 13 estados + retries+escalation + conf file + sidecar reactor.
- **Recomendación**: añadir crate `apohara-reactor` (poll-loop integrado al scheduler) + tabla `agent_lifecycle_states` en orchestration DB + parser `.apohara/reactions.conf` formato `EVENT|ACTION|MAX_RETRIES|ESCALATE_AFTER_MIN|ENABLED`.

### Hallazgo 14: MCP server con `octopus_set_editor_context` IDE injection
- **Origen claude-octopus**: `mcp-server/src/index.ts:53-58, 326-393`.
- **Apohara actual**: `src/core/mcp/servers/`, `src/core/mcp/base/McpServer.ts`, `src/core/mcp/base/inputValidation.ts`.
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: Apohara Internal MCP servers existen (`apohara-commit`, `apohara-indexer`, `apohara-ledger`, `apohara-runs`, `apohara-settings`) con bearer-token auth (`McpServer.ts:14-24` `bearerEquals` con `timingSafeEqual`). NO existe server `apohara://ide-context` ni tool `set_editor_context`. NO existe blocklist allowlist explícita de env vars que el MCP nunca forwarda. `inputValidation.ts:19-83` provee validators básicos (`requireString`, `optionalInteger`, etc.) pero no path-traversal explícito ni 50KB truncate.
- **Gap**: server completo ausente + blocklist env-vars + path-traversal validator + size limit.
- **Recomendación**: añadir `src/core/mcp/servers/apohara-ide-context.ts` con state mutable + bearer required + blocklist env vars sandbox-related; Tauri sidebar puede pushear editor state via MCP cada N seconds.

### Hallazgo 15: Managed-settings.d dynamic generation pattern
- **Origen claude-octopus**: `managed-settings.d/octopus-defaults.json`, `hooks/session-start-memory.sh:124-141`.
- **Apohara actual**: `src/core/safety/settingsHierarchy.ts` (sin generación dinámica).
- **Status**: ❌ NO IMPLEMENTADO
- **Evidencia**: Apohara settings tiene 3-tier hierarchy implementada (`src/core/safety/settingsHierarchy.ts`, confirmado por `permissionService.ts:28` `MergedSettings` import). Sin embargo, NO genera dinámicamente `~/.claude/managed-settings.d/apohara-defaults.json` al SessionStart (`grep -li "managedSettings\|managed-settings.d"` → 0 archivos). No hay SessionStart hook que escribe paths absolutos al primer arranque.
- **Gap**: writer dinámico al SessionStart ausente.
- **Recomendación**: añadir en `src/commands/init.ts` (o `setupVerification`) la escritura idempotente de `~/.claude/managed-settings.d/apohara-defaults.json` con `$HOME` expandido + re-write si cambia. Es el ítem más bajo de prioridad (BAJO-MEDIO en spec original).

### Hallazgo 16: Codex-exec-guard correctness hook
- **Origen claude-octopus**: `hooks/codex-exec-guard.sh`.
- **Apohara actual**: `src/providers/cli-driver.ts:114-127`, `src/core/providers/CodexProvider.ts`.
- **Status**: 🟡 PARCIAL
- **Evidencia**: El cli-driver YA invoca codex correctamente (`cli-driver.ts:114-127` `args: ({ prompt }) => ["exec", ...]`), evitando el TUI interactivo. PERO **NO existe `validate_command()` method per-provider** ni guard que bloquee agent-emitted invocaciones inválidas como `codex "prompt"` (sin `exec`) o `codex --skip-git-repo-check ...`. `BaseAgentProvider.ts:61` solo comenta "Apply trust preset BEFORE spawn" sin lista de pattern de invocaciones inválidas. El spec lo adopta como `§4.5 validate_command per provider` pero no se implementó como mecanismo defensivo cuando el agente compone el Bash.
- **Gap**: validator que ataje Bash compounds con `codex "..."` agent-emitted.
- **Recomendación**: añadir method `BaseAgentProvider.validateAgentInvocation(cmd: string): {valid, reason}` con pattern lists per-provider; invocar desde `permissionService` cuando Bash command empieza con `codex`/`claude`/`opencode`.

### Hallazgo 17: Per-job security gate con tool/path allowlist
- **Origen claude-octopus**: `hooks/scheduler-security-gate.sh`.
- **Apohara actual**: `crates/apohara-pathsafety/src/lib.rs`, `crates/apohara-sandbox/src/runner/imp.rs:136-162`.
- **Status**: ✅ COMPLETO
- **Evidencia**: `apohara-pathsafety/src/lib.rs:41-63` `validate_cwd` canonicaliza ambos paths (`canonicalize_recursive`) y verifica `canonical_ws.starts_with(&canonical_root)`; distingue **symlink escape** (`SymlinkEscape`, linea 52) vs **literal outside** (`EscapesRoot`, linea 57). `apohara-sandbox/src/runner/imp.rs:142-162` aplica el check ANTES del fork con error claro "workdir X escapes workspace_root Y". Tests en `crates/apohara-pathsafety/tests/symlink_escape.rs`. Esto cubre exactamente la threat "agent crea symlink que apunta a /etc/passwd para escape" mencionada en octopus.
- **Gap**: ninguno funcional (el TaskBoard `allowed_paths: Vec<PathBuf>` per-task aún no enriquece este check, pero la primitiva de canonicalización está sólida).
- **Recomendación**: ninguna (completo); seguimiento opcional: exponer `allowed_paths` per-task en TaskBoard que use la misma primitiva.

---

## Apéndice: cobertura del spec

El spec `2026-05-21-apohara-v1-design.md §12 Ronda 2` adopta 11 de los 17 hallazgos (#2, #5, #6, #8, #9, #10, #11, #14, #16, #17) más #1, #7, #12, #13 como diferidos a v1.1 (`§11`). Este audit confirma que de los **adoptados**, solo **#2, #5 y #17** están **completos**; **#6, #9, #10, #16** están parciales; **#8, #11, #14, #15** están NO implementados. Smart Router (#12) y Reaction Engine (#13) — promovidos a Apohara Ultimate por Pablo — están NO implementados y PARCIAL respectivamente.
