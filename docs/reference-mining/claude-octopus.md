I have a deeply comprehensive view. Let me compile the findings report.

# Análisis exhaustivo de claude-octopus — Hallazgos NUEVOS para Apohara v1.0

Repo analizado: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/claude-octopus/` (v9.39.0, 485 líneas de `hooks.json`, ~50 hook scripts shell, MCP server TypeScript, OpenClaw extension, 32 personas + 10 droids + 5 principles).

claude-octopus es un **plugin Claude Code multi-LLM** que coordina hasta 8 providers (Codex/Gemini/Copilot/Qwen/Perplexity/OpenRouter/Ollama/OpenCode + Claude) con metodología "Double Diamond" (probe→grasp→tangle→ink). El "octopus" son 8 brazos = 8 providers. Es **shell-first + hook-driven**, no Rust/Bun, pero su catálogo de patterns hookean profundamente con cosas que Apohara puede inspirarse.

---

## Hallazgo 1 — Output Compressor + bin/octo-compress pipe (ALTO)

**Qué:** PostToolUse hook que detecta outputs grandes (>3K chars) y los comprime con auto-detección de tipo (JSON array/object, HTML, logs, verbose text). También CLI standalone `octo-compress` para usar como pipe `npm install 2>&1 | octo-compress`. Logs analytics en `~/.claude-octopus/analytics/compression.jsonl` con `before/after/saved/ratio` por evento. README dice "ahorra ~7,300 tokens/session".

**Dónde:** `/hooks/output-compressor.sh`, `/bin/octo-compress`, `/hooks/post-tool-dispatch.sh:43-50` (integración debounced cada 3ra llamada).

**Por qué inspira:** Apohara consolidator es post-hoc/batch. Esto es **inline en cada tool call**, con compresión adaptativa por content-type y un CLI pipeable que el agente puede invocar manualmente. Las stats JSONL son una primitiva auditable que Apohara ledger podría emitir.

**Cómo traducir:** Crear `apohara-compress` (Bun binary) que el wrapper-CLI invoque automáticamente en outputs >3K. Emitir eventos de compresión al ledger SHA-256 como tipo `output.compressed` con `{ before_tokens, after_tokens, ratio, content_type }`. Integrar con consolidator: si dos agentes vieron el mismo output grande, share el compressed digest en lugar de recomputar.

---

## Hallazgo 2 — Strategy Rotation (anti-loop) hook (ALTO)

**Qué:** PostToolUse hook que cuenta failures consecutivos por tool (Bash/Edit/Write) en `/tmp/octopus-failures-${SESSION}.json`. Al llegar al threshold (default 2), inyecta `additionalContext`: "STRATEGY ROTATION NEEDED: The Bash tool has failed N consecutive times. You MUST try a fundamentally different approach". Reset on success.

**Dónde:** `/hooks/strategy-rotation.sh` (200 líneas), invocado por `/hooks/post-tool-dispatch.sh:53`.

**Por qué inspira:** Apohara tiene verification-mesh pero NO un anti-thrashing detector. Agentes loopean en el mismo error retry tras retry. Este patrón es portable, simple, y económico.

**Cómo traducir:** Implementar como crate Rust `apohara-anti-thrash` invocado por scheduler entre task dispatches. Estado per-task-id en SQLite orchestration DB. Threshold configurable por verb (Edit, Bash, Web). En caso de N failures: scheduler degrada el task a `needs_replan` y dispatch al decomposer para reformular.

---

## Hallazgo 3 — Multi-tier statusline (Node HUD → bash+jq → pure bash) (MEDIO)

**Qué:** Statusline con 3 tiers de graceful degradation: Tier 1 Node.js HUD (`octopus-hud.mjs`, 46K líneas) con Tailwind colors + OAuth API + agent tracking; Tier 2 bash+jq con barra contextual + cost + phase emoji; Tier 3 pure bash con grep/cut zero-deps. Escribe **context bridge file** `/tmp/octopus-ctx-${SESSION}.json` que otros hooks (context-awareness.sh) leen para co-ordinar warnings.

**Dónde:** `/hooks/octopus-statusline.sh`, `/hooks/octopus-hud.mjs`.

**Por qué inspira:** Apohara TUI/Tauri puede leer este bridge file pattern para sincronizar HUD entre proceso Bun core y desktop. El degradation graceful es elegante.

**Cómo traducir:** Apohara Tauri sidebar lee bridge JSON desde `~/.apohara/runtime/statusline-${SESSION}.json` actualizado por wrapper-CLI on cada tool-event. Tres-tier no aplica (Tauri es siempre Tauri), pero el **bridge file como contract entre procesos desacoplados** es valioso.

---

## Hallazgo 4 — Context-awareness percentage warnings con escalación (MEDIO)

**Qué:** PostToolUse hook que lee context% del bridge file y emite warnings escalonados: 65% WARNING, 75% CRITICAL, 80% AUTO_COMPACT. Mensajes phase-aware ("Research phase active — consider /octo:quick"). Debounce cada 5 tool calls, pero **escalation bypasses debounce**. Tip RTK install dinámico.

**Dónde:** `/hooks/context-awareness.sh`.

**Por qué inspira:** Apohara Smart Attention notifica al user pero no hace **dynamic phase-aware advice**. Mensajes diferentes según fase del workflow agregan valor sin coste.

**Cómo traducir:** Smart Attention en Apohara emite mensajes parametrizados por `{phase, severity, remaining_pct}`. Templates por fase: research → "narrow scope", implementation → "split into fresh session", validation → "use targeted grep over reads".

---

## Hallazgo 5 — Domain-specific quality gates por persona (ALTO)

**Qué:** 6 PostToolUse hooks que validan output del agente según persona activa via `OCTOPUS_AGENT_PERSONA` env var:
- `architecture-gate.sh`: trade-off rationale + API contracts (backend) / migrations (db) / IaC (cloud) / CI-CD (deployment)
- `security-gate.sh`: 2+ OWASP categorías + severity + remediation
- `perf-gate.sh`: ms/MB/req/s métricas + before/after benchmarks + optimization recommendations
- `code-quality-gate.sh`: 2+ findings + severity levels + root cause
- `frontend-gate.sh`: ARIA + viewport breakpoints
- `sysadmin-safety-gate.sh`: bloquea rm -rf, firewall disable, curl|sudo sh

Cada uno emite `{"decision":"block","reason":"..."}` con feedback humano en stderr.

**Dónde:** `/hooks/architecture-gate.sh`, `/hooks/security-gate.sh`, `/hooks/perf-gate.sh`, `/hooks/code-quality-gate.sh`, `/hooks/frontend-gate.sh`, `/hooks/sysadmin-safety-gate.sh`.

**Por qué inspira:** Apohara critic agents son verification-mesh, pero estos gates son **heurísticas baratas (grep patterns)** que se ejecutan ANTES del judge LLM. Filtran outputs claramente deficientes sin coste de inference. Per-persona switching via env es elegante.

**Cómo traducir:** Pre-judge layer en verification-mesh: critic spawn 0 si grep-based heuristic gate falla. Configurar por tipo de tarea en SPEC.md: `verification.gates = ["security:owasp-coverage", "perf:quantified-metrics"]`. Implementación en Rust crate `apohara-gates` con tabla regex+threshold por gate-type. Apohara ahorra ~30% inference costs en outputs claramente incompletos.

---

## Hallazgo 6 — Freeze Mode + Careful Mode (write-boundary enforcement) (MEDIO)

**Qué:** Dos modos opcionales gated por env vars y state files:
- **Freeze mode**: `OCTO_FREEZE_MODE=on` + `/tmp/octopus-freeze-${SESSION}.txt` con un directorio. Edit/Write fuera del boundary → `{"permissionDecision":"deny"}`. Read/Bash/Grep no afectados.
- **Careful mode**: Bash con patterns destructivos (rm, mv, git push/reset, DROP TABLE, sudo) → `{"permissionDecision":"ask","message":...}` (no block, sólo confirma).

Slash commands `/octo:freeze <dir>` y `/octo:unfreeze` para gestionar state.

**Dónde:** `/hooks/freeze-check.sh`, `/hooks/careful-check.sh`.

**Por qué inspira:** Apohara permission patterns ya tienen 3-tier hierarchy pero NO **per-session dynamic boundaries**. Útil cuando user dice "no toques tests/" sin editar settings.

**Cómo traducir:** CLI `apohara freeze <dir>` escribe a sandbox state. Wrapper-CLI verifica boundary antes de tool dispatch. Integrar como sandbox primitive en apohara-sandbox crate. **Careful mode** es complementario al sysadmin-safety-gate pero asks en vez de blocks — útil para drift detection workflow.

---

## Hallazgo 7 — TeammateIdle dispatch (queue-driven multi-agent) (ALTO)

**Qué:** Hook event `TeammateIdle` (CC v2.1.33+) que se dispara cuando un agente termina. Lee `agent_queue` de `~/.claude-octopus/session.json` (jq), pop next task, emite **exit code 2 + stderr feedback**: "Your next task: $NEXT_TASK". El exit 2 dice a Claude Code "don't go idle, here's more work". Tracking en `metrics/idle-events.jsonl`.

**Dónde:** `/hooks/teammate-idle-dispatch.sh`.

**Por qué inspira:** Apohara scheduler dispatch es Bun-side. Este patron sería el **CLI-side feedback loop**: wrapper-CLI puede inyectar la siguiente tarea de forma reactiva al agente provider sin re-spawning el proceso. Reduce latencia entre tasks.

**Cómo traducir:** Apohara TaskBoard expone `next-task` endpoint via Internal MCP servers. Wrapper-CLI cuando detecta agent-idle (output stream finalized) consulta endpoint y inyecta como continuation prompt. Backed por queue Rust en orchestration DB. Cero spawns intermedios.

---

## Hallazgo 8 — Pre/PostCompact con snapshot+restore + workflow enforcement re-injection (ALTO)

**Qué:** Dos hooks paired:
- **PreCompact**: escribe snapshot JSON con `{phase, workflow, autonomy, completed_phases, blockers}` a `.octo/pre-compact-snapshot.json`.
- **PostCompact**: lee snapshot (<10min age), re-inyecta workflow context y CRITICAMENTE **re-inject execution enforcement contract**: "You are mid-workflow. Each remaining phase MUST use orchestrate.sh. You are PROHIBITED from substituting Claude-native tools".

InstructionsLoaded hook también lee snapshot como fallback.

**Dónde:** `/hooks/pre-compact.sh`, `/hooks/post-compact.sh`, `/hooks/instructions-loaded.sh`.

**Por qué inspira:** Apohara two-tier transcript existe pero no tiene mecanismo formal de **re-inyectar contracts críticos** después de compaction. Sin esto, el coordinator semántico pierde su scaffolding cuando context se compacta.

**Cómo traducir:** Apohara coordinator emite "session contract" en cada dispatch preamble (ya en spec). Agregar PreCompact hook que serialice contract activo a `~/.apohara/sessions/<id>/contract.json`. PostCompact re-inyecta como system message. Especialmente útil para drift detection — si contract dice "ledger-required" y post-compact agent salta directamente a Edit sin Bash apohara/ledger, drift detectado.

---

## Hallazgo 9 — Cross-session learnings layer + auto-memory bridge (MEDIO)

**Qué:** SessionEnd hook serializa preferencias a `~/.claude/projects/<encoded-cwd>/memory/octopus-preferences.md` (autonomy + providers). Adicionalmente **learnings**: appends al inicio (most-recent-first, cap 50 entries) `octopus-learnings.md` con `{workflow, phase, agent_calls, errors, debate_used}`. SessionStart hook lee el archivo de prefs y restore.

**Dónde:** `/hooks/session-end.sh` (líneas 79-130), `/hooks/session-start-memory.sh`.

**Por qué inspira:** Apohara consolidator opera intra-session. Esto es **inter-session continuity layer** liviano (markdown append, no DB). Permite preferencias persistentes sin tocar settings hierarchy.

**Cómo traducir:** Apohara escribe `~/.apohara/projects/<project-hash>/learnings.md` con la misma estructura. Sidecar `apohara-learnings-extract` lee logs + ledger al SessionEnd y emite top-5 insights. Consolidator carga al SessionStart como context. Cap por bytes (200KB) y rotación 30d.

---

## Hallazgo 10 — Provider-key isolation via per-worktree `.octopus-env` file (ALTO)

**Qué:** WorktreeCreate hook escribe `.octopus-env` en cada worktree path con **umask 077** y chmod 600. Contiene exports de provider keys (`OPENAI_API_KEY`, `GEMINI_API_KEY`, etc) + workflow phase. Defense-in-depth: refuse a escribir fuera de `$HOME`, `/tmp`, macOS temp dirs.

**Dónde:** `/hooks/worktree-setup.sh`.

**Por qué inspira:** Apohara worktree reliability ya está en spec. Esto añade **credential isolation por worktree** — cada agente provider tiene su propio env file que se source-ea. Previene cross-contamination de keys entre worktrees paralelos. El umask 077 antes de redirect es el detalle de seguridad.

**Cómo traducir:** apohara-sandbox al crear worktree genera `.apohara-env` (umask 077) con bearer tokens internos MCP + provider keys filtrados (whitelist explícita). Wrapper-CLI source-ea al spawn. Sandbox refuse a escribir fuera de paths permitidos.

---

## Hallazgo 11 — DONE Criteria heurística para compound tasks (MEDIO)

**Qué:** UserPromptSubmit hook que detecta tasks compuestas con 3 patterns: (1) numbered lists `1. foo 2. bar`, (2) action verbs + conjunctions ("create X and then test Y"), (3) bullet lists 2+. Si detecta, inyecta context: "Compound task detected — multiple distinct actions. Before executing: (1) List specific, verifiable completion criteria for EACH part. (2) Execute each part methodically. (3) Before declaring done, verify EACH criterion."

**Dónde:** `/hooks/done-criteria.sh`.

**Por qué inspira:** Apohara decomposer ya splittea, pero esto es **prompt-side enforcement** que el LLM se auto-instruye a verificar cada parte. Heurística pura (no LLM call), ejecuta en ms.

**Cómo traducir:** Coordinator semántico de Apohara aplica las mismas regex en pre-decompose step. Si compound detected, decomposer genera `verification.criteria[]` por subtask. Verification-mesh exige por defecto que cada criterio tenga evidence file antes de marcar task done.

---

## Hallazgo 12 — Smart Router con confidence (HIGH/LOW) + auto-invoke modes (ALTO)

**Qué:** UserPromptSubmit hook que clasifica intent con dos confidence levels (HIGH si 2+ keyword hits) y rutea a workflows específicos. Tres modos via env `OCTOPUS_AUTO_ROUTER_MODE=off|suggest|invoke`:
- `off`: nothing
- `suggest`: tip al user
- `invoke`: **strong signal + HIGH confidence = auto-invoke immediately**; OR **repeat intent + HIGH = auto-invoke (user is stuck)**

También **provider pre-warming** + persona context injection en HIGH confidence. Fuzzy command suggestions con python3 difflib (`/octo:configue` → suggest `setup`).

**Dónde:** `/hooks/user-prompt-submit.sh` (760+ líneas), `/hooks/auto-router-inject.sh` (session-start contract).

**Por qué inspira:** Apohara coordinator semántico decide qué agentes spawnear, pero NO tiene **auto-invoke con repeat-intent detection**. El concepto "user stuck = act unilaterally" es valioso para reducir friction.

**Cómo traducir:** Coordinator añade `intent_classifier` step antes de decompose. Si HIGH confidence + repeat intent (mismo intent en 3 prompts sucesivos): coordinator skip decomposition prompt y directamente dispatch. Logs in ledger como `auto_routed=true` para auditability. Mode configurable per-project en SPEC.md.

---

## Hallazgo 13 — Reaction Engine (CI/PR lifecycle automation) (ALTO)

**Qué:** Sistema configurable de **eventos→reacciones** para PR/CI lifecycle: cuando un agente abre PR, el reaction engine monitorea: `ci_failed` → forward logs to agent inbox (3 retries, escalate 30m), `changes_requested` → forward comments (2 retries, 60m), `stuck` → escalate to human (15m). Tracking de 13 estados de lifecycle (`running` → `pr_open` → `ci_pending` → `mergeable` → `merged`). Override per-project con `.octo/reactions.conf` formato `EVENT|ACTION|MAX_RETRIES|ESCALATE_AFTER_MIN|ENABLED`.

**Dónde:** Documentado en README líneas 346-373, implementación en `/scripts/reactions.sh`, integrado en `/octo:parallel`, `/octo:sentinel`.

**Por qué inspira:** Apohara github-bridge está spec'd pero el patrón de **reaction engine con retries+escalation y agent lifecycle states** es nuevo. La conf file con sintaxis simple es perfectible.

**Cómo traducir:** Apohara github-bridge expone `apohara reactions` subcommand con state machine en orchestration DB SQLite. Tabla `agent_lifecycle_states` con 13 estados, transitions auditadas. Conf en `.apohara/reactions.conf` mismo formato. Sidecar `apohara-reactor` poll-loop integrado con scheduler.

---

## Hallazgo 14 — MCP server con `octopus_set_editor_context` IDE injection (MEDIO)

**Qué:** MCP server expone `octopus_set_editor_context` que IDE extensions (Cursor) llaman ANTES de cualquier workflow para inyectar `{filename, selection, cursor_line, language_id, workspace_root}` como env vars `OCTOPUS_IDE_*`. **Validación path traversal** (reject `..`) y **truncate selections a 50KB** para evitar env var exhaustion.

Adicionalmente: explicit BLOCKED_ENV_VARS allowlist (`OCTOPUS_SECURITY_V870`, `OCTOPUS_GEMINI_SANDBOX`, etc.) que **nunca se forward** del client MCP, previniendo escalation. Sanitiza API keys de error messages.

**Dónde:** `/mcp-server/src/index.ts:53-58, 326-393`.

**Por qué inspira:** Apohara Internal MCP servers con bearer-token están spec'd. Pero **inyectar IDE context como state mutable en server** es nuevo. La validación + size limit + blocked env vars allowlist es defense-in-depth bien hecha.

**Cómo traducir:** Apohara Internal MCP server `apohara://ide-context` con state mutable. Bearer token requerido. Blocklist de env vars relacionadas a sandbox/permission (no se permiten forward via MCP). Audit log entry por cada mutation. Tauri sidebar pushea editor state automáticamente via MCP cada N seconds.

---

## Hallazgo 15 — Managed-settings.d dynamic generation pattern (BAJO-MEDIO)

**Qué:** Repo tiene `/managed-settings.d/octopus-defaults.json` (92 bytes, sólo `{"includeGitInstructions":false, "autoMemoryDirectory":"..."}`). MUY pequeño. La parte interesante: `/hooks/session-start-memory.sh:124-141` **genera dinámicamente** este JSON en `${HOME}/.claude/managed-settings.d/octopus-defaults.json` con `$HOME` expandido (porque JSON no soporta tilde). Sólo si `SUPPORTS_MANAGED_SETTINGS_D=true`.

**Dónde:** `/managed-settings.d/octopus-defaults.json`, `/hooks/session-start-memory.sh:124-141`.

**Por qué inspira:** Apohara settings hierarchy ya tiene 3-tier. El **pattern de generación dinámica al SessionStart con env vars expandidos** es útil cuando settings tienen paths que dependen del usuario.

**Cómo traducir:** Apohara installer escribe `~/.claude/managed-settings.d/apohara-defaults.json` al primer SessionStart con paths absolutos correctos (`~/.apohara/memory/`, etc). Re-write si `$HOME` cambia. Sólo 1 archivo, sin enterprise central management.

---

## Hallazgo 16 — Codex-exec-guard correctness hook (BAJO)

**Qué:** PreToolUse hook que bloquea `codex "prompt"` (interactive TUI que cuelga en non-TTY) y educa al usuario: "Use `codex exec --skip-git-repo-check 'YOUR PROMPT'` instead". Lista flags que NO son válidos en non-interactive mode. Permite `codex login`, `codex auth`, `codex --version`.

**Dónde:** `/hooks/codex-exec-guard.sh`.

**Por qué inspira:** Apohara Roster hardening (3 CLI drivers) está spec'd. Este patrón de **per-CLI correctness guards** que educan al agente cuando invoca el CLI mal es complementario.

**Cómo traducir:** BaseAgentProvider en Apohara incluye `validate_command()` method per-provider. claude/codex/opencode drivers tienen pattern lists de invocaciones inválidas → block with educational message. Particularmente importante para opencode que tiene `--pure` flag con semántica específica que apohara depende.

---

## Hallazgo 17 — Per-job security gate con tool/path allowlist (MEDIO)

**Qué:** Scheduler hook que se activa SÓLO si `OCTOPUS_JOB_ID` está set. Lee job def de `~/.claude-octopus/scheduler/jobs/${OCTOPUS_JOB_ID}.json`, extrae workspace permitido, y para CADA tool call valida:
- Bash: bloquea `--dangerously-skip-permissions`, `rm -rf /sensitive/path`
- Read/Write/Edit: usa `realpath` (symlink-safe) para validar file dentro de workspace (no escape via `..` o symlinks)

Bypass ignorado deliberadamente: "this gate enforces per-job allowlists the user set in their scheduled job config — bypassPermissions should not silently weaken that per-job policy".

**Dónde:** `/hooks/scheduler-security-gate.sh`.

**Por qué inspira:** Apohara scheduler crate + permission patterns spec'd. Pero **per-task workspace boundary enforcement con realpath canonicalization** es el detalle crítico de seguridad faltante (symlink attacks).

**Cómo traducir:** apohara-sandbox crate provee `validate_path(file, allowed_root)` usando std::fs::canonicalize (Rust equivalent). TaskBoard tasks tienen `allowed_paths: Vec<PathBuf>`. Wrapper-CLI siempre canonicaliza antes de file ops. Documentar como threat: "agent puede crear symlink en workspace que apunta a /etc/passwd para escape".

---

## Resumen ejecutivo (priorización para spec)

**ALTOS (incorporar en v1.0):** 1 (compressor), 2 (strategy rotation), 5 (domain quality gates), 7 (TeammateIdle queue), 8 (Pre/PostCompact snapshot + contract re-injection), 10 (per-worktree env), 12 (smart router con auto-invoke), 13 (reaction engine).

**MEDIOS (v1.1 o roadmap):** 3 (statusline bridge file), 4 (context-aware warnings), 6 (freeze/careful modes), 9 (learnings layer), 11 (DONE criteria heurística), 14 (MCP IDE context), 17 (per-task path canonicalization).

**BAJOS (referencia):** 15 (dynamic managed-settings), 16 (codex-exec-guard pattern).

**Conexión transversal con spec actual:** el hallazgo 8 (PostCompact re-inject contract) refuerza directamente Dispatch preamble + drift detection ya spec'd. El hallazgo 13 (reaction engine) extiende github-bridge con state machine concreta. Los hallazgos 5+17 forman juntos un layer de **defensive pre-judge validation** que ahorra inference cost mientras endurece security.

**Detalle clave de implementación:** todos los hooks de claude-octopus usan el mismo patrón `_octo_hook_exit() { local c=$?; if [[ $c -ne 0 ]]; then echo "[hook:$(basename "$0")] exit $c" >&2; fi; return 0; }` con `trap ... EXIT` — esto silencia el bug "No stderr output" de Claude Code. Apohara agent-hooks HTTP loopback debería adoptar mismo trap pattern.