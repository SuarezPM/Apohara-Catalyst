> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

# Apohara v1.0 — Design Spec

> **Status:** approved (2026-05-21) — pending writing-plans
> **Author:** Pablo M. Suarez (`@SuarezPM`)
> **Brainstorming session:** 2026-05-21
> **Target release:** v1.0.0
> **Scope:** Apohara orchestrator (`SuarezPM/Apohara`) + Phase 6 release engineering. NOT Apohara ecosystem repos (aegis/probant/consilium) and NOT ContextForge v7.0.0 (independent roadmap).

---

## Table of contents

- [§0 Disciplinas transversales](#0-disciplinas-transversales)
- [§1 North star + 20 acceptance criteria](#1-north-star--20-acceptance-criteria)
- [§2 Arquitectura global](#2-arquitectura-global)
- [§3 Coordinator semántico](#3-coordinator-semántico)
  - [§3.1 `apohara-worktree` crate](#31-apohara-worktree-crate-rename--expand)
  - [§3.2 `apohara-coordinator` crate](#32-apohara-coordinator-crate-slim)
  - [§3.3 Cambios al decomposer](#33-cambios-al-decomposer)
  - [§3.4 Cambios al scheduler](#34-cambios-al-scheduler)
  - [§3.5 Agent-hooks HTTP server](#35-agent-hooks-http-loopback-server)
  - [§3.6 Orchestration DB](#36-orchestration-db)
  - [§3.7 Riesgos del coordinator](#37-riesgos-del-coordinator)
- [§4 TaskBoard kanban view](#4-taskboard-kanban-view)
- [§4.5 Provider architecture refactor](#45-provider-architecture-refactor)
- [§4.6 Permission system](#46-permission-system)
- [§5 `github-bridge` package](#5-github-bridge-package-poll-only)
- [§6 SPEC.md parser + roster hardening](#6-specmd-parser--roster-hardening)
- [§6.5 Internal MCP servers](#65-internal-mcp-servers)
- [§7 Integration test suite](#7-integration-test-suite)
- [§7.5 DevEx hardening](#75-devex-hardening)
- [§8 Release (Phase 6)](#8-release-phase-6)
- [§9 Dependencias y orden de ejecución](#9-dependencias-y-orden-de-ejecución)
- [§10 Riesgos](#10-riesgos)
- [§11 Out of scope explícito](#11-out-of-scope-explícito)

---

## §0 Disciplinas transversales

No son features — son reglas de implementación que aplican a TODO el spec. Adoptadas de los rules de nimbalyst (desarrolladas por incidentes reales documentados). Las separo upfront porque las secciones siguientes las asumen.

### §0.1 IPC listener centralization

**Regla:** componentes React NUNCA suscriben a Tauri events directly. Listeners centralizados en `src/store/listeners/*.ts` se suscriben UNA vez al boot, actualizan atoms (Jotai/Zustand), components leen vía `useAtomValue()`.

**Por qué:** sin esto, `MaxListenersExceededWarning`, race conditions on pane switch, stale closures, double-fire on mount/unmount. Bug documentado en nimbalyst sesión `702519e3`.

**Aplica a:** todos los eventos `apohara://run-started`, `apohara://task-completed`, `apohara://verifier-conflict`, `apohara://ledger-event`, `apohara://hook-event`, `apohara://plan-changed`, etc.

### §0.2 Persisted state defaults pattern

**Regla:** toda interfaz persistida tiene un `createDefault*()` que enumera TODOS los field defaults; toda lectura usa `??` para mergear con loaded data. Anti-patterns prohibidos: `loaded.field` directo, `{ ...loaded }` sin merge.

**Por qué:** user actualiza Apohara, settings.json viejo no tiene `newField` añadido en esta versión, crash on load.

**Aplica a:** Tauri-store settings, capability-manifest (Thompson Sampling stats), roster config, plan documents frontmatter, agent status persistence, orchestration DB row defaults.

### §0.3 Fail-fast error handling doctrine

**Regla:** never log-and-continue para required params. Never fallback a defaults que enmascaren routing bugs. Always usar stable identifiers (workspace paths, run ids — NUNCA "current run" cacheado). Validate at boundaries.

**Cita de nimbalyst:** *"If you're adding code to handle missing required data, you're probably hiding a bug."*

**Aplica a:** todos los Tauri `#[command]`, todas las funciones del `src/core/`, todos los métodos `pub` de los crates Rust.

### §0.4 Env sanitization en spawn de subprocesos

**Regla:** TODA llamada a `tauri-plugin-shell::spawn` o `child_process.spawn` parte de un env **sanitizado**. Blocklist exhaustiva implementada en `src/core/providers/streams/envSanitizer.ts`:

```ts
const BLOCKLIST = [
  /^.*_API_KEY$/, /^.*_TOKEN$/, /^.*_SECRET$/, /^.*_PASSWORD$/,
  /^ANTHROPIC_/, /^OPENAI_/, /^GROQ_/, /^TOGETHER_/, /^MISTRAL_/, /^OPENROUTER_/,
  /^AWS_/, /^GOOGLE_APPLICATION_CREDENTIALS$/, /^GCP_/, /^AZURE_/,
];
```

**Por qué:** incidente real en nimbalyst — user tenía `ANTHROPIC_API_KEY` en `.env` para otro proyecto, Nimbalyst lo recogió por `process.env`, billing $100+ a la cuenta personal en lugar de la subscripción. Pablo dijo "CLI wrappers, no API keys, PUNTO" — la sanitización refuerza la intención.

**Aplica a:** `apohara-sandbox` (Rust), `tauri-plugin-shell` calls desde TS, scripts en `scripts/`, todos los `Bun.spawn` en `BaseAgentProvider`.

### §0.5 End-to-end verification rule

**Regla:** para cualquier bug cuya verificación requiere un restart de Apohara o exercise manual de un UI flow, el **PRIMER** deliverable es un test failing que el fix tiene que hacer pasar. No "fixed" claims sin haber observado red→green personalmente.

**Por qué:** nimbalyst documentó el workstream tracker-body donde agentes anunciaron "fixed" 4 veces seguidas. Cada anuncio basado en "el code path se ve bien" o "tests pasan", ninguno equivalente a "el user puede abrir el tracker y ver el body".

**Aplica a:** verification-mesh (judge no aprueba sin test que flippa), capability-manifest update on task complete (verificar realmente desde ledger antes de bumpear), todos los fixes del propio Apohara durante v1.0 dev.

### §0.6 `runId` / `workspacePath` como parámetro requerido en todo IPC

**Regla:** todo Tauri command que opera sobre un run, task, o worktree DEBE recibir `runId` o `workspacePath` explícito. Rust services NUNCA cachean "currentRun" — el caller siempre pasa.

**Por qué:** Apohara va a tener N runs concurrentes en N panes/ventanas Tauri. Sin esto: cross-pane pollution, last-write-wins entre windows, "el run apareció en el pane equivocado".

### §0.7 `ts-rs` Single Source of Truth Rust↔TS

**Regla:** todo tipo compartido Rust↔TS se define UNA vez en Rust con `#[derive(TS)]`. Binario `generate_types` emite `packages/apohara-shared/types.ts`. CI verifica con `generate-types:check` que no haya drift; pre-commit hook regenera. Nunca editar `types.ts` a mano.

**Por qué:** Apohara tiene Rust crates + TS Bun runtime + Tauri bridge. Sin SSoT, cada refactor desincroniza tipos y rompe contracts silenciosamente. (Adoptado de vibe-kanban).

### §0.8 Atomic file write `mkstemp + os.replace` invariant proyecto-wide

**Regla:** TODA escritura a archivo de config / state / ledger checkpoint usa `tempfile::NamedTempFile::persist()` (Rust) o `await Bun.write(tmp); await fs.rename(tmp, dst)` (TS). Wrap con try/catch que `unlink` el tmp en error.

**Por qué:** Crash entre `open` y `close` deja el archivo truncado. Usuario reopens Apohara y crash on load. (Pattern aplicado verbatim en culture). Aplica a `apohara.yaml`, `capability-manifest.yaml`, `agent-mistakes.md`, ledger checkpoints, plan documents.

### §0.9 stdout/stderr contract estricto + `--json` mode

**Regla:** results a stdout, diagnostics/errors a stderr, NUNCA se mezclan. JSON mode propaga la misma separación: `emitResult()` JSON a stdout, `emitError({code, message, remediation})` JSON a stderr. Argparse override garantiza que incluso errores de parsing emitan el shape correcto. Catch unhandled rejections → JSON shape en `--json` mode.

**Por qué:** Apohara CLI tiene que ser parseable por otros LLMs (Apohara como tool de otro agente). Cualquier ruido en stdout rompe parsing. 3 funciones (`emitResult`, `emitError`, `emitDiagnostic`), 3 exit codes (`EXIT_SUCCESS=0, EXIT_USER_ERROR=1, EXIT_ENV_ERROR=2`). (Pattern de culture #15).

### §0.10 OS-native credential store wrapping

**Regla:** todo bearer token / secret / password se guarda en OS-native store via `keyring-rs`. NO en archivos planos, NO en env vars persistentes. Servicio name: `"apohara"`, scope key: `"apohara-<purpose>-<id>"`. En Linux: pipe password vía stdin (NO argv → no expuesto en `ps`).

**Por qué:** internal MCP server bearer tokens, GitHub App private key path, ContextForge sidecar key, etc. todos necesitan storage seguro sin reinventar. (Pattern de culture #5).

### §0.11 Versioned Config Schema con migration chain

**Regla:** todo file de config evoluciona via versioning explícito. `crates/apohara-config/src/versions/{v1,v2,...}.rs` con structs separadas por version. `mod.rs` define `pub type Config = versions::vN::Config` y `From<String> for Config` que itera versions desde más viejo hasta v actual. Cada version conserva fields antiguos como `#[serde(alias = "...")]` y agrega defaults via `#[serde(default = "fn")]`.

**Por qué:** sin versioning, cada release rompe configs existentes. (Pattern de vibe-kanban #10 con v1→v8 migration chain real).

### §0.12 `spawn_blocking` para libgit2 + tree-sitter

**Regla:** TODA call a `git2::*` (libgit2) o `tree_sitter::*` se envuelve en `tokio::task::spawn_blocking(move || { ... }).await?`. Libera el reactor Tokio durante operaciones largas (clone, fetch, prune, parse de archivos grandes).

**Por qué:** bloquear el reactor mata concurrency. Apohara va a hacer mucho git via `apohara-worktree` y mucho tree-sitter via `apohara-indexer`. (Pattern de vibe-kanban #20).

### §0.13 Line-based protocol sanitization

**Regla:** cualquier string que vaya a un protocolo line-based (logs JSONL, audit log, websocket frames, IRC-style buses) pasa por `sanitize(s) -> [ch for ch in s if 0x20 <= ord(ch) < 0x7F]`. CR/LF stripping + control char rejection.

**Por qué:** evita command injection en line-based protocols + log line corruption. (Pattern de culture #14 + nimbalyst's `_sanitize_for_irc`).

### §0.14 Token accounting absolutes > deltas + per-thread keying

**Regla:** preferir absolute totals (`thread/tokenUsage/updated.tokenUsage.total`), IGNORAR deltas (`tokenUsage.last`). NUNCA mezclar generic `params.usage` con cumulative thread totals — clasificar por event type, no por field name. Key totals por `thread_id`, no por `task_id`. Tracker como high-water mark: solo update si `new_total >= stored_total`. `model_context_window` reportado separado de "spend" (no es counter de uso).

**Por qué:** sin esto, ledger entries con token counts duplicados 3x-4x. (Pattern de symphony #11 con doc dedicado `token_accounting.md`).

### §0.15 AsyncLocalStorage per-request context

**Regla:** envolver cada API handler / dispatch / orchestration con `AsyncLocalStorage.run({dispatchId, sessionId, logger: childLogger}, async () => {...})`. Helpers como `getRequestLogger()` leen del contexto sin pasar el logger como parámetro.

**Por qué:** Apohara va a tener flujos concurrentes (decomposer, scheduler, ledger writer). Sin ALS, hay que pasar `logger` por todo el call stack — verbose y propenso a olvidos. Bun tiene `AsyncLocalStorage` (compat Node). Rust equivalent: `tracing::Span` + `tracing::instrument`. (Pattern de Chorus #12).

### §0.16 `enum_dispatch` para Provider polymorphism sin `Box<dyn>`

**Regla:** providers, agents, executors usan `#[enum_dispatch] pub enum Provider { Claude(ClaudeProvider), Codex(CodexProvider), OpenCode(OpenCodeProvider) }` + `#[enum_dispatch(Provider)] pub trait ProviderExecutor { fn spawn(...); fn parse_output(...); fn capabilities() -> Vec<Capability> }`. Más rápido que `Box<dyn ProviderExecutor>`, type-safe, exhaustive match enforced.

**Por qué:** evita allocations + permite pattern matching exhaustivo. (Pattern de vibe-kanban #15 + #16).

### §0.17 AGENTS.md scoped por crate + symlink CLAUDE.md→AGENTS.md

**Regla:** root `AGENTS.md` es navegación concisa (~60 líneas) con build/test commands + module map + links a crate-specific AGENTS.md. Cada crate clave (`crates/apohara-coordinator/`, `crates/apohara-sandbox/`, `crates/apohara-indexer/`, `packages/apohara-ui/`) tiene su propio `AGENTS.md` con guidance específica. Symlink `CLAUDE.md → AGENTS.md` así Claude Code lo encuentra automáticamente.

**Por qué:** root AGENTS.md = navegación, crate AGENTS.md = guidance específica. Es lo que mantiene a Claude en context sin alucinar paths. (Pattern de vibe-kanban #11).

### §0.18 Hook output JSON con `additionalContext` + `systemMessage`

**Regla:** todo hook script de Apohara (agent-hooks, lifecycle, permission) puede devolver JSON con dos campos: `systemMessage` (visible al user) y `hookSpecificOutput.additionalContext` (inyectado al contexto del LLM). Permite que hooks actualicen system context del agent en tiempo real, no solo al inicio.

**Por qué:** dispatch preamble + drift detection ya existen, esto agrega canal adicional para reminders periódicos ("te quedan 3 min", "ledger detectó conflicto en archivo X"). (Pattern de Chorus #8 + claude-octopus).

### §0.19 Approvals como `Shared<BoxFuture>` con timeout + waiters compartidos

**Regla:** approvals/permissions usan `DashMap<id, PendingApproval>` + `oneshot::Sender<ApprovalOutcome>` por request. Returns `Shared<BoxFuture<ApprovalOutcome>>` que múltiples consumers pueden `await` en paralelo (coordinator + UI). Trait `ExecutorApprovalService` para abstraer backend (real vs Noop para testing).

**Por qué:** patron elegante: coordinator puede `.await` la decisión mientras la UI también espera, todos del mismo source. Timeout configurable por tipo de operación. Mockeable en tests. (Pattern de vibe-kanban #8).

### §0.20 Cross-platform service installer

**Regla:** módulo único que genera service files apropiados para cada plataforma: systemd user unit (Linux), launchd plist (macOS), batch script + schtasks (Windows). Dispatch via `_PLATFORM_INSTALLERS = {"linux": ..., "macos": ..., "windows": ...}`. Operaciones: install/uninstall/list/restart. Restart resilient con timeout bounded.

**Por qué:** Apohara desktop-first pero daemon + sidecars (indexer, sandbox, hooks-server) querrán autostart cross-platform. User-level only (no daemons del sistema). (Pattern de culture #13).

### §0.21 Cross-platform Push Notifications con global injection

**Regla:** trait `PushNotifier` + `static GLOBAL_PUSH_NOTIFIER: OnceLock<Arc<dyn PushNotifier>>` que Tauri inyecta al startup con `TauriNotifier` nativo. Fallback `DefaultPushNotifier` usa: macOS `osascript display notification`, Linux `notify-rust`, Windows/WSL2 PowerShell toast script con WSL→Windows path conversion cacheada. Sound notifications via `afplay`/`paplay`/`aplay`/PowerShell SoundPlayer. Sound files empotrados con `rust-embed`.

**Por qué:** Smart Attention "Needs you" fires audio + visual notification cross-platform. (Pattern de vibe-kanban #12 + #17).

### §0.22 Per-provider `default_pure_profiles.json` + JSON Schemas

**Regla:** archivo empotrado `crates/apohara-providers/default_pure_profiles.json` que define para cada CLI provider el variant DEFAULT con su permission override:
- `claude.dangerously_skip_permissions: true`
- `codex.sandbox: "danger-full-access"`
- `opencode.auto_approve: true`

Más JSON Schemas separados por provider en `shared/schemas/{claude,codex,opencode}.json` para form generation + validation.

**Por qué:** Apohara `--pure` mode requiere desactivar permisos en cada CLI. Mapping declarativo + Schemas sirven doble como contrato de UI form gen. (Pattern de vibe-kanban #18).

### §0.23 Crate-granularity workspace ~30 crates

**Regla:** Cargo workspace tiene ~30 miembros, cada uno una responsabilidad única. Apohara crates:
`apohara-types`, `apohara-config`, `apohara-coordinator`, `apohara-providers`, `apohara-mcp`, `apohara-sandbox`, `apohara-indexer`, `apohara-ledger`, `apohara-verification`, `apohara-consolidator`, `apohara-decomposer`, `apohara-scheduler`, `apohara-worktree`, `apohara-hooks-server`, `apohara-pathsafety`, `apohara-secrets`, `apohara-attention`, `apohara-audit`, `apohara-token-accounting`, `apohara-mcp-bridge`, `apohara-event-humanizer`, `apohara-anti-thrash`, `apohara-cli`, `apohara-tauri-app`, `apohara-notifications`, `apohara-persistence`, `apohara-git`, `apohara-github`, `apohara-utils`.

`workspace.dependencies` para versions consistentes. `exclude = [...]` para crates con deps incompatibles.

**Por qué:** cada crate compila independientemente, testing aislado, reuso entre bins (server/mcp/review/tauri comparten executors). (Pattern de vibe-kanban #19 con 38 crates real).

### §0.24 NPX-CLI distribution pattern

**Regla:** además del Tauri build, publicar `apohara-cli` en npm. `npx apohara@latest` baja binarios desde R2/CloudFlare/Backblaze, verifica SHA-256 contra manifest.json, cachea en `~/.apohara/bin/{tag}/{platform}/`, descomprime con `adm-zip`, ejecuta. Modo `--desktop` baja Tauri bundle. Mode `--mcp` arranca MCP server. `LOCAL_DEV_MODE` para development desde `npx-cli/dist/`.

**Por qué:** usuarios casuales que no quieren toolchain Rust pueden hacer `npx apohara@latest --mcp` sin instalación previa. (Pattern de vibe-kanban #5).

### §0.25 Self-describing guardrail flags

**Regla:** modos peligrosos requieren flags self-describing largos. Ejemplo: `--i-understand-that-this-will-be-running-without-the-usual-guardrails` para skip de verification mesh, `--allow-network-during-agent-execution` para network access. Banner ANSI red/bright con caja Unicode el primer arranque o cuando se detecta config arriesgada. Logs structured event `cli.guardrails_bypassed { flag, user, timestamp }`.

**Por qué:** compliance pattern + audit trail + UX que disuade copy-paste sin pensar. (Pattern de symphony #14).

### §0.26 Workflow hot-reload con last-known-good fallback

**Regla:** `WORKFLOW.md` / `apohara.yaml` / SPEC.md son policy-as-code en el repo. `apohara-workflow-watcher` usa `notify` crate (inotify/FSEvents/ReadDirectoryChangesW). Cambios detectados → re-parse config + prompt sin reiniciar el proceso. Si reload falla → mantener LastKnownGood config + emit error visible al operador. Distinguir explícitamente fields **live-reloadable** vs **restart-required** (ej. `max_concurrent_agents` reloadable, HTTP server port no).

**Por qué:** desacopla operadores (editan policy) de la infra (que solo corre Apohara). Usuario edita SPEC y ve cambios reflejarse sin reiniciar. (Pattern de symphony #2 con `WorkflowStore` GenServer real).

### §0.27 JSONC con preservación de comentarios via CST

**Regla:** cualquier escritor de configs `.jsonc` (Claude config, VSCode-style configs) usa `jsonc-parser = "0.29"` crate (features `cst, serde`). Pattern: read → merge en CST → write. Preserva comentarios y formatting. Soporta TOML (codex) + JSON puro.

**Por qué:** modificar configs ajenas que tengan comentarios sin esto los destruye. Killer-bug de orquestadores. (Pattern de vibe-kanban #2).

### §0.28 Workspace hooks 4-phase lifecycle

**Regla:** cuatro shell hooks con semánticas precisas:
- `after_create` (fatal failure → aborta workspace creation)
- `before_run` (fatal failure → aborta attempt actual)
- `after_run` (failure logged + ignored — always runs)
- `before_remove` (failure logged + ignored — cleanup proceeds anyway)

`hooks.timeout_ms` (default 60_000) aplica a todos. Output truncado a 2048 bytes antes de loggear. Hooks corren via `sh -lc <script>` con `cwd=workspace_path, stderr_to_stdout`. SSH remoto: serializar a shell script + ssh-execute con mismo timeout.

**Por qué:** punto de extensión universal sin tocar el core. Usuarios pueden bootstrap workspaces, validar tests pre-dispatch, archivar artifacts post-verify, cerrar PRs en before_remove. (Pattern de symphony #7).

### §0.29 Filter DSL seguro para event-driven rules

**Regla:** mini-lenguaje de filtros para `apohara.yaml` (`==`, `!=`, `in`, `and`, `or`, `not`, paréntesis, dotted field refs, list literals) que evalúa contra el dict del evento. Parser recursive-descent ~200 LOC en TS o Rust. Compilado en parse-time (rechaza configs malos en load). Fail-closed en campos faltantes. Sin function calls (rechazadas explícitamente para evitar code-exec).

**Por qué:** reglas declarativas sin JS, auditoría estática, zero attack surface (no `eval`). Usado para: filtros de capability-manifest, routing del scheduler, agent-hooks predicates. (Pattern de culture #2).

### §0.30 Mesh-as-bus eventos con tags estructurados

**Regla:** EventBus dual-format sobre orchestration DB: tabla `events(ts, type, scope, payload_json, body_human)`. `type` sigue regex dotted-lowercase (`^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$`). Coordinator y agent-hooks publican ahí. TUI Tauri lo renderiza como "system channel" con body humano + payload colapsable. Loop prevention via `_origin` tag.

**Por qué:** mismo canal sirve para (a) coordinación máquina-máquina, (b) observabilidad humana, (c) replay/auditoría histórica. (Pattern de culture #1).

### §0.31 Universal verbs `explain/overview/learn` dispatcher

**Regla:** tres verbos universales registrados en cada namespace del CLI: `explain` (deep), `overview` (shallow map), `learn` (agent onboarding prompt). Cada namespace dueño implementa sus handlers via `register_topic("decomposer", explain=..., overview=..., learn=...)`. `learn` específicamente devuelve markdown prompt-ready que el agente pega en su context para operar la herramienta sin re-explorarla.

**Por qué:** "Natural Language Memory as API". Auto-documentación agent-first nativa. (Pattern de culture #6).

### §0.32 Whisper protocol stderr-side-channel

**Regla:** daemon inyecta mensajes "fuera-de-banda" al agente vía stderr del CLI tool, formato `[whisper:<type>] <message>`. Types: `CORRECTION`, `REMINDER`, `BUDGET_WARNING`, `DRIFT_DETECTED`. El agente lee stderr después de cada llamada CLI. Permite supervisor cortar loops + inyectar context refresh + forzar comportamiento sin contaminar stdout JSON (contract intacto).

**Por qué:** complementario al ledger (post-mortem). Whisper es real-time correction. Skill docs piden "always read stderr". (Pattern de culture #10).

### §0.33 Telemetry privacy-first con install-id anónimo + denylist explícito

**Regla:** `~/.apohara/config.json` tiene `telemetry: { enabled, installId: "inst_<random>", provider: "posthog", host: "https://eu.i.posthog.com" }`. Install ID generado una vez, reusado en CLI + server. Eventos en allowlist cerrada (~15 events: `init_started`, `init_completed`, `provider_connect_*`, `doctor_*`, etc.). Properties **denylist explícito**: NO se envían repo slug, GitHub username, file paths, source code, diffs, prompts, logs, env vars, secrets, tokens, raw payloads. Solo: provider name, runner type, routing mode, outcome category, failure category, duration bucket, counts. Failure categories normalizadas. Opt-out via `APOHARA_TELEMETRY_DISABLED=1`.

**Por qué:** privacy-respectful from day 1 + debugging real de drop-off points + precedente público que reduce fricción. (Pattern de agentrail #11).

---

## §1 North star + 20 acceptance criteria

**Goal:** shipear **Apohara v1.0** como release público end-to-end. Demuestra la propuesta de valor unificada (multi-AI orchestrator con CLI wrappers, semantic-aware scheduling, GitHub bridge, demo grabable, paper formalmente verificado).

Para declarar v1.0 done, los 20 criterios siguientes deben ser ✅ y verificables:

| Grupo | ID | Criterio |
|---|---|---|
| **Demo** | D-1 | Video de 90s grabable: kanban view → GitHub issue → DAG → 3 CLIs en paralelo → mesh → PR sin intervención manual |
| | D-2 | Issue con label `apohara` en `SuarezPM/apohara-demo` (repo a crear) dispara run automático |
| | D-3 | Coordinator detecta 2 tasks que deben serializar (rename + use) en el demo, lo registra en ledger |
| | D-4 | PR aparece con replay link, judge+critic verdict, agentes utilizados listados |
| **Release** | R-1 | Tag `v1.0.0` publicado en `SuarezPM/Apohara` |
| | R-2 | Binaries cross-OS: Linux (.AppImage + .deb), macOS (.dmg arm64 + x86_64), Windows (.msi). Raw <15MB excepto AppImage |
| | R-3 | `brew install suarezpm/tap/apohara` funciona en macOS limpia |
| | R-4 | `curl -fsSL .../install.sh \| sh` funciona en Docker Ubuntu 24.04 y Fedora 41 limpias |
| | R-5 | README + ARCHITECTURE.md + CHANGELOG.md reflejan v1.0 |
| **Verde** | V-1 | ContextForge: `pytest tests/ -q` → **310 passed** (regression no rota) |
| | V-2 | Apohara TS: `bun test` verde (suite existente + nuevos integration tests) |
| | V-3 | Apohara Rust: `cargo test -p apohara-worktree --lib && cargo test -p apohara-coordinator --lib && cargo test -p apohara-hooks-server --lib` verde |
| | V-4 | `apohara replay <demo-run-id>` reconstruye el run y verifica hash chain |
| **Paper** | P-1 | INV-15 v3.0 con prueba Z3 **sometido** a arXiv (no aprobación). arXiv ID documentado en `apohara-context-forge/paper/` |
| **Runtime** | N-1 | Agent-hooks server responde a `PreToolUse`/`PostToolUse`/`Stop` events de los 3 CLIs activos |
| | N-2 | Orchestration DB SQLite operativa: `apohara orchestration {send,check,task-create,dispatch,gate-create}` end-to-end + tests |
| | N-3 | `apohara orchestration check --wait --types worker_done --timeout-ms 300000` bloquea con heartbeat stderr cada 15s |
| **Refactor** | N-4 | BaseAgentProvider + ProtocolInterface refactor done: los 3 CLI drivers heredan, tests verdes |
| **Pipeline** | N-5 | Two-tier transcript: canonical event projector procesa el ledger raw + `apohara replay --canonical` funciona |
| **MCP** | N-6 | 3 internal MCP servers (`apohara.ledger`, `apohara.runs`, `apohara.indexer`) responden con bearer token + audit log de cada llamada al ledger |
| **Setup** | N-7 | `apohara verify-setup` corre task seed end-to-end (decomposer → scheduler → providers → mesh → consolidator → ledger) y `apohara doctor` exige verdict approved + ledger_root válido (Setup verification gate de agentrail) |
| **Doctor** | N-8 | `apohara doctor` compila dry-run el execution plan con la policy actual (no solo binary checks); secciones: runtime/roster/policy/sandbox/ledger/mcp con `--skip-<section>` para CI partial |
| **Push** | N-9 | Two-track wake mechanism: `/api/events/stream` SSE con `Last-Event-ID` resume + webhook delivery worker con HMAC + 8 attempts back-off `[0,10,30,90,300,900,1800,3600]s` + 410 auto-disable |
| **Policy** | N-10 | Runner execution policy con 4 presets `strict\|balanced\|advisory\|external_sandbox` + filesystem snapshot SHA-256 antes/después + recovery de archivos críticos (AGENTS.md, CLAUDE.md, .apohara/**) |
| **State** | N-11 | "Blocked" como primary state distinto de "Retrying" en orchestration DB; TaskBoard kanban suma columna dedicada "Blocked / Needs Operator"; reconciliation pass dedicado |
| **Contracts** | N-12 | `availableActions[]` campo en TODA response del coordinator (vocabulario cerrado enum Rust + serde discriminated union); agente NUNCA infiere siguiente paso, lee el campo |

---

## §2 Arquitectura global

```
┌──────────────────────────────────────────────────────────────────────────┐
│                       APOHARA DESKTOP (Tauri v2)                         │
│  ObjectivePane │ ViewToggle(Graph|Board) │ CodeDiffPane │ TopBar         │
│                                                                          │
│         ┌─SwarmCanvas─┐  ┌─TaskBoard─┐ ← NUEVO (§4)                      │
│         └─────────────┘  └───────────┘  (modular, hooks-per-concern)     │
│                                                                          │
│  PlansPanel sidebar ← NUEVO (§6) — lista plans con planStatus filters    │
│  PermissionDialog ← NUEVO (§4.6) — durable, render-from-ledger           │
│  Custom tool widgets registry ← NUEVO (§4)                               │
└──────────────────────────── ↕ HTTP :7331 ───────────────────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│  APOHARA CORE (TypeScript on Bun)                                        │
│                                                                          │
│  src/core/providers/ ← REFACTOR (§4.5)                                   │
│    BaseAgentProvider.ts (abstract, static DI, abort/session/permission)  │
│    protocols/AgentProtocol.ts (interface unificada)                      │
│    ClaudeCodeProvider · CodexProvider · OpenCodeProvider                 │
│    parsers/{ClaudeParser, CodexParser, OpenCodeParser}.ts                │
│                                                                          │
│  src/core/orchestration/ ← NUEVO (§3.6)                                  │
│    db.ts (bun:sqlite, WAL, schema v1)                                    │
│    coordinator.ts (push-on-idle, circuit-breaker, drift-probe)           │
│    preamble.ts (dispatch preamble + drift section)                       │
│    groups.ts (@idle, @worktree:X, @claude, @codex, @opencode)            │
│                                                                          │
│  src/core/ (módulos existentes, modificados)                             │
│    decomposer.ts ← emite TaskSymbolManifest + INSERT INTO tasks          │
│    scheduler.ts ← consulta coordinator + dispatch via orchestration      │
│    verification-mesh.ts ← sin cambio interno, emite decision_gates       │
│    consolidator.ts ← consume worker_done + merge_ready messages          │
│    ledger.ts ← + canonical projector (§ two-tier transcript)             │
│    capability-manifest.ts ← Thompson Sampling sigue, audit lessons       │
│                                                                          │
│  src/core/safety/ ← NUEVO (§4.6)                                         │
│    patterns.ts (Bash:npm:test:*, scopes once/session/always)             │
│    settingsHierarchy.ts (~/.claude → .claude/settings.json → ...)        │
│    bashCompoundAnalyzer.ts (split &&, ||, ;)                             │
│    trustPresets.ts (per-agent trust file writers)                        │
│    envSanitizer.ts (blocklist exhaustiva)                                │
│                                                                          │
│  src/core/spec/ ← NUEVO (§6)                                             │
│    planDocuments.ts (markdown + YAML frontmatter parser)                 │
│    planStatusCache.ts (4KB bounded reads, SHA hashing, watcher)          │
│                                                                          │
│  src/core/mcp/servers/ ← NUEVO (§6.5)                                    │
│    apohara-ledger.ts, apohara-runs.ts, apohara-indexer.ts                │
│    apohara-settings.ts (allow-list, deny-list, rate-limit, audit)        │
│                                                                          │
│  src/core/trackers/ ← NUEVO (§7.5)                                       │
│    decisionTracker.ts, bugTracker.ts (structured templates)              │
└─────────────────── ↕ UDS (.apohara/sockets/) ───────────────────────────┘
┌─────────────────┬─────────────────┬──────────────────┬──────────────────┐
│ apohara-indexer │ apohara-        │ apohara-         │ apohara-hooks-   │
│  (existente)    │ worktree        │ coordinator      │ server ← NUEVO   │
│                 │ (RENAME+EXPAND  │ (slim, delega    │ (§3.5)           │
│ tree-sitter +   │ §3.1)           │ state a DB)      │                  │
│ Nomic BERT +    │ + 6 verbs:      │                  │ axum/hyper en    │
│ redb            │ delete-preflight│ aplica conflict  │ 127.0.0.1:rand   │
│                 │ + lineage +     │ matrix sobre     │                  │
│ + blast-radius  │ cleanup-tiers + │ TaskSymbolMani-  │ bearer token +   │
│ con confidence  │ orphan-adoption │ fest             │ endpoint file    │
│ score           │ + per-worktree  │                  │                  │
│                 │ userData dir +  │                  │ recibe events    │
│ + canonical     │ build cache     │                  │ PreToolUse /     │
│ event emitter   │                 │                  │ PostToolUse /    │
│ on file change  │                 │                  │ Stop / Permission│
│ (§ file-watcher │                 │                  │ Request          │
│ diff)           │                 │                  │                  │
└─────────────────┴─────────────────┴──────────────────┴──────────────────┘
┌──────────────────────────────────────────────────────────────────────────┐
│  packages/github-bridge/ ← NUEVO (§5)                                    │
│  poll-only para v1.0 (webhook = follow-up post-v1.0)                     │
│  poller (cron interno) → issue-parser → ObjectivePayload → scheduler     │
│  consolidator → pr-builder → PR con replay link                          │
│  Auth: GitHub App (no PAT)                                               │
│  Persistence: orchestration DB messages table                            │
│  Attribution: terminal attribution shim (git/gh wrappers en PATH)        │
└──────────────────────────────────────────────────────────────────────────┘

[apohara-sandbox       — sin cambios para v1.0]
[ContextForge sidecar  — sin cambios para v1.0]
[Ledger SHA-256 chain  — extiende con canonical projection layer]
```

### Inventario de cambios

| Tipo | Componentes |
|---|---|
| **Nuevos crates Rust** | `crates/apohara-worktree/` (rename+expand de isolation-engine), `crates/apohara-coordinator/` (slim, delega state a DB), `crates/apohara-hooks-server/` (sidecar HTTP loopback), `crates/apohara-pathsafety/` (symlink-escape detection), `crates/apohara-secrets/` (keyring-rs wrapper), `crates/apohara-attention/` (state machine HOT/WARM/COOL/IDLE), `crates/apohara-audit/` (JSONL sink + rotación + fchmod 0600), `crates/apohara-token-accounting/` (absolutes > deltas + per-thread keying), `crates/apohara-mcp-bridge/` (canonical MCP config + adapters per provider), `crates/apohara-event-humanizer/` (provider events → human-readable labels), `crates/apohara-anti-thrash/` (strategy rotation tracker), `crates/apohara-persistence/` (cross-platform service installer), `crates/apohara-notifications/` (cross-platform push notifications) |
| **Nuevos paquetes TS** | `packages/github-bridge/`, `src/core/orchestration/`, `src/core/safety/`, `src/core/spec/`, `src/core/mcp/servers/`, `src/core/trackers/`, `src/store/listeners/` (centralized IPC), `src/core/whisper/` (stderr-side-channel daemon→agent), `src/core/quality-gates/` (domain-specific pre-judge gates), `src/core/filter-dsl/` (event-driven rules parser), `src/core/telemetry/` (privacy-first events + denylist), `src/core/skills/` (skills install + discovery), `npx-cli/` (binary downloader + Tauri fallback) |
| **Nuevos componentes UI** | `TaskBoard/` (modular hooks-per-concern), `PlansPanel`, `PermissionDialog`, custom tool widgets registry, `BlockedQueuePanel` (primary state queue), `VerificationTimeline` (trust theater visual del judge≠critic flow), `ReactionEngineConfig` (lifecycle state machine UI) |
| **Refactor mayor** | `src/core/providers/` → `BaseAgentProvider` + `ProtocolInterface` (afecta los 3 CLI drivers) + `enum_dispatch` + `Capability` flags |
| **Modificados** | `decomposer.ts`, `scheduler.ts`, `verification-mesh.ts`, `consolidator.ts`, `ledger.ts` (+ canonical projector + `availableActions[]` en cada response), `apohara-indexer` (Rust, + canonical emitter on file change + presence inference) |
| **Removidos / movidos a legacy** | 21 cloud providers + `gemini-cli` driver + Gemini OAuth wiring detrás de `APOHARA_LEGACY_PROVIDERS=1`, tests dependientes |
| **Sin cambios** | `apohara-sandbox`, ContextForge entero, `SwarmCanvas.tsx`, `CodeDiffPane.tsx`, ledger SHA-256 chain |

### Flujos de control nuevos

**Flujo A — Coordinator semántico:**

```
decomposer.ts → Task[] con TaskSymbolManifest
  → INSERT INTO tasks(spec, status='pending', deps=[...])
scheduler tick:
  SELECT tasks WHERE status='ready' AND deps all completed
  → coordinator.checkConflicts(task) → decision
     Assign  → INSERT dispatch_contexts → worktree.create()
               → spawn CLI con preamble + agent-hooks env injected
               → status='dispatched'
     Queue   → INSERT decision_gate(reason, waiting_for) → status='blocked'
     Reject  → escalate al decomposer
     Defer   → setTimeout, retry
agent-hooks-server recibe PreToolUse/PostToolUse → INSERT messages
worker termina → emite worker_done message
  → coordinator detecta → release locks → unblock queued tasks
```

**Flujo B — github-bridge:**

```
poller(60s) → octokit.list_issues(label="apohara")
  → INSERT INTO messages(type='dispatch', from='github', body=...)
  → coordinator pull-up: INSERT tasks + decomposer
on worker_done con result:success:
  pr-builder → git/gh wrappers en PATH inyectan Co-authored-by
  → octokit.create_pr → INSERT INTO messages(type='merge_ready')
```

**Flujo C — Internal MCP:**

```
CLI agent corre tool: mcp__apohara__list_runs
  → axum server en 127.0.0.1:rand verifica bearer token
  → SELECT FROM runs ORDER BY ts DESC LIMIT 10
  → response al agent
  → audit log: INSERT INTO ledger event=mcp_tool_invoked
```

---

## §3 Coordinator semántico

El modelo es **read/write set scheduling** apoyado en blast-radius semántico del indexer existente. State persistido en la orchestration DB (§3.6); coordinator es función pura sobre snapshots.

### §3.1 `apohara-worktree` crate (RENAME + EXPAND)

**Migración:** renombrar `isolation-engine/` → `crates/apohara-worktree/`, actualizar `Cargo.toml` workspace members, mantener API `create`/`destroy` por backward compat hasta que `src/core/isolation.ts` migre al nuevo RPC.

**API Rust pública:**

```rust
pub struct WorktreeId { pub task_id: String, pub slug: String }

// Core lifecycle:
pub fn create(task_id: &str, repo_path: &Path) -> Result<WorktreePath>
pub fn list(repo_path: &Path) -> Result<Vec<WorktreeEntry>>
pub fn adopt_orphan(path: &Path) -> Result<bool>           // si lock > 5 min
pub fn prune_stale(older_than: Duration) -> Result<usize>
pub fn merge(task_id: &str) -> Result<MergeResult>
pub fn preserve_on_fail(task_id: &str, reason: FailureReason) -> Result<BranchName>
pub fn cleanup(task_id: &str, reason: CleanupReason) -> Result<()>

// Adoptions from orca + nimbalyst (6 verbs):
pub fn delete_preflight(task_id: &str) -> Result<PreflightReport>
  // git status --porcelain --untracked-files=all ANTES de kill PTYs
pub fn set_lineage(task_id: &str, parent_task_id: Option<&str>, lineage_root: Option<&str>) -> Result<()>
pub fn list_with_classification() -> Result<Vec<WorktreeClassified>>
  // Classification = Ready | Review | Protected
pub fn adopt_pre_existing() -> Result<Vec<AdoptedWorktree>>
  // git worktree list --porcelain + reconcilia con metadata
pub fn dismiss_cleanup(task_id: &str, fingerprint: &str) -> Result<()>
  // fingerprint = sha(branch+head+gitClean+activityBucket+classifierVersion)
pub fn per_worktree_user_data_dir(task_id: &str) -> Result<PathBuf>
  // Tauri userData dir aislado por worktree

pub enum MergeResult   { Success, Conflict { files: Vec<PathBuf> } }
pub enum CleanupReason { Completed, Failed, Cancelled }
pub enum FailureReason { MergeConflict, AgentFailed, Cancelled }
pub enum PreflightReport { Clean, DirtyFiles(Vec<PathBuf>), UnpushedCommits(usize), LiveAgent }
```

**Reglas de lifecycle:**

- Naming `<adj>-<noun>-<6hex>` preservado de `worktree-manager.ts` (Pablo's existing pattern)
- Lock `.apohara-lock` con PID; meta `.apohara-meta.json` con `{ task_id, created_at, branch, parent_task_id?, lineage_root? }`
- Adopt si lock > 5 min; prune si dir mtime > umbral AND lock > 1 min de gracia
- `preserve_on_fail` NUNCA elimina el worktree; crea branch `apohara/task-{id}-failed-{ts}` para inspección manual
- `cleanup(Failed)` es NO-OP (preserva); solo `Completed` y `Cancelled` borran físicamente
- `delete_preflight` corre ANTES de kill PTYs (orden correcto: preflight → kill → git remove)

**Comunicación TS↔Rust:**

- Unix Domain Socket en `.apohara/sockets/worktree.sock` (mismo patrón que apohara-sandbox/indexer)
- JSON-RPC simple (no streaming)
- `src/core/isolation.ts` se actualiza para hablar JSON-RPC en vez de subprocess + retry
- Server side: tokio-uds

**Eventos al ledger** (emitidos vía RPC al core):

```ts
type WorktreeEvent =
  | { type: "worktree_created";   task_id; slug; path; lineage_root?; parent_task_id?; ts }
  | { type: "worktree_merged";    task_id; ts; commits_merged }
  | { type: "worktree_conflict";  task_id; files: string[]; ts }
  | { type: "worktree_preserved"; task_id; branch; reason; ts }
  | { type: "worktree_cleaned";   task_id; reason; ts }
  | { type: "worktree_adopted";   task_id; from_path; ts }
  | { type: "worktree_preflight_failed"; task_id; blockers: string[]; ts }
```

**Tests Rust:**

- `lifecycle.rs`: create → merge OK → cleanup
- `merge_conflict.rs`: create → introducir conflicto → merge falla → preserve_on_fail crea branch
- `adopt_orphan.rs`: simular crash de proceso → adopt_orphan recupera
- `prune_stale.rs`: viejo worktree → prune lo elimina
- `concurrent_create.rs`: 5 create en paralelo no colisionan en slug ni en lock
- `delete_preflight_blocks_dirty.rs`: dirty worktree → preflight Bloquea → no kill
- `lineage_chain.rs`: parent → 3 children → list mantiene chain
- `classification.rs`: ready/review/protected cada uno con sus blockers

### §3.2 `apohara-coordinator` crate (slim)

**Cambio mayor respecto al diseño inicial:** las funciones públicas ya no mantienen estado interno. Operan sobre slices o IDs y delegan persistence a la orchestration DB.

```rust
pub struct SymbolRef {
    pub file: PathBuf,
    pub symbol: String,
    pub kind: SymbolKind,
}

pub struct TaskSymbolManifest {
    pub reads:   Vec<SymbolRef>,
    pub writes:  Vec<SymbolRef>,
    pub renames: Vec<SymbolRef>,
}

pub struct BlastRadius {
    pub symbols: HashSet<SymbolRef>,
    pub confidence: Confidence,
}
pub enum Confidence { High, Low, None }

pub enum SchedulingDecision {
    Assign,
    Queue  { waiting_for: TaskId, reason: String, overlap: Vec<SymbolRef> },
    Reject { reason: String, missing_symbols: Vec<SymbolRef> },
    Defer  { reason: String, retry_after: Duration }
}

pub async fn check_conflicts(
    new_manifest: &TaskSymbolManifest,
    active_manifests: &[(TaskId, TaskSymbolManifest)],
    indexer_client: &IndexerClient,
) -> Result<SchedulingDecision>

pub async fn validate_manifest(
    manifest: &TaskSymbolManifest,
    indexer_client: &IndexerClient,
) -> Result<ValidationReport>

pub fn build_release_query(task_id: &TaskId) -> SqlQuery
  // El "release" deja de ser método; es una query SQL que el scheduler ejecuta
```

**Política gradient** (confianza del indexer):

- `Confidence::High` (todos los symbols existen + < 10% edges unknown) → `Assign` si no choca
- `Confidence::Low` (alguno faltante o 10-50% edges unknown) → `Queue` siempre (conservador)
- `Confidence::None` (indexer no responde o > 50% unknown) → `Defer` con retry 30s

**Conflict matrix:**

```
              reads(B)   writes(B)   renames(B)
reads(A)      OK         conflict    conflict
writes(A)     conflict   conflict    conflict
renames(A)    conflict   conflict    conflict
```

Solo `reads ∩ reads` paraleliza. El coordinator expande blast radius vía `indexer.getBlastRadius()` y aplica la matriz a la unión expandida.

**Tests Rust:**

- `no_conflict.rs`: dos tasks con reads no-overlap → Assign ambas
- `read_read_safe.rs`: dos tasks reads del mismo symbol → Assign ambas
- `write_write_blocks.rs`: dos tasks writes del mismo symbol → Queue la segunda
- `rename_blocks_all.rs`: A renames `foo`, B reads `foo` → Queue B
- `blast_radius_overlap.rs`: A writes `foo`, indexer dice `foo` es llamado por `bar`; B writes `bar` → Queue
- `manifest_invalid.rs`: symbol declarado no existe → Reject
- `indexer_down.rs`: socket no responde → Defer

### §3.3 Cambios al decomposer

Schema del output del planning LLM:

```ts
interface Task {
  id: string;
  description: string;
  dependsOn: string[];
  agentRole: "planner" | "coder" | "critic" | "judge";
  symbols: TaskSymbolManifest;
}
interface TaskSymbolManifest {
  reads: SymbolRef[];
  writes: SymbolRef[];
  renames: SymbolRef[];
}
```

Cambios al prompt del planning LLM:

- Instrucciones explícitas "para cada task declarar reads/writes/renames"
- 3 few-shot examples (refactor, rename, add-new-file)
- Schema JSON zod actualizado (apohara ya usa zod 4.4)

Validación post-decomposition: llamar `coordinator.validate_manifest()`. Si `Confidence::None` → retry decomposer (max 2). Si sigue None → log warning + proceder en modo degradado.

**Adición:** al producir el DAG, decomposer INSERTA cada task en `tasks` table con `status='pending'` y `spec=JSON.stringify({description, symbols, agentRole})`.

### §3.4 Cambios al scheduler

```ts
async runLoop() {
  while (this.active) {
    const readyTasks = await db.query(`
      SELECT * FROM tasks
      WHERE status = 'pending'
        AND id NOT IN (SELECT task_id_blocked FROM decision_gates WHERE status='open')
        AND (deps = '[]' OR NOT EXISTS (
          SELECT 1 FROM json_each(tasks.deps) dep
          WHERE dep.value NOT IN (SELECT id FROM tasks WHERE status='completed')
        ))
      ORDER BY ts ASC
    `);

    for (const task of readyTasks) {
      const activeManifests = await db.query(`
        SELECT id, spec FROM tasks WHERE status='dispatched'
      `).map(t => [t.id, JSON.parse(t.spec).symbols]);

      const decision = await coordinator.checkConflicts(
        JSON.parse(task.spec).symbols,
        activeManifests,
      );

      await ledger.emit({ type: "coord_decision", task_id: task.id, ...decision });

      switch (decision.kind) {
        case "Assign":
          const wt = await worktree.create(task.id);
          const preamble = buildDispatchPreamble({ ... });
          await db.insert('dispatch_contexts', {
            task_id: task.id, agent_handle: ..., worktree_id: wt.id,
            preamble, status: 'spawning',
          });
          await db.update('tasks', { status: 'dispatched' }, { id: task.id });
          await this.dispatch(task, wt, preamble);
          break;
        case "Queue":
          await db.insert('decision_gates', {
            task_id_blocked: task.id,
            task_id_blocking: decision.waiting_for,
            reason: decision.reason,
            overlap_symbols: JSON.stringify(decision.overlap),
            status: 'open',
          });
          break;
        case "Reject":
          await this.escalateToDecomposer(task, decision.reason);
          break;
        case "Defer":
          setTimeout(() => this.poke(), decision.retry_after);
          break;
      }
    }
    await this.waitForOrchestrationEvent({ timeout_ms: 5000 });
  }
}

async onWorkerDone(taskId: TaskId, result: TaskResult) {
  if (result.kind === "success") {
    const merge = await worktree.merge(taskId);
    if (merge.status === "conflict")
      await worktree.preserveOnFail(taskId, "merge_conflict");
  } else {
    await worktree.preserveOnFail(taskId, "agent_failed");
  }
  await db.update('tasks',
    { status: result.kind === 'success' ? 'completed' : 'failed' },
    { id: taskId });
  await db.update('decision_gates',
    { status: 'resolved', resolved_at: Date.now() },
    { task_id_blocking: taskId, status: 'open' });
  this.poke();
}
```

**Tests TS** (`tests/scheduler-coordinator.test.ts`): paralelización sin conflicto, encolado con conflicto, rejection con manifest inválido, defer con indexer down, cadena A→B→C de unblocks, circuit breaker después de 3 dispatch failures.

### §3.5 Agent-hooks HTTP loopback server

Sidecar Rust mini que recibe eventos en tiempo real desde los CLIs nativos. **Unlock más grande del análisis de orca:** Apohara pasa de "infiero estado desde stdout" a "los CLIs me cuentan exactamente qué están haciendo".

**Crate `crates/apohara-hooks-server/`:**

- Stack: `axum` (HTTP framework) + `tokio` + `serde`. ~300-500 LOC.
- Bind: `127.0.0.1:RAND_PORT` (selected at startup, retry on collision)
- Auth: bearer token RAND_64BYTES (header `Authorization`)
- Endpoint file: `~/.apohara/sockets/hooks-endpoint.json` con `{port, token, started_at}` para que los hook scripts puedan source-arlo si Apohara reinicia

**Endpoints:**

- `POST /event` — body `{type, pane_key, task_id, worktree_id, payload}`. Tipos: `pre_tool_use | post_tool_use | post_tool_use_failure | stop | user_prompt_submit | permission_request`. → INSERT INTO messages + tokio broadcast → Tauri event
- `GET /health` — `{alive, uptime_ms, events_received}`

**Hook scripts** (idempotentes, hash-matched antes de overwrite):

POSIX (`apohara-claude-hook.sh`):

```bash
#!/bin/bash
# Auto-instalado por Apohara en ~/.claude/hooks/
# Hash: sha256:abc...  (Apohara no toca si el hash matchea)
set -eu

[ -f "$HOME/.apohara/sockets/hooks-endpoint.json" ] || exit 0
PORT=$(jq -r .port "$HOME/.apohara/sockets/hooks-endpoint.json")
TOKEN=$(jq -r .token "$HOME/.apohara/sockets/hooks-endpoint.json")

PAYLOAD=$(cat)

curl -s --max-time 2 \
  -X POST "http://127.0.0.1:$PORT/event" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"type\": \"$APOHARA_HOOK_TYPE\",
    \"pane_key\": \"${APOHARA_PANE_KEY:-}\",
    \"task_id\": \"${APOHARA_TASK_ID:-}\",
    \"worktree_id\": \"${APOHARA_WORKTREE_ID:-}\",
    \"payload\": $PAYLOAD
  }" || true  # never fail the CLI
```

Windows (`apohara-claude-hook.cmd`): equivalente con `curl.exe` + powershell.

**Instalación de hooks** (en `src/core/hooks/installer.ts`): idempotencia con hash, backup antes de overwrite, registra en config nativo del agente.

**Spawning con env vars** (en `src/core/scheduler.ts`): cada `Bun.spawn` de un CLI agente inyecta `APOHARA_HOOK_PORT`, `APOHARA_HOOK_TOKEN`, `APOHARA_TASK_ID`, `APOHARA_WORKTREE_ID`, `APOHARA_PANE_KEY`, `APOHARA_COORDINATOR_HANDLE`.

**Schema de evento normalizado:**

```ts
type HookEvent =
  | { type: 'pre_tool_use'; tool_name: string; tool_input: unknown; timestamp: number }
  | { type: 'post_tool_use'; tool_name: string; tool_output: unknown; duration_ms: number; timestamp: number }
  | { type: 'post_tool_use_failure'; tool_name: string; error: string; timestamp: number }
  | { type: 'stop'; reason: 'completed' | 'interrupted' | 'crashed'; timestamp: number }
  | { type: 'user_prompt_submit'; prompt: string; timestamp: number }
  | { type: 'permission_request'; tool_name: string; tool_input: unknown; scope_proposed?: 'once'|'session'|'always'; timestamp: number };

interface HookEventCommon {
  pane_key: string;
  task_id?: string;
  worktree_id?: string;
}
```

**Persistence:** cada evento se INSERTA en `messages` table como `{ from_handle: 'hook:<provider>:<pane_key>', to_handle: '@coordinator', type: 'status', payload: HookEvent }`.

**Tauri broadcast:** tokio::broadcast channel emite a Tauri event `apohara://hook-event` que los listeners centralizados de §0.1 consumen.

**Fallback OSC parsing** (cuando hooks no llegan): orca's `extractLastOscTitle` + `detectAgentStatusFromTitle` pattern. Implementado en el reader de PTY del indexer o como módulo separado. Prioridad: hook > OSC > nada.

**Tests Rust:**

- `auth.rs`: requests sin bearer token → 401
- `event_normalization.rs`: payload de cada provider llega normalizado al broadcast
- `endpoint_file_atomic.rs`: rename atómico, scripts pueden source en paralelo sin race
- `idempotency.rs`: instalar el mismo hook 2 veces no cambia file (hash match)
- `cross_platform_paths.rs`: paths POSIX y Windows resuelven correctamente
- `dropped_packet_no_block.rs`: si sidecar down, curl timeout 2s y el CLI sigue sin bloquearse

### §3.5.1 Pre/PostCompact contract re-injection (de claude-octopus)

**Problema:** cuando Claude Code (u otro CLI) hace `/compact`, pierde el contract activo (dispatch preamble, role definitions, safety constraints). El agent puede saltar a hacer Edit sin haber consultado el ledger, violando el flow del coordinator.

**Solución: snapshot + re-inject pattern.**

**PreCompact hook** (instalado en `~/.claude/hooks/`):
```bash
#!/bin/bash
# apohara-pre-compact.sh
# Auto-instalado por Apohara. Se dispara cuando Claude está por compactar context.
set -eu

PORT=$(jq -r .port "$HOME/.apohara/sockets/hooks-endpoint.json")
TOKEN=$(jq -r .token "$HOME/.apohara/sockets/hooks-endpoint.json")

# Snapshot contract activo: workflow, phase, autonomy, completed_phases, blockers
SNAPSHOT=$(curl -s --max-time 2 \
  -X POST "http://127.0.0.1:$PORT/snapshot/contract" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{
    \"task_id\": \"${APOHARA_TASK_ID:-}\",
    \"worktree_id\": \"${APOHARA_WORKTREE_ID:-}\",
    \"trigger\": \"pre_compact\"
  }")

# Guardar localmente como fallback (en caso de que el sidecar muera entre snapshots)
mkdir -p "$HOME/.apohara/snapshots"
echo "$SNAPSHOT" > "$HOME/.apohara/snapshots/contract-${APOHARA_TASK_ID:-default}.json"
```

**PostCompact hook**:
```bash
#!/bin/bash
# apohara-post-compact.sh
set -eu

# Leer snapshot (con TTL <10min para evitar re-inyectar contracts viejos)
SNAPSHOT_FILE="$HOME/.apohara/snapshots/contract-${APOHARA_TASK_ID:-default}.json"
[ -f "$SNAPSHOT_FILE" ] || exit 0

SNAPSHOT_AGE=$(($(date +%s) - $(stat -c %Y "$SNAPSHOT_FILE" 2>/dev/null || stat -f %m "$SNAPSHOT_FILE")))
[ "$SNAPSHOT_AGE" -gt 600 ] && exit 0  # >10min, descartar

# Re-inject contract como system message
CONTRACT=$(jq -r .contract "$SNAPSHOT_FILE")
WORKFLOW=$(jq -r .workflow "$SNAPSHOT_FILE")

# Output JSON al stdout del hook (Claude Code lo lee y lo inyecta como system-reminder)
cat <<EOF
{
  "hookSpecificOutput": {
    "additionalContext": "<system-reminder>\nYou are mid-workflow. Your dispatch preamble + contract from the coordinator are below — RESPECT THEM:\n\n${CONTRACT}\n\nActive workflow: ${WORKFLOW}\nYou were spawned by the Apohara coordinator with specific reads/writes/renames symbols. You MUST NOT touch symbols outside your declaration. You MUST emit \`worker_done\` via \`apohara orchestration send\` when finished.\n</system-reminder>"
  }
}
EOF
```

**InstructionsLoaded hook (fallback)**: si por alguna razón PostCompact no se disparó, este hook lee el snapshot file al cargar nuevas instrucciones del agent y re-inyecta el contract.

**Server-side snapshot endpoint** en `apohara-hooks-server`:
```rust
// Maneja POST /snapshot/contract
async fn snapshot_contract(State(state): State<HooksServerState>, Json(req): Json<SnapshotRequest>) -> Json<SnapshotResponse> {
    let dispatch_context = state.orchestration_db.get_dispatch_context(&req.task_id).await?;
    let active_contract = ActiveContract {
        contract: dispatch_context.preamble.clone(),
        workflow: dispatch_context.spec.agent_role.clone(),
        autonomy: dispatch_context.autonomy_level.clone(),
        completed_phases: state.orchestration_db.completed_phases_for(&req.task_id).await?,
        blockers: state.orchestration_db.open_decision_gates_for(&req.task_id).await?,
        symbols: dispatch_context.spec.symbols.clone(),
    };
    Json(SnapshotResponse { contract: active_contract, generated_at: Utc::now() })
}
```

**Por qué:** sin esto, el coordinator semántico pierde su scaffolding cuando el agent compacta context. El symbol manifest, el dispatch preamble, el protocolo de comunicación — todo se evapora. Re-inyectar el contract post-compact preserva el contract sin requerir que el agent recuerde explícitamente (lo cual no funciona). Especialmente importante para drift detection: si contract dice "ledger-required" y post-compact agent salta directamente a Edit sin Bash apohara/ledger, drift detectado. (Pattern de claude-octopus #8).

**Tests:**
- `pre_compact_snapshot_persists.test.ts`: snapshot file existe con TTL válido después del hook
- `post_compact_reinjects_when_fresh.test.ts`: contract re-inyectado si snapshot < 10min
- `post_compact_skips_when_stale.test.ts`: skip si snapshot > 10min
- `drift_detection_after_compact.test.ts`: si agent post-compact viola contract, drift detectado en próximo merge

### §3.6 Orchestration DB

Columna vertebral de toda la coordinación multi-agente. Persistence + message bus + DAG tracking + decision gates en una sola DB.

**Stack:**

- Storage: `bun:sqlite` (built-in en Bun, native binding)
- Mode: WAL (`PRAGMA journal_mode=WAL`) + `busy_timeout=5000`
- Location: `.apohara/orchestration.db` (por run, no global; cada run nueva DB)
- Schema versioning: `PRAGMA user_version=1` con migrations en `src/core/orchestration/migrations/`

**Schema completo (v1):**

```sql
CREATE TABLE messages (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  from_handle   TEXT NOT NULL,
  to_handle     TEXT NOT NULL,
  subject       TEXT,
  body          TEXT,
  type          TEXT NOT NULL CHECK(type IN
    ('status', 'dispatch', 'worker_done', 'merge_ready',
     'escalation', 'handoff', 'decision_gate', 'heartbeat')),
  priority      TEXT NOT NULL DEFAULT 'normal'
                 CHECK(priority IN ('urgent', 'normal', 'low')),
  thread_id     TEXT,
  payload       TEXT,
  read          INTEGER NOT NULL DEFAULT 0,
  delivered_at  INTEGER,
  ts            INTEGER NOT NULL
);
CREATE INDEX idx_messages_to ON messages(to_handle, read);
CREATE INDEX idx_messages_thread ON messages(thread_id);

CREATE TABLE tasks (
  id                          TEXT PRIMARY KEY,
  parent_id                   TEXT,
  created_by_terminal_handle  TEXT,
  spec                        TEXT NOT NULL,
  status                      TEXT NOT NULL CHECK(status IN
    ('pending', 'ready', 'dispatched', 'completed', 'failed', 'blocked')),
  deps                        TEXT NOT NULL DEFAULT '[]',
  result                      TEXT,
  completed_at                INTEGER,
  ts                          INTEGER NOT NULL
);
CREATE INDEX idx_tasks_status ON tasks(status);

CREATE TABLE dispatch_contexts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id       TEXT NOT NULL REFERENCES tasks(id),
  agent_handle  TEXT NOT NULL,
  worktree_id   TEXT,
  preamble      TEXT NOT NULL,
  status        TEXT NOT NULL CHECK(status IN
    ('spawning', 'running', 'completed', 'failed', 'aborted')),
  started_at    INTEGER NOT NULL,
  completed_at  INTEGER,
  ts            INTEGER NOT NULL
);

CREATE TABLE decision_gates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id_blocked   TEXT NOT NULL REFERENCES tasks(id),
  task_id_blocking  TEXT NOT NULL REFERENCES tasks(id),
  reason            TEXT NOT NULL,
  overlap_symbols   TEXT NOT NULL,
  status            TEXT NOT NULL CHECK(status IN ('open', 'resolved')),
  opened_at         INTEGER NOT NULL,
  resolved_at       INTEGER
);
CREATE INDEX idx_gates_blocking ON decision_gates(task_id_blocking, status);
CREATE INDEX idx_gates_blocked ON decision_gates(task_id_blocked, status);

CREATE TABLE coordinator_runs (
  id          TEXT PRIMARY KEY,
  run_id      TEXT NOT NULL,
  status      TEXT NOT NULL CHECK(status IN ('starting', 'running', 'completed', 'aborted')),
  started_at  INTEGER NOT NULL,
  ended_at    INTEGER
);

PRAGMA user_version = 1;
```

**Group addresses** (resueltos at query time): `@all`, `@idle`, `@claude`, `@codex`, `@opencode`, `@worktree:<id>`. Implementación en `src/core/orchestration/groups.ts`.

**CLI verbs:**

```bash
# Mensajería
apohara orchestration send --to @coordinator --type worker_done \
  --subject "task-42 done" --payload @result.json
apohara orchestration check --types worker_done,escalation
apohara orchestration check --wait --types worker_done --timeout-ms 300000
apohara orchestration reply --to-message-id 123 --body "ack"
apohara orchestration inbox --unread

# Tasks
apohara orchestration task-create --spec @task.json [--parent <id>] [--deps <id>,<id>]
apohara orchestration task-list [--status pending] [--format json]
apohara orchestration task-update <id> --status completed --result @result.json

# Dispatch
apohara orchestration dispatch <task_id> --to agent:claude:task-42
apohara orchestration dispatch-show <dispatch_id>

# Gates
apohara orchestration gate-create --blocked <task_id> --blocking <task_id> \
  --reason "writes ∩ reads on createUser" --overlap @symbols.json
apohara orchestration gate-resolve <gate_id>
apohara orchestration gate-list [--status open]

# Coordinator
apohara orchestration run [--reset]
apohara orchestration run-stop
apohara orchestration reset
```

**Dispatch preamble** (template completo en `src/core/orchestration/preamble.ts`):

```ts
export function buildDispatchPreamble(opts: {
  taskId: string;
  dispatchId: number;
  coordinatorHandle: string;
  taskSpec: TaskSpec;
  baseDrift?: { commitsBehind: number; recentSubjects: string[] };
}): string {
  return `# Apohara Worker Dispatch

You are a worker agent. You were spawned by the Apohara coordinator
to complete a specific task. Your coordinator handle is \`${opts.coordinatorHandle}\`.
Your task id is \`${opts.taskId}\`. Your dispatch id is \`${opts.dispatchId}\`.

## Communication protocol

**You MUST NOT use \`AskUserQuestion\`** — the user is not watching this pane;
the coordinator is. Use these CLI commands instead:

- \`apohara orchestration send --to ${opts.coordinatorHandle} --type worker_done --payload @result.json\`
- \`apohara orchestration send --to ${opts.coordinatorHandle} --type heartbeat\`  (every 5min)
- \`apohara orchestration ask --to ${opts.coordinatorHandle} --question "..." --options "yes,no,defer"\`

## Your task

${opts.taskSpec.description}

### Symbols you declared

reads: ${opts.taskSpec.symbols.reads.map(s => \`\${s.file}::\${s.symbol}\`).join(', ') || '(none)'}
writes: ${opts.taskSpec.symbols.writes.map(s => \`\${s.file}::\${s.symbol}\`).join(', ') || '(none)'}
renames: ${opts.taskSpec.symbols.renames.map(s => \`\${s.file}::\${s.symbol}\`).join(', ') || '(none)'}

If you find yourself needing to touch a symbol outside this declaration,
STOP and emit a \`coord_manifest_drift\` message — do not proceed silently.

${opts.baseDrift ? \`
## BASE DRIFT WARNING

Your worktree base is \${opts.baseDrift.commitsBehind} commits behind origin.
Recent commits you do NOT have:
\${opts.baseDrift.recentSubjects.map(s => \`  - \${s}\`).join('\\n')}

Proceed with caution. If your changes conflict, the consolidator will fail-merge.
\` : ''}
`;
}
```

**`check --wait` heartbeat pattern:** ver implementación detallada en design notes. Heartbeat JSON cada 15s a stderr para que Claude Code Bash tool no auto-backgroundee el subprocess.

**Circuit breaker:** si `dispatch_contexts.status='failed' >= 3` veces seguidas para una task → fail la task. Implementado en el dispatch flow del scheduler.

**Drift detection:** `DISPATCH_STALE_THRESHOLD = 20`. Si `git rev-list --count HEAD..origin/base >= 20` → refuse dispatch a menos que `spec.allowStaleBase === true`.

**Tests TS:**

- `db_schema.test.ts`, `message_send_check.test.ts`, `check_wait_heartbeat.test.ts`, `circuit_breaker.test.ts`, `decision_gates.test.ts`, `dispatch_preamble.test.ts`, `drift_probe.test.ts`, `concurrent_writes.test.ts`

### §3.6.1 `availableActions[]` como contrato universal (de agentrail)

**Regla:** TODA response del coordinator (task list, task detail, dispatch response, gate state, mesh verdict, consolidation result) trae un campo `available_actions: Vec<ActionVerb>` con un vocabulario CERRADO. El agente NUNCA infiere su siguiente paso del status crudo — lo lee del campo.

**Enum Rust + serde discriminated union:**
```rust
// crates/apohara-types/src/action_verb.rs
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum ActionVerb {
    // Task lifecycle
    Start,           // Start a fresh attempt
    Resume,          // Resume in-progress dispatch
    Submit,          // Finish the code change, leave worktree changes, write result file, report completion
    Fix,             // Fix based on latest CI/review feedback, then report completion
    Ship,            // Open PR + merge_ready signal to coordinator
    ResolveBlocker,  // Report what is blocked and what user action is required

    // Verification flow
    AwaitJudge,      // Block, wait for judge verdict
    AwaitCritic,     // Block, wait for critic verdict
    RetryAttempt,    // Spawn a fresh attempt (clear previous failure context)
    EscalateToHuman, // Out of automated options, surface to operator

    // Coordination
    Continue,        // Continuation turn at same session (1s delay, see §3.8)
    Abort,           // Hard stop, cleanup workspace
    Block,           // Move to blocked queue with reason

    // Github bridge
    OpenPr,
    UpdatePr,
    ClosePrAndRollback,
}

impl ActionVerb {
    /// Human-readable label que el agent CLI puede meter directo en su prompt
    pub fn label(&self) -> &'static str {
        match self {
            ActionVerb::Submit => "Finish the code change, leave worktree changes in place, write the result file, then report completion.",
            ActionVerb::Fix => "Fix the task based on the latest CI or review feedback, then report completion.",
            ActionVerb::Ship => "Open a PR with your changes and emit merge_ready to the coordinator.",
            ActionVerb::ResolveBlocker => "Report what is blocked and what user action is required.",
            ActionVerb::AwaitJudge => "Block your execution and wait for the judge verdict before continuing.",
            ActionVerb::Continue => "The previous turn completed normally — resume from current workspace state without restating the task.",
            ActionVerb::EscalateToHuman => "Stop. Out of automated options. Notify the operator via the orchestration message bus.",
            // ... etc
            _ => "Unknown action — consult `apohara run actions` for the canonical label.",
        }
    }
}
```

**Aplicación en respuestas:**
```ts
// src/core/orchestration/responses.ts
interface TaskListResponse {
  tasks: Task[];
  available_actions: ActionVerb[];  // ["start"] si hay readyTasks, ["resume"] si hay dispatched
}

interface MeshVerdictResponse {
  verdict: "approved" | "rejected" | "needs_revision";
  judge_reasoning: string;
  critic_reasoning: string;
  available_actions: ActionVerb[];  // ["submit"|"ship"] si approved, ["fix"|"retry_attempt"] si rejected
}

interface DecisionGateResponse {
  gate: DecisionGate;
  available_actions: ActionVerb[];  // ["await_judge"|"resolve_blocker"|"escalate_to_human"]
}
```

**`actionsForDecision(outcome)` helper:**
```rust
// crates/apohara-types/src/action_routing.rs
pub fn actions_for_outcome(outcome: VerdictOutcome) -> Vec<ActionVerb> {
    match outcome {
        VerdictOutcome::Approved => vec![ActionVerb::Submit, ActionVerb::Ship],
        VerdictOutcome::ChangesRequested => vec![ActionVerb::Fix],
        VerdictOutcome::Blocked { .. } => vec![ActionVerb::ResolveBlocker, ActionVerb::EscalateToHuman],
        VerdictOutcome::NeedsMoreContext => vec![ActionVerb::Continue, ActionVerb::AwaitJudge],
    }
}
```

**Por qué:** loop determinístico entre orchestrator y providers. Logs/replay legibles. Menor probabilidad de "agent invents work". El campo es self-documenting: `apohara run actions` lista las que aplican AHORA. (Pattern de agentrail #1).

### §3.6.2 Run context envelope con action labels (de agentrail)

**Endpoint** `/agent-runs/{runId}/context` retorna envelope con:
- `run` (run_id, agent_id, runner, task_id, worktree_path, branch_name)
- `task` (id, identifier, title, description, status, acceptance_criteria, available_actions)
- **`next_actions: Vec<{id: ActionVerb, label: String}>`** — labels human-readable listos para meter en un prompt

**File-based fallback:** `APOHARA_RUN_CONTEXT_PATH=~/.apohara/runs/<run_id>/context.json` con el envelope completo. El wrapper-CLI puede leerlo sin necesidad del MCP server.

**Comandos CLI:**
```bash
apohara run current                # Imprime el envelope actual (humano)
apohara run current --json         # JSON parseable
apohara run actions                # Lista ActionVerb + label
apohara run actions --filter approved   # Solo las que aplican post-verdict
apohara agent report --result @result.json   # Worker emite worker_done con result
```

**Scope limitado al run:** el child NO puede listar OTHER tasks vía este endpoint. Internal MCP server `apohara.runs` aplica auth scope `run:<run_id>` al bearer token del child. Permite child runs sin credenciales globales — security baseline.

**Replay-friendly:** el `context.json` es la captura exacta de lo que recibió el agent. Reproduce el run inspeccionando los context.json secuenciales.

**Por qué:** child no puede leer tasks que no le pertenecen (security). Token economy: prompt no incluye toda la API surface, solo "your assignment + how to proceed". Replayable. (Pattern de agentrail #14).

### §3.7 Three state machines separadas (de symphony)

Diferencia rígida entre tres state machines independientes:

```
┌─────────────────────────────────────────────────────────────┐
│ Orchestration Claim States (interno scheduler)              │
│ Unclaimed → Claimed → Running → RetryQueued → Released      │
│         └→ Blocked (cuando agent pide input/approval)       │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│ Run Attempt Lifecycle (por intento)                          │
│ PreparingWorkspace → BuildingPrompt → LaunchingAgentProcess │
│ → InitializingSession → StreamingTurn → Finishing           │
│ → Succeeded | Failed | TimedOut | Stalled | CanceledByReconciliation │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│ External Tracker State (GitHub/Linear/SPEC.md)               │
│ Todo | InProgress | InReview | Blocked | Done | Cancelled    │
└─────────────────────────────────────────────────────────────┘
```

**Tablas separadas en orchestration DB:**
```sql
CREATE TABLE orchestrator_claims (
    task_id TEXT PRIMARY KEY,
    claim_state TEXT CHECK(claim_state IN ('unclaimed','claimed','running','retry_queued','blocked','released')),
    claim_token TEXT,  -- random UUID at claim time, validated on release
    claimed_at INTEGER,
    released_at INTEGER
);

CREATE TABLE run_attempts (
    attempt_id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT REFERENCES tasks(id),
    phase TEXT CHECK(phase IN (
        'preparing_workspace','building_prompt','launching_agent_process',
        'initializing_session','streaming_turn','finishing',
        'succeeded','failed','timed_out','stalled','canceled_by_reconciliation'
    )),
    started_at INTEGER,
    finished_at INTEGER,
    error TEXT,
    failure_reason TEXT  -- categorized: iteration_limit | agent_fallback_message | api_invalid_request | codex_semantic_inactivity | stalled
);
```

**Regla crítica: `Succeeded` NO es terminal desde el orchestrator.** Después de salida normal del worker, el orchestrator programa una **continuation retry** corta (1s) que vuelve a chequear el tracker para decidir si arrancar otro turn. Es decir, success ≠ done. Ver §3.8 para continuation vs failure retry.

### §3.8 Continuation vs Failure retry semánticos (de symphony)

Retry scheduler con **dos clases de delay**:

| Retry kind | Delay | Trigger |
|---|---|---|
| `RetryReason::Continuation` | fixed `1000ms` | salida normal del worker, re-checkear si issue sigue activo |
| `RetryReason::TransientFailure` | exponential `min(10000 * 2^(attempt-1), max_retry_backoff_ms)` cap 5min | timeout, crash, network error |
| `RetryReason::StallDetected` | exponential cap 5min | reconciliation pass detectó stall |
| `RetryReason::ProviderError` | exponential cap 5min | provider reportó error explícito |

**Continuation vs failure prompt template difiere:**
- **First turn**: full rendered prompt + dispatch preamble
- **Continuation turns**: solo continuation guidance — "the previous turn completed normally, resume from current workspace state, don't restate task" — al mismo live session. La conversación con el agent se preserva.

```rust
// crates/apohara-scheduler/src/retry.rs
pub enum RetryReason { Continuation, TransientFailure, StallDetected, ProviderError }

pub fn next_retry_delay(reason: RetryReason, attempt: u32, cap_ms: u64) -> Duration {
    match reason {
        RetryReason::Continuation => Duration::from_millis(1000),
        _ => Duration::from_millis(
            (10_000u64 * 2u64.pow(attempt - 1)).min(cap_ms)
        ),
    }
}
```

**Por qué:** throughput dramáticamente mejor en tasks largas (donde 80% de los "agent exits" son continuation-eligibles, no fallas). Mezclar ambos en un único exponential backoff causa loops innecesariamente lentos para tasks legítimas en progress.

### §3.9 "Blocked" como primary state (de symphony)

Cuarto estado primario distinto de `Retrying`:

**Definición:** cuando una session emite `:turn_input_required`, `:approval_required`, o un MCP elicitation request, el orchestrator NO retry — sino que mueve la task a `state.blocked` (map separado de `running` y `retry_attempts`). La task sigue claimed (no se vuelve a despachar) pero ya no consume worker slot.

```rust
pub enum BlockedReason {
    ApprovalRequired { tool_name: String, tool_input: serde_json::Value },
    UserInputRequired { question: String, options: Vec<String> },
    McpElicitation { server: String, schema: serde_json::Value },
    StalledAfterInputRequest { since: SystemTime },
    ProviderRejected { reason: String },
    SandboxInfrastructureFailure { failure_count: u32 },  // from §3.9 reclaim policy
}
```

**Reconciliation pass dedicado** `reconcile_blocked_issues`:
- Chequea si el tracker state cambió: terminal → release; non-active → release; sigue active → keep blocked
- Blocked entries son **in-memory only** — restart limpia el map y la task se vuelve candidate de dispatch otra vez (consistencia con "scheduler state is in-memory by design")

**UI impact (TaskBoard kanban):**
- Nueva columna **"Blocked / Needs Operator"** entre "Running" y "Review"
- Smart Attention pasa de "scoring de prioridades" a "blocked queue es siempre top priority" + scoring para el resto
- Force-resolve action: usuario aprueba/rechaza el approval request directamente desde la card

### §3.10 Reconciliation passes por tick (de symphony)

Cada poll tick ejecuta reconciliation **antes** del dispatch loop, en este orden estricto:

**Pass A — Stall detection (`reconcile_stalled_running_issues`):**
Por cada running task, calcula `elapsed_ms` desde `last_hook_timestamp` (último evento del agent-hooks server) o `started_at` si nunca emitió evento. Si excede `codex.stall_timeout_ms` (default 5min) → mata el worker + schedule retry con `RetryReason::StallDetected`. Si `stall_timeout_ms ≤ 0` → skip detection.

**Pass B — Tracker state refresh:**
Fetch states para todos los running task IDs vía github-bridge o tracker adapter. Por cada:
- Terminal state (closed/merged/cancelled) → kill worker + cleanup workspace + release claim
- Still active → update in-memory task snapshot
- Neither active nor terminal (ej. "Human Review") → kill worker **sin** cleanup workspace (preserve para inspección)

**Pass C — Missing-issue cleanup:**
Si un running task ID no apareció en el fetch results → asume task fue borrada/oculta → terminate run + release claim.

**Pass D — Drift detection (post-execution verification):**
Por cada task que llegó a `Succeeded`, ejecutar `gitnexus_detect_changes` comparando symbols modificados vs declarados en `TaskSymbolManifest`. Si discrepan → emit `coord_manifest_drift` + degrade reputation del provider en capability-stats (Thompson Sampling lo penaliza).

**Pass E — Blocked reconciliation (de §3.9):**
Por cada blocked task, chequear si el bloqueo se resolvió externamente (user aprobó vía CLI, tracker state cambió, etc.).

**Failure behavior:** si state refresh falla, **mantiene workers running** (no provoca crashes) y reintenta next tick.

### §3.11 PathSafety con symlink-escape detection (de symphony)

Tres invariantes formales que TODO worker debe cumplir:

1. `cwd == workspace_path` antes de lanzar el agent subprocess
2. `workspace_path` debe tener `workspace_root` como prefix **después de canonicalización** (resolver symlinks segment-by-segment)
3. Workspace dir name sólo `[A-Za-z0-9._-]`, demás chars → `_`

**Implementación detallada:**

```rust
// crates/apohara-pathsafety/src/lib.rs
use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum PathSafetyError {
    #[error("path escapes workspace root: canonical={canonical:?} root={root:?}")]
    EscapesRoot { canonical: PathBuf, root: PathBuf },

    #[error("symlink escapes workspace root: surface={surface:?} target={target:?}")]
    SymlinkEscape { surface: PathBuf, target: PathBuf },

    #[error("invalid chars in identifier: {0}")]
    InvalidCharsInIdentifier(String),

    #[error("path equals root (not a sub-path)")]
    EqualToRoot,
}

/// Canonicalización segment-by-segment con detección de symlink escape.
pub fn canonicalize_recursive(path: &Path, max_depth: u32) -> Result<PathBuf, PathSafetyError> {
    // Recorre cada segmento; lstat + readlink; detecta cycles via depth limit
    // Crucial: detecta "el path parece estar dentro del root pero al resolver symlinks escapa"
    // como SymlinkEscape, distinto de EscapesRoot.
    unimplemented!()
}

pub fn validate_cwd(workspace: &Path, workspace_root: &Path) -> Result<(), PathSafetyError> {
    let canonical_ws = canonicalize_recursive(workspace, 32)?;
    let canonical_root = canonicalize_recursive(workspace_root, 32)?;
    if canonical_ws == canonical_root {
        return Err(PathSafetyError::EqualToRoot);
    }
    if !canonical_ws.starts_with(&canonical_root) {
        return Err(PathSafetyError::EscapesRoot { canonical: canonical_ws, root: canonical_root });
    }
    Ok(())
}

pub fn safe_identifier(s: &str) -> String {
    s.chars().map(|c| if c.is_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '_' }).collect()
}
```

**Pre-launch validation:** antes de cada CLI provider invocation, `validate_cwd(&task.workspace, &config.workspace_root)?` — falla la task, no el orchestrator.

**Por qué:** defensa real contra symlink attacks que un container sandbox no cubre (porque el container ya está dentro del workspace root del host). Un agent malicioso (o mal-prompt) puede pedir al provider hacer `cd /tmp/../../etc` o usar symlinks plantados.

### §3.12 Riesgos del coordinator

Ver §10 (riesgos del proyecto entero) para R2 (decomposer manifests incorrectos), R4 (refactor regression), R5 (DB lock contention).

---

## §4 TaskBoard kanban view

Arquitectura modular **hooks-per-concern** adoptada de orca. Mucho más testeable y replicable que un componente monolítico.

### Estructura del componente

```
packages/desktop/src/components/TaskBoard/
├── TaskBoard.tsx
├── TaskBoardLane.tsx
├── TaskBoardCard.tsx
├── TaskBoardDrawer.tsx
├── TaskBoardColumnHeader.tsx
├── PlansPanel.tsx
├── AgentConfigPanel.tsx
└── hooks/
    ├── use-taskboard-pointer-drag.ts
    ├── use-taskboard-area-selection.ts
    ├── use-taskboard-shift-wheel-scroll.ts
    ├── use-taskboard-column-resize.ts
    ├── use-taskboard-outside-dismiss.ts
    ├── use-taskboard-selection.ts
    ├── use-taskboard-smart-attention.ts
    └── use-taskboard-store.ts        ← lee del MISMO store del DAG
```

### Columnas

Mapean directo a `tasks.status` de la orchestration DB: Pending, Ready, Dispatched, In Verification, Done, Failed, Blocked + columnas custom user-defined persistidas en `.apohara/settings.json`.

### Smart Attention class (de orca)

4 niveles ordinales para sort default:

1. **Needs you** (blocked/waiting hook + title-heuristic `permission`)
2. **Done** (no interrupted)
3. **Working**
4. **Idle**

Min-of-pane-classes (pane más urgente promueve worktree). Hook authority **per-pane** (un worktree puede tener Claude en pane A con hook fresh y un OpenCode en pane B sin hook). `attentionTimestamp` con semánticas distintas por clase. Defensive guards contra `NaN`/`Infinity`. `interrupted` `done` se degrada a idle.

### Cada card muestra

- Title
- Agent (icon: Claude/Codex/OpenCode) + worktree slug
- Duration + cost ticker
- Reason si blocked (overlap symbols + waiting_for task)
- Acciones: Force fail (con confirm dialog + preserve worktree), Retry, Open drawer

### Drawer (al click)

- Spec (description + agentRole + symbols con highlight diff vs lo que tocó)
- Hook events (lista cronológica en virtual list)
- Verification mesh decisions (judge + critic + INV-15 status)
- Decision gates (las que esta task abrió o que la bloquean)
- Worktree info (path, branch, dirty/clean, commits ahead/behind base)
- Ledger replay button

### Plans Panel (sidebar derecho)

Sumás de nimbalyst: lista de plan documents (SPEC.md files con frontmatter), filters por `planStatus`/priority/owner/tags, click → abre el SPEC.md en Monaco, cada plan muestra `planStatus.agentSessions` (qué runs Apohara lanzaron contra él).

### Agent Config Panel (sidebar izquierdo)

Read-only durante run activo. Muestra MCP config resuelta de cada agent (qué tools tiene disponibles, en qué scopes).

### Toggle Graph/Board

Ambas vistas leen del **mismo store** (regla del prompt original): `useTaskboardStore()` internally selecta `useDagStore(state => state.tasks)`. No duplicación de fuente de verdad.

### Tests E2E (Playwright)

`toggle_graph_board.spec.ts`, `force_fail_preserves_worktree.spec.ts`, `multi_select_bulk_archive.spec.ts`, `smart_attention_sort.spec.ts`, `plans_panel_filter.spec.ts`, `custom_column.spec.ts`.

---

## §4.5 Provider architecture refactor

Refactor previo a tocar el roster del paso 4. Sin este, agregar/quitar providers genera divergencia entre cada uno.

### Topología

```
src/core/providers/
├── BaseAgentProvider.ts
├── deps.ts                           ← static DI bucket
├── protocols/
│   ├── AgentProtocol.ts
│   ├── ClaudeCodeProtocol.ts
│   ├── CodexProtocol.ts
│   └── OpenCodeProtocol.ts
├── parsers/
│   ├── IRawMessageParser.ts
│   ├── ClaudeRawParser.ts
│   ├── CodexRawParser.ts
│   └── OpenCodeRawParser.ts
├── mixins/
│   ├── ProviderPermissionMixin.ts
│   └── ProviderSessionManager.ts
├── streams/
│   ├── persistentStdin.ts
│   └── envSanitizer.ts
├── agent-config.ts                   ← TUI_AGENT_CONFIG matrix
└── trust-presets.ts                  ← writers para pre-aceptar trust files
```

### `BaseAgentProvider` (abstract)

Centraliza: abort controllers, session mapping, permission lifecycle, polling cross-pane, static DI, env sanitization en spawn, trust preset application, persistent stdin pattern.

### `AgentProtocol` (interface)

```ts
export interface AgentProtocol {
  createSession(opts: CreateSessionOpts): Promise<SpawnedSession>;
  resumeSession(sessionId: ProviderSessionId): Promise<SpawnedSession>;
  forkSession(sessionId: ProviderSessionId, atTurn: number): Promise<SpawnedSession>;
  sendMessage(sessionId: ProviderSessionId, msg: Message): AsyncIterable<ProtocolEvent>;
  abortSession(sessionId: ProviderSessionId): Promise<void>;
}

export type ProtocolEvent =
  | { kind: 'text'; content: string; turn: number }
  | { kind: 'tool_call'; toolName: string; toolInput: unknown; toolCallId: string }
  | { kind: 'tool_result'; toolCallId: string; output: unknown; durationMs: number }
  | { kind: 'reasoning'; content: string; effortLevel?: 'low'|'medium'|'high' }
  | { kind: 'usage'; stepUsage: TokenUsage; cumulativeUsage: TokenUsage }
  | { kind: 'compact_boundary' }
  | { kind: 'permission_request'; toolName: string; input: unknown }
  | { kind: 'complete'; reason: 'finished' | 'interrupted' | 'error' };
```

### `agent-config.ts` (TUI_AGENT_CONFIG)

```ts
export const AGENT_CONFIG: Record<ProviderId, AgentConfig> = {
  'claude-code-cli': {
    binary: 'claude',
    promptInjectionMode: 'argv',
    draftPromptFlag: '--prefill',
    draftPasteReadySignal: 'PromptReady',
    preflightTrust: 'claude',
    hookConfigPath: '~/.claude/settings.json',
    hookConfigShape: 'json',
    hookScriptName: 'apohara-claude-hook',
  },
  'codex-cli': {
    binary: 'codex',
    promptInjectionMode: 'flag-prompt-interactive',
    preflightTrust: 'codex',
    hookConfigPath: '~/.codex/config.toml',
    hookConfigShape: 'toml',
    hookScriptName: 'apohara-codex-hook',
  },
  'opencode-go': {
    binary: 'opencode',
    args: ['--pure'],
    promptInjectionMode: 'stdin-after-start',
    preflightTrust: null,
    hookConfigPath: '~/.opencode/settings.json',
    hookConfigShape: 'json',
    hookScriptName: 'apohara-opencode-hook',
  },
};
```

### `trust-presets.ts`

Writers per agente: `writeClaudeTrust`, `writeCodexTrust`. Atomic JSON/TOML writes.

### `AgentMessageWriteQueue` (lección de nimbalyst para el ledger)

Coalescing 200ms idle / 200 rows. Pressure logging cuando depth > 500 o flush > 200ms. `enqueueAwaited()` bypass para writes user-critical.

### `persistentStdin.ts`

`AsyncIterable` infinito controlado por `PromptStreamController.end(reason)`. Evita bug nimbalyst-documented donde SDK cierra stdin pipe mid-turn y rompe `can_use_tool` tardíos.

### Migration plan

1. Crear `BaseAgentProvider` + `AgentProtocol` + utilities (sin tocar existente)
2. Re-implementar `ClaudeCodeProvider` extendiendo `BaseAgentProvider`. Tests verdes.
3. Re-implementar `CodexProvider` igual. Tests verdes.
4. Re-implementar `OpenCodeProvider` igual. Tests verdes.
5. Cambiar `src/providers/router.ts` para usar la nueva interfaz. 18 legacy providers quedan con su shape actual detrás de `APOHARA_LEGACY_PROVIDERS=1`.
6. Eliminar código deprecated post-validación.

### Tests TS

`BaseAgentProvider.spawn_env_sanitization.test.ts`, `BaseAgentProvider.session_mapping.test.ts`, `agent_config_validation.test.ts`, `trust_presets_idempotent.test.ts`, `persistent_stdin.test.ts`, `event_write_queue_coalescing.test.ts`, `event_write_queue_awaited_bypass.test.ts`.

### §4.5.1 Capabilities-based feature flags + `enum_dispatch` (de vibe-kanban)

Cada provider declara su capability set. UI consulta `provider.capabilities()` para mostrar/ocultar features sin hardcodear "claude soporta esto, codex no":

```rust
// crates/apohara-providers/src/capabilities.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
pub enum Capability {
    // Session control
    SessionFork,             // /fork, /branch dentro del CLI
    SessionResume,           // resume from previous session id
    SetupHelper,             // /init, /onboarding flow

    // Context
    ContextUsage,            // emite token count + context_window
    CompactBoundary,         // emite event when /compact runs

    // Tools
    NativeMcpTools,          // soporta MCP server discovery via stdio
    SlashCommands,           // soporta /command1, /command2 inside session
    BashTool,                // tiene Bash tool nativo (NO necesitamos wrapper)
    EditTool,                // tiene Edit tool nativo
    ReadTool,                // tiene Read tool nativo

    // Communication
    JsonStream,              // emite events JSON line-framed (NO ANSI scraping)
    StderrStructured,        // structured events via stderr (no contamina stdout)
    OscTitleUpdates,         // emite OSC title strings (orca fallback parser)

    // Workflows
    AskUserQuestion,         // tiene primitive de prompt user (Apohara redirige a coordinator)
    PermissionRequest,       // emite events de permission_request (Apohara responde via patterns)

    // Apohara-specific
    AgentHooks,              // soporta hook scripts (PreToolUse/PostToolUse) — Claude sí, Codex sí, OpenCode depende
    RosterHardening,         // honora rosters
    DriftDetection,          // emite manifest_drift on out-of-scope edits
    ApoharaIntegrations,     // soporta los 4 internal MCP servers (apohara.*)
}

#[enum_dispatch]
pub enum Provider {
    Claude(ClaudeCodeProvider),
    Codex(CodexProvider),
    OpenCode(OpenCodeProvider),
}

#[enum_dispatch(Provider)]
pub trait ProviderExecutor {
    fn id(&self) -> &'static str;
    fn binary(&self) -> &'static str;
    fn spawn(&self, opts: SpawnOpts) -> Result<SpawnedSession>;
    fn parse_output(&self, raw: &str) -> Vec<ProtocolEvent>;
    fn capabilities(&self) -> Vec<Capability>;
    fn default_pure_profile(&self) -> serde_json::Value;
    fn validate_command(&self, argv: &[String]) -> Result<(), ValidationError>;
}

// Implementación per provider:
impl ProviderExecutor for ClaudeCodeProvider {
    fn capabilities(&self) -> Vec<Capability> {
        vec![
            Capability::SessionFork,
            Capability::SessionResume,
            Capability::ContextUsage,
            Capability::CompactBoundary,
            Capability::NativeMcpTools,
            Capability::SlashCommands,
            Capability::BashTool,
            Capability::EditTool,
            Capability::ReadTool,
            Capability::JsonStream,
            Capability::StderrStructured,
            Capability::OscTitleUpdates,
            Capability::AskUserQuestion,
            Capability::PermissionRequest,
            Capability::AgentHooks,
            Capability::RosterHardening,
            Capability::DriftDetection,
            Capability::ApoharaIntegrations,
        ]
    }
    // ...
}
```

**Frontend usage:**
```tsx
// packages/desktop/src/components/TaskBoard/TaskBoardCard.tsx
const provider = useProvider(task.assignedProviderId);
const canFork = provider.capabilities.includes('SessionFork');
const canShowContextMeter = provider.capabilities.includes('ContextUsage');

return (
  <Card>
    {/* ... */}
    {canFork && <ForkButton task={task} />}
    {canShowContextMeter && <ContextMeter task={task} />}
  </Card>
);
```

**Reason:** evita allocations vs `Box<dyn ProviderExecutor>`. Exhaustive match enforced. UI no muestra botones que el provider no soporta. (Pattern de vibe-kanban #15 + #16).

### §4.5.2 Adversarial review system reminders + maxRounds + escalation (de Chorus + symphony)

**System reminders críticos** en el prompt del judge/critic — enumera rationalizations típicas que el LLM debe reconocer en sí mismo:

```ts
// src/core/verification-mesh/prompts/critic.ts
export const CRITICAL_SYSTEM_REMINDER = `
You are reviewing code written by another AI agent. RECOGNIZE YOUR OWN RATIONALIZATIONS:

1. **"The code looks correct based on my reading"** — reading is NOT verification. You must
   identify CONCRETE evidence (test names that exist, file lines you can quote, hash digests
   in the ledger). If you cannot quote evidence, downgrade to NOTE.

2. **"Seduced by 80%"** — if you find yourself thinking "the implementation handles most cases",
   STOP. List the cases it doesn't handle as BLOCKERs.

3. **"Verification avoidance"** — if you're tempted to skip running the suggested test command
   because "the diff looks self-explanatory", that's the rationalization. RUN the test, quote
   the output.

4. **"This is a NOTE not a BLOCKER"** — apply the inverse test: if this issue causes a production
   incident in 6 months, is it because we missed BLOCKERs or because we ignored NOTEs? If the
   former, it's a BLOCKER.

5. **"Round-N free pass"** — in Round-N reviews, you may ONLY verify if Round-(N-1) BLOCKERs are
   resolved. You may NOT introduce new NOTEs in Round-N. Save them for the next attempt.

6. **HALLUCINATION_RISK flag** — flag ANY specific external detail that looks LLM-fabricated
   (API signatures, model IDs, SDK versions, CLI flags, config keys, endpoint paths). These get
   their own severity category between NOTE and BLOCKER (see §4.5.3).

TURN BUDGET RULE: when you have ≤3 turns remaining, STOP analyzing and post your partial findings
with explicit "INCOMPLETE: budget exhausted at <reason>". Better partial truth than no truth.

OUTPUT FORMAT: VERDICT block, capped at 800 chars:
- APPROVE | REQUEST_CHANGES | NEEDS_MORE_CONTEXT
- BLOCKERS: numbered list, each <100 chars
- NOTES: numbered list, each <100 chars
- HALLUCINATION_RISK: numbered list, each <100 chars
- EVIDENCE: file:line references or test names
`;
```

**maxRounds + escalation policy:**

```rust
// crates/apohara-verification/src/policy.rs
pub struct ReviewPolicy {
    pub max_proposal_review_rounds: u8,  // default 3
    pub max_task_review_rounds: u8,      // default 3
    pub max_compound_rounds: u8,         // default 5 (compound tasks need more)
    pub escalation_strategy: EscalationStrategy,
}

pub enum EscalationStrategy {
    /// Item flagged as ESCALATED, pipeline continues with rest (NOT halts).
    /// Final report lists ESCALATED items for human intervention.
    FlagAndContinue,

    /// Stop the entire pipeline if any item escalates.
    HaltOnFirstEscalation,

    /// Try escalation_count attempts then HaltOnFirstEscalation.
    EscalateThenHalt { escalation_count: u8 },
}

pub fn next_round_decision(
    current_round: u8,
    policy: &ReviewPolicy,
    findings: &[Finding],
) -> RoundDecision {
    let has_blockers = findings.iter().any(|f| f.severity == Severity::MustFix);
    if !has_blockers {
        return RoundDecision::Approve;
    }
    if current_round >= policy.max_task_review_rounds {
        return RoundDecision::Escalate {
            reason: format!("Exceeded {} review rounds with unresolved BLOCKERs", policy.max_task_review_rounds),
            findings: findings.to_vec(),
        };
    }
    RoundDecision::AnotherRound { reviewer_seed: random_seed() }
}
```

**Final report (per pipeline run):**
```
=== Apohara Run apohara-r-001 — Final Report ===

✅ Completed: 12 tasks
⚠️ Escalated: 3 tasks (require human intervention)
❌ Failed: 0 tasks

ESCALATED:
1. task-042 (refactor user auth): 3 review rounds, unresolved BLOCKER "SQL injection in updateUser line 47"
2. task-058 (add JWT): 3 review rounds, unresolved HALLUCINATION_RISK "claims uses jose@5.6 but jose is on 4.x"
3. task-061 (migration): 5 compound rounds, unresolved BLOCKER "rollback path not tested"

Resolve via:
  apohara task review-resume <task_id>
  apohara task force-approve <task_id> --reason "..." --reviewer <human>
```

**Por qué:** judge≠critic está arquitectónico, pero los prompts deben ser críticos para no rubber-stamp. "RECOGNIZE YOUR OWN RATIONALIZATIONS" enumera fallos típicos de auto-engaño LLM. Turn budget rule evita verificadores que se quedan sin tiempo y no entregan. maxRounds + FlagAndContinue evita que un task bloquee todo el DAG. (Pattern de Chorus #5 + #15 + symphony validation profiles).

### §4.5.3 Hallucination flag como categoría taxonómica (de Chorus)

**Nueva severity entre NOTE y BLOCKER:**

```rust
// crates/apohara-types/src/severity.rs
#[derive(Debug, Clone, Copy, PartialEq, Eq, Ord, PartialOrd, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum Severity {
    Note,                  // suggestion, can ship without fixing
    HallucinationRisk,     // LLM-fabricated external detail; needs verification (between NOTE and MUST_FIX)
    ShouldFix,             // strong suggestion, ship only with rationale
    MustFix,               // blocker, do NOT ship
}
```

**Detector check programático complementario:**

```rust
// crates/apohara-verification/src/hallucination_detector.rs
pub async fn verify_hallucination_risk(
    finding: &Finding,
    indexer: &IndexerClient,
) -> HallucinationVerdict {
    if let Some(api_sig) = finding.extract_api_signature() {
        let exists_in_docs = indexer.search_docs(&api_sig).await?;
        if !exists_in_docs {
            return HallucinationVerdict::Confirmed {
                api_sig,
                searched_sources: vec!["package.json", "node_modules/.../docs", "type definitions"],
            };
        }
    }
    if let Some(sdk_version) = finding.extract_sdk_version() {
        let actual_version = read_package_json_dep(&sdk_version.package).await?;
        if !semver_matches(&sdk_version.claimed, &actual_version) {
            return HallucinationVerdict::Confirmed {
                api_sig: format!("{}@{}", sdk_version.package, sdk_version.claimed),
                searched_sources: vec![format!("package.json says: {}", actual_version)],
            };
        }
    }
    HallucinationVerdict::CouldNotVerify
}
```

**Persistir en `agent-mistakes.md` log auto-poblado:**
```markdown
## 2026-05-21 — Agent hallucinated SDK version

**Run:** apohara-r-019
**Provider:** codex-cli
**HALLUCINATION_RISK confirmed by detector:**
- Agent code: `import { sign } from 'jose'; sign(payload, secret, { alg: 'HS256' })`
- Agent claimed: "jose@5.6 with sync API"
- Reality (package.json): jose@4.15.4
- The sync API does NOT exist in jose 4.x; the agent invented it

**Lesson:** Critic should verify ALL import statements against package.json before approving.
**Fix:** Strengthened critic prompt + added hallucination detector check.
```

**Por qué:** categoría taxonómica explícita para el bug class más común y menos cubierto por test suites. Permite tagging + métricas + retroalimentación al capability-manifest (provider con muchos HALLUCINATION_RISK confirmados → penalización Thompson Sampling). (Pattern de Chorus #6).

### §4.5.4 Dual-path acceptance criteria (de Chorus)

**Modelo:** cada `AcceptanceCriterion` tiene **dos trayectorias paralelas independientes**:

```sql
-- Extiende schema de orchestration DB:
CREATE TABLE acceptance_criteria (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id TEXT NOT NULL REFERENCES tasks(id),
    description TEXT NOT NULL,

    -- Claim path (judge — the implementer's evidence)
    claim_status TEXT CHECK(claim_status IN ('pending','claimed_satisfied','claimed_unsatisfied','claimed_partial')),
    claim_evidence TEXT,                  -- prose claim from judge
    claim_marked_by TEXT,                 -- judge agent id
    claim_marked_at INTEGER,

    -- Verify path (critic — the auditor's verification)
    verify_status TEXT CHECK(verify_status IN ('pending','verified','rejected','could_not_verify')),
    verify_evidence TEXT,                 -- file:line refs or test names from critic
    verify_marked_by TEXT,                -- critic agent id
    verify_marked_at INTEGER,

    -- Derived (computed reducer)
    final_status TEXT GENERATED ALWAYS AS (
        CASE
            WHEN verify_status = 'verified' AND claim_status = 'claimed_satisfied' THEN 'satisfied'
            WHEN verify_status = 'rejected' THEN 'rejected'
            WHEN claim_status != verify_status THEN 'drift_detected'  -- ← signal de hallucination
            WHEN verify_status = 'could_not_verify' THEN 'unverifiable'
            ELSE 'pending'
        END
    ) STORED
);
```

**Function `computeAcceptanceStatus` (pure reducer):**
```rust
pub fn compute_acceptance_status(
    criteria: &[AcceptanceCriterion],
) -> TaskAcceptanceStatus {
    let drift_count = criteria.iter().filter(|c| c.final_status == "drift_detected").count();
    let rejected_count = criteria.iter().filter(|c| c.final_status == "rejected").count();
    let satisfied_count = criteria.iter().filter(|c| c.final_status == "satisfied").count();

    if rejected_count > 0 || drift_count > 0 {
        TaskAcceptanceStatus::NotAccepted {
            reason: format!("{} rejected, {} drift detected", rejected_count, drift_count),
            requires_revision: true,
        }
    } else if satisfied_count == criteria.len() {
        TaskAcceptanceStatus::Accepted
    } else {
        TaskAcceptanceStatus::Pending { satisfied_count, total: criteria.len() }
    }
}
```

**UI Tauri:** TaskBoard drawer muestra tabla side-by-side con diff highlight cuando `claim_status` ≠ `verify_status`:

```
| Criterion | Claim (judge)        | Verify (critic)      | Status         |
|-----------|----------------------|----------------------|----------------|
| Returns 200 | ✅ claimed_satisfied | ✅ verified          | ✅ satisfied   |
| Returns 401 | ✅ claimed_satisfied | ❌ rejected (line 47 returns 403 not 401) | ❌ drift_detected |
| Expires 24h | ✅ claimed_satisfied | ⚠️ could_not_verify (no test for token expiration) | ⚠️ unverifiable |
```

**Por qué:** registra evidence dual con auditoría (quién marcó, cuándo, con qué evidencia textual) por cada criterio atómico. Permite detectar drift entre lo que el dev afirma vs lo que el verificador realmente comprobó — un mismatch dev/admin **ES** signal de hallucination. (Pattern de Chorus #4).

---

## §4.6 Permission system

Sistema de permission patterns con scopes + 3-tier settings hierarchy compatible con CLI Claude.

### Topología

```
src/core/safety/
├── patterns.ts
├── permissionService.ts
├── settingsHierarchy.ts
├── bashCompoundAnalyzer.ts
├── patternValidator.ts
└── permissionCache.ts
```

### Permission pattern grammar (compatible con CLI Claude nativo)

```
Bash(npm test:*)
Bash(git commit:*)
Bash(rm:*)                          # DANGER — never auto-approve
WebFetch(domain:github.com)
Edit(src/**)
Edit(*.env)                         # DANGER
mcp__apohara__*
```

### Scopes

| Scope | Storage | TTL |
|---|---|---|
| `once` | nada | 1 call |
| `session` | `permissionCache` in-memory `Set<Pattern>` | hasta restart |
| `always` | `.claude/settings.local.json` o `.claude/settings.json` | persistente |

### 3-tier settings hierarchy

```
~/.claude/settings.json              ← user-global (compartido con CLI Claude oficial)
.claude/settings.json                ← project-shared (commit to git)
.claude/settings.local.json          ← project-personal (gitignored)
```

Merge con `mergeWithDefaults` (§0.2 pattern). **Compatibilidad bidireccional**: si user ya tiene patterns aprobados via CLI Claude oficial, Apohara los honra. Si Apohara guarda un pattern, el CLI Claude oficial también lo honrará.

### `bashCompoundAnalyzer`

Defensive parser-aware split de `&&`, `||`, `;` (handles quotes, heredocs, command substitution). Cualquier compound NUNCA persiste como `always` — max scope es `session`.

### `patternValidator`

Rechaza garbage patterns como `Bash(const:*)`, `Bash([]:*)`, `Bash(\`\`\`:*)` que vienen de LLM output bleeding.

### Durable interactive prompts (de nimbalyst)

Permission requests + responses persistidos al ledger como source of truth. UI render-from-ledger, NUNCA desde local state. Beneficio: `apohara replay <run-id>` muestra TODOS los permission prompts con respuestas tal cual ocurrieron.

### Tests TS

`pattern_match.test.ts`, `bash_compound_split.test.ts`, `compound_never_always.test.ts`, `settings_hierarchy_merge.test.ts`, `garbage_pattern_rejected.test.ts`, `durable_prompt_replay.test.ts`, `permission_cache_session_isolation.test.ts`.

### §4.6.1 Runner execution policy presets (de agentrail)

**4 presets predefinidos + custom + 6 áreas formalizadas:**

```rust
// crates/apohara-sandbox/src/runner_policy.rs
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum PolicyPreset {
    Strict,             // Rechaza plans con cualquier `partial+critical` o `unsupported`
    Balanced,           // Default: enforced areas + advisory para non-critical
    Advisory,           // Logs violations pero NO bloquea (debugging mode)
    ExternalSandbox,    // Wrap con `bwrap`/`firejail` para isolation extra
    Custom(RunnerExecutionPolicy),
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct RunnerExecutionPolicy {
    pub filesystem: FsPolicy,
    pub network: NetPolicy,
    pub credentials: CredPolicy,
    pub publish: PublishPolicy,
    pub commands: CommandPolicy,
    pub external_sandbox: Option<ExternalSandboxConfig>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct FsPolicy {
    pub worktree_read: bool,                  // default true
    pub worktree_write: bool,                 // default true
    pub deny_globs: Vec<String>,              // ["AGENTS.md", "CLAUDE.md", ".env", ".env.local", ".apohara/**"]
    pub allow_outside_globs: Vec<String>,     // ["/tmp/apohara-*"]
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub enum NetPolicy {
    None,
    ApoharaLocalOnly,              // solo 127.0.0.1:* (agent-hooks, internal MCP)
    Allowlist { hosts: Vec<String> },
    Unrestricted,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CredPolicy {
    pub inherit: CredInherit,
    pub allow_env: Vec<String>,               // whitelist explícita (NO API keys)
    pub deny_env_patterns: Vec<String>,       // ["*TOKEN*", "*SECRET*", "*_API_KEY"]
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub enum CredInherit { None, Allowlist }

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub enum PublishPolicy {
    ApoharaOwned,    // Solo Apohara puede `git push` / `gh pr create`
    DirectAllowed,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CommandPolicy {
    pub deny_list: Vec<String>,               // ["git push", "gh pr create", "apohara tasks ship", "rm -rf /"]
    pub require_confirmation: Vec<String>,    // ["rm -rf", "git reset --hard", "DROP TABLE"]
}
```

**Compile-time plan validation:**

```rust
pub fn compile_runner_execution_plan(
    policy: &RunnerExecutionPolicy,
    runner: &Runner,
) -> Result<ExecutionPlan, PolicyError> {
    let mut enforcement = Vec::new();

    enforcement.push(Enforcement {
        area: PolicyArea::Filesystem,
        strength: if runner.supports_fs_restrictions() { Strength::Enforced } else { Strength::Advisory },
        critical: policy.filesystem.deny_globs.iter().any(|g| g == "AGENTS.md" || g == "CLAUDE.md"),
    });
    enforcement.push(Enforcement {
        area: PolicyArea::Network,
        strength: match (&policy.network, runner.supports_network_isolation()) {
            (NetPolicy::None, true) => Strength::Enforced,
            (NetPolicy::None, false) => Strength::Unsupported,  // ← falla strict mode
            (NetPolicy::Allowlist { .. }, false) => Strength::Partial,
            _ => Strength::Enforced,
        },
        critical: matches!(policy.network, NetPolicy::None),
    });
    // ... mismo para Credentials, Publish, Commands, ExternalSandbox

    let unsupported_critical = enforcement.iter().any(|e| e.strength == Strength::Unsupported && e.critical);
    let partial_critical = enforcement.iter().any(|e| e.strength == Strength::Partial && e.critical);

    if matches!(policy, PolicyPreset::Strict) && (unsupported_critical || partial_critical) {
        return Err(PolicyError::StrictModeRejects { enforcement });
    }

    Ok(ExecutionPlan { policy: policy.clone(), runner: runner.clone(), enforcement })
}
```

**Filesystem snapshot SHA-256 antes/después:**

```rust
pub async fn snapshot_protected_paths(workspace: &Path) -> ProtectedFilesSnapshot {
    let mut snapshot = HashMap::new();
    for protected in &["AGENTS.md", "CLAUDE.md", ".apohara/**", ".env*"] {
        for path in glob(workspace.join(protected)).await? {
            let content = read_to_string(&path).await?;
            let sha = sha256(&content);
            snapshot.insert(path, (content, sha));
        }
    }
    ProtectedFilesSnapshot(snapshot)
}

pub async fn detect_violations_and_recover(
    pre: &ProtectedFilesSnapshot,
    workspace: &Path,
) -> Vec<PolicyViolation> {
    let post = snapshot_protected_paths(workspace).await;
    let mut violations = Vec::new();
    for (path, (pre_content, pre_sha)) in &pre.0 {
        if let Some((post_content, post_sha)) = post.0.get(path) {
            if pre_sha != post_sha {
                // Recovery: restaurar desde snapshot
                tokio::fs::write(path, pre_content).await.ok();
                violations.push(PolicyViolation::ProtectedFileModified {
                    path: path.clone(),
                    pre_sha: pre_sha.clone(),
                    post_sha: post_sha.clone(),
                    recovered: true,
                });
            }
        } else {
            // Archivo fue borrado
            tokio::fs::write(path, &pre.0[path].0).await.ok();
            violations.push(PolicyViolation::ProtectedFileDeleted { path: path.clone(), recovered: true });
        }
    }
    violations
}
```

**CLI flag:**
```bash
apohara run --runner-policy strict path/to/SPEC.md
apohara run --runner-policy balanced path/to/SPEC.md           # default
apohara run --runner-policy advisory path/to/SPEC.md           # debugging
apohara run --runner-policy external-sandbox --sandbox-cmd bwrap ...
```

**Por qué:** defense-in-depth contra agents que escriben en lugares prohibidos por accidente. Protección de archivos de instrucción del agent contra auto-modificación. Presets que permiten gradual rollout (`advisory` para debugging, `strict` para producción). Recovery automático si modifica AGENTS.md/CLAUDE.md. (Pattern de agentrail #8).

### §4.6.2 Domain-specific quality gates pre-judge (de claude-octopus)

**6 quality gates basados en heurísticas grep que se ejecutan ANTES del judge LLM** — filtran outputs claramente deficientes sin coste de inference:

```rust
// crates/apohara-verification/src/quality_gates/mod.rs
#[async_trait]
pub trait QualityGate: Send + Sync {
    fn name(&self) -> &'static str;
    fn applies_to(&self, task_role: &AgentRole, persona: &Option<Persona>) -> bool;
    async fn evaluate(&self, diff: &Diff, output: &str) -> GateResult;
}

pub enum GateResult {
    Pass,
    Block { reason: String, feedback_to_agent: String },
}
```

**Gates implementados (per-persona switching via `OCTOPUS_AGENT_PERSONA` env var equivalent):**

1. **ArchitectureGate** — `applies_to: persona ∈ {backend, db, cloud, deployment}`. Block si output NO contiene "trade-off rationale" + API contracts (backend) / migrations (db) / IaC (cloud) / CI-CD (deployment).
   ```rust
   if !output.contains("Trade-off") && !output.contains("Alternatives considered") {
       return GateResult::Block {
           reason: "Architecture task without trade-off rationale".into(),
           feedback_to_agent: "Add a ## Trade-offs section explaining your decision vs alternatives.".into(),
       };
   }
   ```

2. **SecurityGate** — `applies_to: task involves auth/crypto/input-validation`. Block si NO emite 2+ OWASP categorías + severity + remediation por finding.

3. **PerfGate** — `applies_to: task involves perf optimization`. Block si NO incluye ms/MB/req/s métricas + before/after benchmarks + optimization recommendations.

4. **CodeQualityGate** — Block si NO emite 2+ findings + severity levels + root cause.

5. **FrontendGate** — `applies_to: persona == frontend`. Block si NO menciona ARIA + viewport breakpoints (heurística grep `aria-`, `breakpoint`, `viewport`).

6. **SysadminSafetyGate** — Block siempre cualquier `rm -rf` no whitelisted, firewall disable, `curl | sudo sh`, etc.

**Wiring en verification-mesh:**

```rust
// src/core/verification-mesh.ts
async fn verify(task: &Task, diff: &Diff, output: &str) -> Verdict {
    // Pre-judge: cheap heuristic gates
    for gate in self.active_gates(task) {
        match gate.evaluate(diff, output).await {
            GateResult::Block { reason, feedback_to_agent } => {
                return Verdict::Rejected {
                    by: Reviewer::QualityGate(gate.name().into()),
                    reason,
                    feedback: feedback_to_agent,
                };
            }
            GateResult::Pass => continue,
        }
    }

    // Si pasa todos los gates, invocar judge LLM (caro)
    let judge_verdict = self.judge.verdict(task, diff, output).await?;
    // ... mesh continúa
}
```

**Apohara configura activación de gates per-task en SPEC.md:**
```yaml
# SPEC.md frontmatter
verification:
  gates:
    - security:owasp-coverage
    - perf:quantified-metrics
    - sysadmin-safety
  skip_gates_when:
    - "task.role == 'docs'"  # docs no necesita perf gates
```

**Por qué:** ahorra ~30% inference costs en outputs claramente incompletos. Per-persona switching via env es elegante. Heurísticas grep son baratas + interpretables + auditables. (Pattern de claude-octopus #5).

### §4.6.3 Strategy Rotation anti-loop (de claude-octopus)

**Tracker de failures consecutivos por tool en `/tmp/apohara-failures-<task_id>.json`:**

```rust
// crates/apohara-anti-thrash/src/lib.rs
pub struct FailureTracker {
    path: PathBuf,
    threshold: u32,  // default 2
}

#[derive(Serialize, Deserialize)]
struct FailureState {
    bash_failures: u32,
    edit_failures: u32,
    write_failures: u32,
    web_failures: u32,
    last_failure_at: Option<DateTime<Utc>>,
}

impl FailureTracker {
    pub async fn record_failure(&self, tool: ToolKind) -> Option<RotationAlert> {
        let mut state: FailureState = self.load().await.unwrap_or_default();
        let counter = match tool {
            ToolKind::Bash => &mut state.bash_failures,
            ToolKind::Edit => &mut state.edit_failures,
            ToolKind::Write => &mut state.write_failures,
            ToolKind::Web => &mut state.web_failures,
        };
        *counter += 1;
        state.last_failure_at = Some(Utc::now());
        self.save(&state).await?;

        if *counter >= self.threshold {
            Some(RotationAlert {
                tool,
                consecutive_failures: *counter,
                additional_context: format!(
                    "STRATEGY ROTATION NEEDED: The {} tool has failed {} consecutive times. \
                     You MUST try a fundamentally different approach. Do NOT retry the same \
                     command with minor variations. Consider: (a) using a different tool, \
                     (b) gathering more context first, (c) decomposing into smaller subtasks, \
                     (d) escalating to coordinator via `apohara orchestration ask`.",
                    tool, counter
                ),
            })
        } else {
            None
        }
    }

    pub async fn record_success(&self, tool: ToolKind) {
        let mut state = self.load().await.unwrap_or_default();
        match tool {
            ToolKind::Bash => state.bash_failures = 0,
            ToolKind::Edit => state.edit_failures = 0,
            ToolKind::Write => state.write_failures = 0,
            ToolKind::Web => state.web_failures = 0,
        }
        self.save(&state).await.ok();
    }
}
```

**Inyección al agent via additionalContext del hook:** cuando el PostToolUse hook detecta `record_failure` returning `Some(RotationAlert)`, emite el JSON con `additionalContext` (§0.18) para que el agente lea la rotation directive en su próximo turn.

**Escalación al scheduler:** si después de la rotation alert el agente intenta el MISMO approach (mismo tool con misma intent semántica), scheduler degrada la task a `needs_replan` y dispatch al decomposer para reformular con el contexto del failure.

**Por qué:** evita que agentes loopeen en el mismo error retry tras retry. Económico (no LLM call para detectar el loop). Portable, simple. (Pattern de claude-octopus #2).

---

## §5 `github-bridge` package (poll-only)

### Estructura

```
packages/github-bridge/
├── src/
│   ├── index.ts
│   ├── poller.ts             ← Bun.cron, cada 60s
│   ├── issue-parser.ts       ← GitHub Issue body → ObjectivePayload + SPEC.md detection
│   ├── pr-builder.ts
│   ├── github-app-auth.ts    ← GitHub App JWT + installation token caching (TTL 50min)
│   ├── webhook.ts            ← stub para v1.5
│   └── octokit-client.ts     ← wrapper con retry + rate-limit
├── tests/
└── package.json
```

### Flujo end-to-end

```
poller (Bun.cron 60s)
  → octokit.list_issues(label="apohara", state="open")
  → para cada issue no procesado:
    issue-parser.parse(issue.body) → ObjectivePayload | { ambiguous, missing }
    Si SPEC.md inline → planDocuments.parse
    Ambiguous → octokit.create_comment("needs clarification")
              → mark issue as `apohara-needs-input` label
    Else: orchestration.taskCreate({ spec, source: { kind: 'github', issue_id, repo } })

on worker_done:
  pr-builder.build({ runId, diff, ledgerHash })
    → octokit.create_pr (head: apohara/run-<runId>, base: default)
    → octokit.add_comment(issue, "Opened PR #N")

on run failed:
  → octokit.add_comment(issue, errorTemplate)
  → mark as `apohara-failed`
  → retry: user adds `apohara-retry` label → poller picks up
```

### Issue parser

Detecta SPEC.md inline (frontmatter YAML o `## SPEC` heading), o objetivo plano (primer párrafo + checklist). Si ambiguous, devuelve `{ kind: 'ambiguous', missing: [...] }`.

### PR body template

```
## Apohara · <objective.title>

**Run ID:** `<runId>`
**Agents:** claude · codex · opencode
**Verification:** judge=`<judge>` · critic=`<critic>`
**Replay:** `apohara replay <runId>` (ledger hash: `<hash>`)
**Plan:** [<plan.path>](<plan.url>) (si aplica)

### Changes
<diffSummary>

### Verification mesh result
- Judge: ✅ approved · <reasoning>
- Critic: ✅ approved · <reasoning>
- INV-15 JCR Safety Gate: ✅ not triggered | 🟡 fired

### Coordinator decisions
- Tasks dispatched: N
- Decision gates opened: M · resolved: M
- Worktree conflicts auto-resolved: K

🤖 Generated by Apohara v<version>
```

### Auth

GitHub App (no PAT). Permisos mínimos: `issues:write`, `pull_requests:write`, `contents:read`. App ID + private key en env vars. Installation token TTL 50min (refresh proactivo). Doc `docs/github-app-setup.md` con manifest JSON + screenshots.

### Tests

`issue_parser.test.ts`, `pr_builder.test.ts`, `poller_dedup.test.ts`, `webhook_disabled.test.ts`, `app_auth_refresh.test.ts`, `e2e_mock_octokit.test.ts`.

### §5.1 Idempotency-key embebido en PR body (de agentrail)

**Patrón:** al crear un PR, embedear `<!-- apohara-attempt: sha256:abc123 --> ` en el body. Antes de crear nuevo PR, listar PRs y buscar el marker — si lo encuentra, reutiliza el PR existente, no crea uno nuevo.

```ts
// packages/github-bridge/src/pr-idempotency.ts
const IDEMPOTENCY_TAG = 'apohara-attempt';

function embedIdempotencyKey(body: string, key: string): string {
  return `${body}\n\n<!-- ${IDEMPOTENCY_TAG}: ${key} -->`;
}

function extractIdempotencyKey(body: string): string | null {
  const match = body.match(new RegExp(`<!-- ${IDEMPOTENCY_TAG}: (\\S+) -->`));
  return match ? match[1] : null;
}

async function findPRByIdempotencyKey(repo: Repo, key: string): Promise<PR | null> {
  // Listar PRs abiertos + cerrados últimos 60 días con el marker
  const prs = await octokit.pulls.list({ ...repo, state: 'all', per_page: 100 });
  for (const pr of prs.data) {
    if (extractIdempotencyKey(pr.body ?? '') === key) {
      return pr;
    }
  }
  return null;
}

// Doble fallback:
async function findPRByHeadBranch(repo: Repo, head: string): Promise<PR | null> {
  const prs = await octokit.pulls.list({ ...repo, head, state: 'all' });
  return prs.data[0] ?? null;
}

async function findLinkedPRs(repo: Repo, issueNum: number): Promise<PR[]> {
  // regex: close[sd]?|fix(?:e[sd])?|resolve[sd]? + #issueNum
  const pattern = new RegExp(`\\b(close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#${issueNum}\\b`, 'i');
  const prs = await octokit.pulls.list({ ...repo, state: 'all' });
  return prs.data.filter(pr => pattern.test(pr.body ?? '') || pattern.test(pr.title));
}

async function createOrUpdatePR(repo: Repo, payload: PrPayload): Promise<PR> {
  // 1. Idempotency key derivado del attempt
  const key = `sha256:${sha256(`${payload.task_id}:${payload.attempt_number}:${payload.ledger_root}`)}`;
  const bodyWithKey = embedIdempotencyKey(payload.body, key);

  // 2. Buscar PR existente
  const existing = await findPRByIdempotencyKey(repo, key)
                 ?? await findPRByHeadBranch(repo, payload.head)
                 ?? (await findLinkedPRs(repo, payload.issue_num))[0];

  if (existing) {
    if (existing.state === 'closed' && existing.merged_at) {
      // PR ya merged; no recrear
      return existing;
    }
    // Actualizar PR existente
    return await octokit.pulls.update({ ...repo, pull_number: existing.number, body: bodyWithKey });
  }

  // 3. Crear nuevo PR con marker
  return await octokit.pulls.create({ ...repo, ...payload, body: bodyWithKey });
}
```

**Por qué:** submit retry-safe sin estado lateral. Resiliente a crashes entre "creé el PR" y "registré la creación". El attempt-id puede derivarse de `(task_id, attempt_number, ledger_root)`. GitHub no parsea el HTML comment; los humanos no lo ven. (Pattern de agentrail #3).

---

## §6 SPEC.md parser + roster hardening

### §6.1 Plan documents (`src/core/spec/`)

Schema (nimbalyst-inspired alineado con Symphony del prompt original):

```ts
export interface PlanDocument {
  planId: string;
  title: string;
  status: 'draft' | 'active' | 'paused' | 'done';
  planType?: 'feature' | 'bug' | 'refactor' | 'research';
  priority?: 'urgent' | 'high' | 'normal' | 'low';
  owner?: string;
  stakeholders?: string[];
  tags?: string[];
  created?: string;
  updated?: string;
  progress?: number;
  agentSessions: AgentSessionRef[];
  objective: string;
  acceptanceCriteria: ChecklistItem[];
  outOfScope?: string[];
  context?: string;
}
```

Markdown shape estándar con frontmatter YAML + headings + auto-managed block `<!-- apohara:agentSessions:* -->`.

### §6.2 Parser + cache

```ts
const BOUNDED_READ_BYTES = 4 * 1024;

export class PlanCache {
  async getFast(filepath: string): Promise<PlanDocumentMeta | null> {
    // Bounded read del frontmatter para detectar cambios sin parse full
    // Full parse solo si SHA cambió
  }
}
```

### §6.3 File watcher → Tauri events

`chokidar` watch `**/*.md` → emit `apohara://plan-changed` → listener centralizado (§0.1) actualiza atoms.

### §6.4 CLI flag

```bash
apohara auto --spec path/to/SPEC.md
```

Asocia el run con el plan via `planStatus.agentSessions`. Falla si `status=paused`. Confirma si 3+ agentSessions running.

### §6.5 Roster hardening a 3 CLI drivers

```ts
// src/providers/active-roster.ts
export const ACTIVE_PROVIDERS = [
  { id: 'claude-code-cli', class: ClaudeCodeProvider },
  { id: 'codex-cli',       class: CodexProvider },
  { id: 'opencode-go',     class: OpenCodeProvider },
] as const;

// src/providers/legacy-roster.ts (solo si APOHARA_LEGACY_PROVIDERS=1)
export const LEGACY_PROVIDERS = [ /* 18 cloud + gemini-cli + gemini-oauth */ ];

export function getActiveProviders(): ProviderClass[] {
  const active = ACTIVE_PROVIDERS.map(p => p.class);
  if (process.env.APOHARA_LEGACY_PROVIDERS === '1') {
    return [...active, ...LEGACY_PROVIDERS];
  }
  return active;
}
```

UI picker: por default 3 activos. Con env var: 24 con warning visual "legacy". Intentar enable 4to sin env var → toast clarísimo.

Gemini OAuth eliminado del path activo. Código permanece en `src/providers/legacy/gemini-oauth.ts`.

### Documentación

- `CHANGELOG.md` v1.0.0 entry con justificación TOS
- `ARCHITECTURE.md` §5 actualizado
- `docs/PROVIDER_PATTERNS.md` (NUEVO) con 3 templates categorizados de nimbalyst

### Pregunta abierta resuelta

"OpenCode Native" = `sst/opencode` con flag `--pure` (Bun nativo, no Go). Binario `opencode`, args `['--pure']`.

### Tests

`plan_parse_roundtrip.test.ts`, `plan_cache_fast_path.test.ts`, `plan_watcher_events.test.ts`, `cli_spec_flag.test.ts`, `roster_active_default.test.ts`, `roster_legacy_enabled.test.ts`, `out_of_scope_propagation.test.ts`.

---

## §6.5 Internal MCP servers

In-process, localhost-only, bearer-token auth. Apohara expone sus propias tools al agent para self-introspection.

### Topología

```
src/core/mcp/servers/
├── apohara-ledger.ts      ← read_events, replay_run, get_last_event, search_events
├── apohara-runs.ts        ← list_runs, inspect_run, get_current_run, get_run_diff
├── apohara-indexer.ts     ← blast_radius, search_symbols, file_symbols, reverse_dependencies (proxy a Rust)
├── apohara-settings.ts    ← get/set/list_setting con allow/deny/rate-limit/audit
└── base/
    ├── McpServer.ts       ← Bun.serve base con SSE + bearer token
    ├── auditLogger.ts     ← cada call → ledger event mcp_tool_invoked
    └── rateLimit.ts       ← token bucket per-server (30/min, 200/hour)
```

### Boot + auth

```ts
// src/core/mcp/bootstrap.ts
export async function startInternalMcpServers(deps: ApohraDeps): Promise<McpEndpoints> {
  const token = randomBytes(32).toString('hex');
  const ports = await allocateFreePorts(4);

  startLedgerServer({ port: ports[0], token, deps });
  startRunsServer({ port: ports[1], token, deps });
  startIndexerServer({ port: ports[2], token, deps });
  if (process.env.APOHARA_MCP_SETTINGS_DISABLED !== '1') {
    startSettingsServer({ port: ports[3], token, deps });
  }

  await writeAtomicJson(`${homedir()}/.apohara/sockets/mcp-endpoints.json`, {
    token,
    servers: { ledger: ports[0], runs: ports[1], indexer: ports[2], settings: ports[3] },
  });

  return { token, ports };
}
```

### MCP config injection en spawn

Cuando `BaseAgentProvider.spawn` arranca un CLI, inyecta config MCP (varía por agent):

- **Claude Code**: escribe `.claude/mcp.json` en el worktree con los 4 servers
- **Codex**: env var `CODEX_MCP_SERVERS_JSON`
- **OpenCode**: flag `--mcp-config-path`

### `apohara-settings` server

Allowlist: `ui.theme`, `ui.density`, `roster.preferred`, `cost.dailyBudget`. Denylist: `providers.apiKeys`, `providers.oauth`, `github.appPrivateKey`. Rate limit 30/min, 200/hour. Audit log al ledger por cada `set_setting`. Kill switch via env var.

### Tests

`auth_bearer_required.test.ts`, `audit_log_each_call.test.ts`, `rate_limit_enforced.test.ts`, `kill_switch_settings.test.ts`, `indexer_proxy_fallback.test.ts`, `e2e_claude_invokes_ledger_tool.test.ts`.

### §6.5.1 MCP Config Adapter Pattern (de vibe-kanban)

**Problema:** cada CLI provider tiene su propia path (`mcp_servers` / `mcpServers` / `amp.mcpServers` / `mcp`) y dialecto (HTTP→httpUrl en gemini, `tools: ["*"]` en copilot, `type=remote/local` en opencode, stdio-only en codex). Sin un canonical, cada vez que cambiamos un MCP server hay que tocar N configs en N formatos.

**Solución:** un **canonical** `default_mcp.json` (commit'eado en repo) + **adapters puros** por provider que traducen al dialecto nativo.

```json
// crates/apohara-mcp-bridge/default_mcp.json (canonical, single source of truth)
{
  "servers": {
    "apohara-indexer": {
      "type": "stdio",
      "command": "apohara-mcp",
      "args": ["--mode", "global", "--server", "indexer"],
      "env": {
        "APOHARA_MCP_TOKEN": "${APOHARA_MCP_TOKEN}"
      },
      "meta": {
        "name": "Apohara Indexer",
        "description": "tree-sitter + BERT blast-radius queries over the workspace",
        "icon": "https://apohara.dev/icons/indexer.svg",
        "url": "https://apohara.dev/docs/mcp/indexer"
      }
    },
    "apohara-ledger": {
      "type": "stdio",
      "command": "apohara-mcp",
      "args": ["--mode", "global", "--server", "ledger"],
      "env": { "APOHARA_MCP_TOKEN": "${APOHARA_MCP_TOKEN}" },
      "meta": { "name": "Apohara Ledger", "description": "Replay-verifiable SHA-256 ledger reader", "icon": "...", "url": "..." }
    },
    "apohara-runs": {
      "type": "stdio",
      "command": "apohara-mcp",
      "args": ["--mode", "global", "--server", "runs"],
      "env": { "APOHARA_MCP_TOKEN": "${APOHARA_MCP_TOKEN}" },
      "meta": { "name": "Apohara Runs", "description": "Current run context + history", "icon": "...", "url": "..." }
    }
  }
}
```

**Adapter por provider:**

```rust
// crates/apohara-mcp-bridge/src/adapters/mod.rs
pub fn adapt(provider: ProviderKind, canonical: &Value) -> Value {
    match provider {
        ProviderKind::Claude => adapt_claude(canonical),
        ProviderKind::Codex => adapt_codex(canonical),
        ProviderKind::OpenCode => adapt_opencode(canonical),
        ProviderKind::Cursor => adapt_cursor(canonical),
        ProviderKind::Gemini => adapt_gemini(canonical),
        ProviderKind::Copilot => adapt_copilot(canonical),
    }
}

fn adapt_claude(canonical: &Value) -> Value {
    // Claude config: ~/.claude/mcp.json o per-workspace .claude/mcp.json
    // Shape: { "mcpServers": { name: { command, args, env } } }
    let mut out = json!({ "mcpServers": {} });
    if let Some(servers) = canonical["servers"].as_object() {
        for (name, server) in servers {
            out["mcpServers"][name] = json!({
                "command": server["command"],
                "args": server["args"],
                "env": server["env"]
            });
        }
    }
    out
}

fn adapt_codex(canonical: &Value) -> Value {
    // Codex config: ~/.codex/config.toml
    // Shape: [mcp_servers.NAME] command = "..."; args = [...]
    // Codex is TOML-based, NO HTTP MCP servers (stdio-only)
    let mut sections = serde_json::Map::new();
    if let Some(servers) = canonical["servers"].as_object() {
        for (name, server) in servers {
            if server["type"] != "stdio" {
                continue;  // codex no soporta HTTP MCP
            }
            sections.insert(format!("mcp_servers.{}", name), json!({
                "command": server["command"],
                "args": server["args"],
                "env": server["env"]
            }));
        }
    }
    json!(sections)
}

fn adapt_opencode(canonical: &Value) -> Value {
    // OpenCode config: ~/.opencode/settings.json
    // Shape: { "mcp": { name: { type: "local"|"remote", command, args, env } } }
    let mut out = json!({ "mcp": {} });
    if let Some(servers) = canonical["servers"].as_object() {
        for (name, server) in servers {
            let opencode_type = match server["type"].as_str() {
                Some("stdio") => "local",
                Some("http") | Some("sse") => "remote",
                _ => continue,
            };
            out["mcp"][name] = json!({
                "type": opencode_type,
                "command": server["command"],
                "args": server["args"],
                "env": server["env"]
            });
        }
    }
    out
}

// Para futuros providers (gemini/cursor/copilot), adapter functions similares...
```

**Writer con JSONC preservation (§0.27):**

```rust
pub async fn update_mcp_config(
    provider: ProviderKind,
    canonical: &Value,
    workspace: &Path,
) -> Result<()> {
    let adapted = adapt(provider, canonical);
    let target_path = mcp_config_path_for(provider, workspace);
    let is_toml = matches!(provider, ProviderKind::Codex);

    if is_toml {
        write_toml_preserving_comments(&target_path, &adapted).await?;
    } else {
        write_jsonc_preserving_comments(&target_path, &adapted).await?;
    }

    Ok(())
}
```

**Frontend UI:** una sola UI "MCP servers configurados" que muestra el canonical + checkboxes per-provider para enable/disable + preview del adapted output per-provider.

**Por qué:** resuelve elegantemente el problema "un solo dashboard MCP que se sincroniza con N agents heterogéneos". Diferenciador claro vs orca (que solo gestiona Claude Code) y nimbalyst. (Pattern de vibe-kanban #1).

---

## §7 Integration test suite

### Realistic fixture workspace

```
tests/fixtures/sample-monorepo/
├── packages/api/         ← mini TypeScript Express
├── packages/shared/      ← shared types
├── crates/parser/        ← mini Rust crate
├── docs/plans/sample-plan.md
├── .gitignore
├── package.json + bun.lockb
└── Cargo.toml
```

Copy-on-test: cada test hace `fs.cp` a tmpdir, opera, cleanup.

### Tests (`tests/integration/`)

10 tests core:

1. `worktree_isolation_parallel.test.ts` — 2 tasks non-overlapping → paralelo
2. `worktree_isolation_serial.test.ts` — 2 tasks overlapping → decision_gate
3. `github_bridge_e2e.test.ts` — mock octokit → issue → run → PR
4. `spec_parser_out_of_scope.test.ts` — out-of-scope propaga a decomposer
5. `kanban_dag_sync.test.ts` — ambas vistas mismo state
6. `agent_hooks_integration.test.ts` — hook script → message → tauri event
7. `contextforge_regression.test.ts` — **CRÍTICO**: 310/310 sigue verde
8. `ledger_replay_after_canonical.test.ts` — chain verify después de projection
9. `provider_refactor_no_regression.test.ts` — 3 CLI drivers spawn correctamente
10. `permission_bash_compound.test.ts` — compound NO se aprueba como always

### MCP integration test

11. `internal_mcp_e2e.test.ts` — claude spawn con mcp.json → llama tool → recibe respuesta + audit log

### §7.1 Setup verification task + doctor gate (de agentrail)

**Concepto:** `apohara verify-setup` enrolla una task seed especial (`LOCAL-SETUP-001`: "Echo 'apohara-ok' from each provider, judge approves") que ingresa por el flujo NORMAL del orchestrator: decomposer → scheduler → providers → verification-mesh → consolidator → ledger entry.

**Lane dedicada (priority más baja, solo runnable si no hay normal tasks):**

```rust
pub enum SchedulerLane {
    ResumeInProgress,     // priority 0
    RetryAfterFeedback,   // priority 1
    StartNew,             // priority 2
    SetupVerification,    // priority 3 — solo runnable si no hay normalRunnable
}
```

**`apohara doctor` exige verdict approved:**

```
$ apohara doctor
[runtime    ] ✅ Bun 1.3.13 · Rust 1.95.0
[roster     ] ✅ claude (1.4.2) · codex (0.5.1) · opencode (--pure available)
[policy     ] ✅ runner-policy balanced compiles for all 3 providers (dry-run plan validated)
[sandbox    ] ✅ apohara-sandbox 0.4.1 operational, seccomp filter compiled
[ledger     ] ✅ DB writable, hash chain verified (4 entries, root=sha256:abc...)
[mcp        ] ✅ apohara.ledger (port 8901) · apohara.runs (port 8902) · apohara.indexer (port 8903)
[assigned   ] ✅ LOCAL-SETUP-001 visible in /tasks/mine?status=in_progress
[verdict    ] ✅ LOCAL-SETUP-001 verdict=Approved · ledger_root=sha256:abc123

✅ Apohara setup verified end-to-end. All providers reachable, full pipeline operational.
```

Secciones del doctor con `--skip-<section>` para CI partial: `runtime`, `roster`, `policy`, `sandbox`, `ledger`, `mcp`, `assigned`. La sección `policy` corre **plan compilation dry-run** para cada combinación `(runner, policy preset)` — detecta config inválida antes de que el primer task falle.

**Por qué:** setup success gate empírico, no "el comando salió 0". Detecta regressions en wiring. (Pattern de agentrail #5 + #17).

---

## §7.5 DevEx hardening

### §7.5.1 Tracker workflows

```
.apohara/trackers/
├── decisions/2026-05-21-roster-hardening.md
└── bugs/2026-XX-XX-merge-conflict-handling.md
```

Templates structured (`## Context / ## Alternatives / ## Reasoning / ## Trade-offs accepted` para decisions; `## Symptoms / ## Expected / ## Root cause / ## Fix` para bugs).

CLI: `apohara tracker create|list|show`.

### §7.5.2 Agent mistakes log

`.apohara/agent-mistakes.md` auto-poblable. Trigger: verification-mesh ve 3 rejections seguidas con misma reason → emit `repeated_rejection`. CLI `apohara incident extract <run-id>` lee del ledger y propone entrada.

### §7.5.3 Per-worktree userData directory

```rust
pub fn per_worktree_user_data_dir(task_id: &str) -> Result<PathBuf> {
    let base = dirs::data_dir()
        .ok_or_else(|| anyhow!("no data dir"))?
        .join("apohara").join("worktrees").join(task_id);
    std::fs::create_dir_all(&base)?;
    Ok(base)
}
```

Scheduler setea `APOHARA_USER_DATA_DIR` env var por worktree antes del spawn. Tauri lo lee en `setup()` hook.

### §7.5.4 Worktree-aware build cache

```bash
# scripts/worktree-bootstrap.sh
#!/bin/bash
WORKTREE_HASH=$(hash_files "$WORKTREE_PATH")
MAIN_HASH=$(hash_files "$MAIN_REPO_PATH")
if [ "$WORKTREE_HASH" = "$MAIN_HASH" ] && [ -d "$MAIN_REPO_PATH/node_modules" ]; then
    ln -sfn "$MAIN_REPO_PATH/node_modules" "$WORKTREE_PATH/node_modules"
    [ -d "$MAIN_REPO_PATH/dist" ] && cp -r "$MAIN_REPO_PATH/dist" "$WORKTREE_PATH/dist"
else
    cd "$WORKTREE_PATH" && bun install
fi
```

Invocado por scheduler post `worktree.create()`, antes del spawn.

### §7.5.5 Skills publication

```
skills/
├── apohara-cli/SKILL.md
└── apohara-orchestration/SKILL.md
```

```bash
apohara skills install --target user   # ~/.claude/skills/, ~/.codex/skills/, ~/.opencode/skills/
apohara skills install --target repo   # ./.claude/skills/
apohara skills list
```

---

## §8 Release (Phase 6)

### §8.0 Two-track push events: SSE + webhooks (de agentrail + multica + vibe-kanban)

Lifecycle events disponibles por DOS rutas paralelas. Polling es **compatibility fallback only** — el modelo es push-first.

**Track A — SSE stream para clientes interactivos (Tauri UI, external CLIs):**

```ts
// src/server/sse-router.ts
GET /api/events/stream?eventTypes=task:dispatched,worker_done&taskId=...
  → text/event-stream
  → heartbeatSeconds: 15 (default)
  → cursor: Last-Event-ID header para resume
```

```rust
// Client TS:
const es = new EventSource('/api/events/stream?eventTypes=worker_done', {
  headers: { 'Last-Event-ID': lastSeenId },
});
es.addEventListener('message', (e) => {
  const event = JSON.parse(e.data);
  applyToStore(event);
});
es.addEventListener('error', () => {
  // Exponential backoff reconnect with Last-Event-ID
});
```

**Track B — Webhook delivery worker para integraciones externas (CI, Slack, dashboards de teams):**

```rust
// crates/apohara-coordinator/src/webhook_delivery.rs
const DELIVERY_SCHEDULE_SECONDS: &[u64] = &[0, 10, 30, 90, 300, 900, 1800, 3600];
// 8 intentos, ~1.8 hours total

pub struct WebhookDeliveryWorker {
    pool: WebhookSubscriptionPool,
}

impl WebhookDeliveryWorker {
    pub async fn deliver(&self, subscription: &Subscription, event: &Event) -> DeliveryResult {
        let body = serde_json::to_vec(event)?;
        let signature = hmac_sha256(&subscription.secret, &body);

        for (attempt, delay_secs) in DELIVERY_SCHEDULE_SECONDS.iter().enumerate() {
            if *delay_secs > 0 {
                tokio::time::sleep(Duration::from_secs(*delay_secs)).await;
            }
            let response = self.http
                .post(&subscription.url)
                .header("x-apohara-subscription-id", &subscription.id)
                .header("x-apohara-event-id", &event.id)
                .header("x-apohara-event-type", &event.event_type)
                .header("x-apohara-delivery-id", uuid::Uuid::new_v4().to_string())
                .header("x-apohara-delivery-attempt", (attempt + 1).to_string())
                .header("x-apohara-signature", signature.clone())
                .body(body.clone())
                .send()
                .await;

            match response.map(|r| r.status()) {
                Ok(s) if s.is_success() => return DeliveryResult::Delivered { attempt },
                Ok(s) if s == StatusCode::GONE => {
                    // 410 → auto-disable subscription
                    self.pool.disable(&subscription.id, DisableReason::RemoteGone).await;
                    return DeliveryResult::SubscriptionDisabled;
                }
                Ok(s) if s.is_server_error() => continue,  // retry
                Ok(s) => return DeliveryResult::Failed { status: s.as_u16() },  // 4xx (no 410) = final
                Err(_) => continue,  // network error = retry
            }
        }
        DeliveryResult::ExhaustedRetries
    }
}
```

**Subscription management CLI:**
```bash
apohara webhook subscribe https://example.com/webhook --events task:dispatched,worker_done --secret @secret.txt
apohara webhook list
apohara webhook test <subscription_id>            # delivery de evento sintético
apohara webhook delete <subscription_id>
apohara webhook usage <subscription_id>           # success rate, last attempt, last 410
```

**Por qué:**
- SSE reactiva para Tauri UI sin polling — `Last-Event-ID` permite resume tras desconexión (laptop sleep, etc.)
- Webhook delivery worker production-ready: HMAC signing + 410 auto-disable (subscribers pueden auto-deregister) + visibilidad de attempts en logs para debugging
- Pattern adoptado de agentrail #10 + #12, complementado con WS hub patterns de multica #4 y JSON-Patch de vibe-kanban #3

### §8.1 Cross-OS binaries

Validar `.github/workflows/desktop-release.yml`. Matrix:

```yaml
strategy:
  matrix:
    include:
      - os: ubuntu-latest        # Linux x86_64 → AppImage, deb
      - os: macos-latest         # macOS arm64 → dmg
      - os: macos-13             # macOS x86_64 → dmg
      - os: windows-latest       # Windows x86_64 → msi
```

**Lección crítica** (de nimbalyst): single `bun install` con MULTIPLE optional deps. Install separately causa pruning del previous como "extraneous". Documentar en `RELEASING.md`. Aplica si Apohara packagea con native deps cross-arch (Bun tiene `optionalDependencies` similar a npm).

### §8.2 Pre-release → promote-to-stable flow

```bash
# Push tag v1.0.0-rc.1 → workflow publishes pre-release (alpha channel)
# Alpha users prueban via Tauri updater channel='alpha'

apohara release promote v1.0.0
# → rebuilds cumulative RELEASE_NOTES.md
# → user edits
# → flips SAME release prerelease=false (no rebuild, no second tag)
```

### §8.3 Homebrew formula

`packaging/homebrew/apohara.rb` template con placeholders `{{SHA256_*}}` rellenados por CI release tagger. Push a tap repo `SuarezPM/homebrew-tap`.

### §8.4 `curl|sh` install script

`scripts/install.sh` detecta platform/arch, resolve latest tag, descarga + verifica SHA256, instala a `${APOHARA_INSTALL_DIR:-$HOME/.local/bin}`.

Smoke test:
```bash
docker run --rm -i ubuntu:24.04 bash -c "
  apt-get update -qq && apt-get install -qq -y curl tar
  curl -fsSL https://raw.githubusercontent.com/SuarezPM/Apohara/main/scripts/install.sh | sh
  apohara --version
"
```

### §8.5 Paper arXiv submission

Vive en `apohara-context-forge/paper/`, NO en Apohara. Pero es acceptance criterion P-1.

Pasos:
1. Verificar `paper/inv15_paper.pdf` v3.0 con prueba Z3 en green CI
2. arXiv-friendly LaTeX preprocessing (figures inline, bibliography style)
3. Submission via arXiv web UI (manual, Pablo)
4. arXiv ID asignado → update `paper/zenodo-v3-metadata.json` con `related_identifiers: [arxiv:XXXX.XXXXX]`
5. Commit + CHANGELOG entry con arXiv ID

---

## §9 Dependencias y orden de ejecución

Orden topológico para minimizar bloqueos. Uso "Stage" para no confundir con "Phase 6" del roadmap upstream de Apohara (que se mapea a Stage 11 acá).

```
Stage 1 — Disciplinas + Foundation (§0 + setup)
  ├─ §0.1-§0.6 disciplinas (refactor previo)
  └─ Setup: skills publication (§7.5.5), tracker workflows boilerplate (§7.5.1)

Stage 2 — Runtime backbone (§3.5 + §3.6 paralelo)
  ├─ §3.5 agent-hooks server (Rust crate nuevo, autónomo)
  └─ §3.6 orchestration DB (TS, autónomo)

Stage 3 — Refactor providers (§4.5)
  └─ depends_on: §3.6

Stage 4 — Coordinator + worktree extend (§3 + §3.1 + §3.2)
  ├─ depends_on: §3.6
  └─ depends_on: §4.5

Stage 5 — Safety + Permissions (§4.6)
  └─ depends_on: §4.5

Stage 6 — Spec + Roster (§6)
  ├─ depends_on: §4.5
  └─ depends_on: §4.6

Stage 7 — UI (§4 TaskBoard + Plans Panel + Permission Dialog)
  ├─ depends_on: §3.6
  ├─ depends_on: §4.6
  └─ depends_on: §6

Stage 8 — Internal MCP (§6.5)
  ├─ depends_on: §3.5
  └─ depends_on: §3.6

Stage 9 — github-bridge (§5)
  ├─ depends_on: §3.6
  ├─ depends_on: §6
  └─ depends_on: §7.5.5

Stage 10 — Integration tests (§7)
  └─ depends_on: all previous stages (this is the verification gate)

Stage 11 — Release Phase 6 (§8) [Phase 6 = nombre upstream del milestone]
  ├─ depends_on: §7 (tests verdes)
  └─ depends_on: paper arXiv submission (P-1)
```

**Camino crítico**: Stage 1 → 2 → 3 → 4 → 7 → 10 → 11. Stages 5, 6, 8, 9 paralelizables después de su dependencia.

**Estimación**: ~12-14 sprints solo-dev (3-4 meses calendario con dedicación parcial).

---

## §10 Riesgos

| # | Riesgo | Severidad | Mitigación |
|---|---|---|---|
| R1 | **OOM del BERT del indexer** durante tests | ALTA | NUNCA `cargo test -p apohara-indexer` bare. Tests use `--lib` + `--test <bin>` específico. Mock con `APOHARA_MOCK_EMBEDDINGS=1`. CLAUDE.md §8.1 enforced. |
| R2 | **Decomposer LLM declara manifests incorrectos** | ALTA | Post-execution `gitnexus_detect_changes` verifica. Si discrepa → `coord_manifest_drift` + degrada reputación del provider en Thompson Sampling. |
| R3 | **CI runners cross-OS no funcionan en primer run** | MEDIA | GitHub Actions hosted runners gratis para repos públicos. Test temprano en Phase 11 con tag pre-release `v1.0.0-rc.1`. Plan B: solo Linux+Windows para v1.0; macOS via tap+source. |
| R4 | **Refactor BaseAgentProvider rompe los 3 CLI drivers** | ALTA | Refactor en 5 pasos (§4.5 Migration plan), cada uno con tests verdes antes de seguir. |
| R5 | **Orchestration DB lock contention** con N agents escribiendo | MEDIA | WAL mode + busy_timeout=5000. Coalescing en EventWriteQueue. Test concurrent_writes. Si surge: litestream o per-table sharding. |
| R6 | **Agent hooks no se instalan en provider X** | MEDIA | OSC title parsing fallback (orca pattern). Prioridad: hook > OSC > nada. Documentar en `docs/AGENT_INTEGRATION.md`. |
| R7 | **GitHub App requiere review de Marketplace** | BAJA | Apohara GitHub App es self-hosted (no marketplace listing). User instala via direct install URL. |
| R8 | **Paper arXiv submission rechazada** | MEDIA | Paper ya peer-quality (Z3 formal proof). Si rechaza: re-submit con feedback. Plan B: solo Zenodo + cite en README. |
| R9 | **Plan documents YAML schema cambia mid-implementation** | BAJA | Schema versioning (`planVersion: 1`), migrator upgrade old planes. |
| R10 | **Pablo se queda sin tiempo** | ALTA | Spec permite "ship intermediate": Phase 1-6 → v0.5 intermediate (1 mes). Phase 7-11 → v1.0 full. Partition opcional. |

---

## §11 Out of scope explícito

NO está en Apohara v1.0:

- **Ecosystem repos**: `apohara-aegis`, `apohara-probant`, `apohara-consilium`. Para v1.5+ con brainstorming separado.
- **ContextForge V7.0.0 release coordinated**. ContextForge sigue su roadmap independiente; Apohara v1.0 solo asegura que el sidecar opcional `:8001` sigue funcionando (V-1 regression criterion).
- **Webhook mode** del github-bridge. Solo poll-only para v1.0. Webhook delivery worker (§8.0 track B) sí está in-scope para subscriptions outbound, pero NO inbound webhooks de GitHub.
- **Mobile app** (a la Nimbalyst). Desktop-only.
- **Voice mode** (a la Nimbalyst).
- **Excalidraw / mockup editors**.
- **Demo viral de 90s, HN launch, Twitter thread, 50 beta users via Discord**. **Content work, NO ingeniería**. Pablo lo hace después de v1.0 shipped.
- **Plugin marketplace** (a la Vercel). Skills system sí (§7.5.5); marketplace UI no.
- **iOS companion**.
- **Collab SaaS server**. Local-first para v1.0.
- **Apohara MCP server externo** (third-party tool integration). Solo internal MCP servers (§6.5).
- **Anthropic OAuth** (TOS issue).
- **Gemini activo en roster default**. Queda detrás de `APOHARA_LEGACY_PROVIDERS=1`.

### Considered, deferred to v1.1+ (con hallazgo source documentado)

Estos patterns aparecieron en los 194 hallazgos pero se difirieron para mantener v1.0 manejable. **Roadmap v1.1+ los recupera:**

| Pattern | Source repo | Por qué deferred |
|---|---|---|
| Cliente-daemon split (server central + daemons por máquina) | multica #1 | Requiere refactor profundo de scheduler + ledger; v1.0 es local-first single-instance |
| WS hub con dedupe per-connection + stampede control (triple-guard inflight + coalesce window) | multica #4 + #3 | Requiere multi-instance para tener relevancia |
| Empty-claim cache con version tagging | multica #5 | Optimization para multi-runner; v1.0 single-runner no la necesita |
| Two-transport heartbeat WS + HTTP con freshness window | multica #9 | Requiere daemon mode |
| Profile system (múltiples daemons isolated con health port determinístico) | multica #10 | Requiere daemon mode |
| UUID identity + legacy migration | multica #2 | Para single-instance no es crítico |
| Workspace GC tiers (full/orphan/artifact-only con dismissals + fingerprint) | multica #8 | Útil con muchos worktrees acumulados; v1.0 prune-stale suficiente |
| Embedded SSH server (russh sobre WS) | vibe-kanban #13 | Multi-machine future, no v1.0 |
| SSH worker extension (central orchestrator + remote workers vía SSH stdio) | symphony Appendix A | Multi-machine future |
| Smart Router con confidence + auto-invoke modes (repeat-intent detection) | claude-octopus #12 | Más complejo de calibrar bien; puede generar UX confuso |
| Reaction Engine state machine 13 lifecycle states + `.reactions.conf` | claude-octopus #13 | Depende de github-bridge maduro con feedback loop completo |
| /yolo full-auto pipeline con wave-based parallel sub-agents | Chorus #14 | Necesita más curado del flow + UX para escape hatch |
| Preview-proxy (iframe subdomain routing + asset injection + RSC redirect interception) | vibe-kanban #9 | Solo aplica si Apohara incluye preview de dev servers (no en v1.0) |
| TeammateIdle dispatch queue-driven con exit code 2 | claude-octopus #7 | Pattern complementario al agent-hooks server actual; mejor evaluar después con hooks funcionando |
| Output compressor inline + `octo-compress` pipe | claude-octopus #1 | Quality of life, no critical para v1.0 release |
| Mention expansion (regex + skip code/links + RTL replace) | multica #12 | Nice-to-have, no critical |
| Per-issue typed KV metadata con quota | multica #16 | Útil cuando crezca el surface de SPEC.md |
| `apohara incident extract <run-id>` auto-popular agent-mistakes.md | propia, derivada | Manual edit para v1.0; automation v1.1 |
| Plugin descriptors per-harness con manifest mínimo | culture #11 expandido | Skills install sí (§7.5.5); marketplace UI no |
| `apohara doc sync` byte-faithful encoder (OpenSpec mode) | Chorus #16 | Útil para teams compartiendo SPEC.md; v1.0 single-user no lo necesita |
| Mobile companion / web dashboard de ledger read-only | nimbalyst.com #12 inferred | v1.2+ con narrative "monitor your agents from anywhere" |
| Reversed Conversation paradigm como design principle (DAG proposal → human approve gate) | Chorus #17 | Decision gates ya en §3.6; el gate de plan_approval queda para v1.1 cuando tengamos métricas reales de blast-radius threshold |
| Token cost UI granular (por dispatch, por session, por turn) | nimbalyst CONTEXT_WINDOW_USAGE_TRACKING | TopBar cost meter actual cubre suficiente para v1.0; granular es v1.1 |
| Setup verification "wave" approach (instalar todos los providers en paralelo con dependency checks) | inspirado en agentrail #4 | El setup actual secuencial es suficiente para v1.0 |

---

## §12 Appendix A — Mapeo de los 194 hallazgos → secciones del spec

Brainstorming session 2026-05-21 (3 rondas) analizó 10 repos competidores + nimbalyst.com landing. Hallazgos clasificados ALTO/MEDIO/BAJO; este apéndice documenta a qué sección del spec se mapea cada hallazgo de los **adoptados** (los deferidos a v1.1+ están en §11).

### Ronda 1 — orca + nimbalyst (58 hallazgos)

| Source | Top hallazgos adoptados | Sección spec |
|---|---|---|
| orca #1 | Agent-hooks HTTP loopback server | §3.5 |
| orca #2 | TUI_AGENT_CONFIG matrix + preflightTrust per-agent | §4.5 |
| orca #4 | OSC title parsing fallback | §3.5 (fallback en hook chain) |
| orca #5 | Worktree delete preflight (status check antes de kill) | §3.1 |
| orca #6 | Worktree lineage (parent_worktree_id + lineage_root) | §3.1 |
| orca #7 | Workspace-cleanup tiers (ready/review/protected) | §3.1 |
| orca #8 | Orphan worktree adoption cross-platform | §3.1 |
| orca #9 | SQLite orchestration DB (messages + tasks + dispatch_contexts + decision_gates) | §3.6 |
| orca #10 | Dispatch preamble con drift section | §3.6 |
| orca #11 | `orchestration check --wait` heartbeat JSON cada 15s | §3.6 |
| orca #12 | Drift detection + allow-stale-base opt-in | §3.6 |
| orca #13 | Terminal attribution shim (git/gh wrappers) | §5 |
| orca #14 | Smart Attention class 4 niveles | §4 |
| orca #15 | Workspace Kanban modular hooks-per-concern | §4 |
| orca #16 | Skills discovery escaneando ~/.claude/skills + ~/.codex/skills | §7.5.5 |
| orca #17 | Dashboard agent rows con stale-decay + freshness scheduler | §4 |
| nimbalyst #1.1 | BaseAgentProvider abstract class | §4.5 |
| nimbalyst #1.2 | ProtocolInterface unificada | §4.5 |
| nimbalyst #1.3 | 3 patterns providers categorizados (direct-SDK / protocol-backed / CLI-backed) | §4.5 |
| nimbalyst #1.4 | Static DI bucket (ApohraDeps) | §4.5 |
| nimbalyst #1.5 | Sanitización defensiva de API keys del environment | §0.4 |
| nimbalyst #1.6 | Persistent prompt stream (AsyncIterable con .end()) | §4.5 |
| nimbalyst #1.7 | AgentMessageWriteQueue con coalescing 200ms idle / 200 rows | §4.5 |
| nimbalyst #2.1 | Two-layer session/DAG hierarchy invariant | §4 |
| nimbalyst #2.2 | WorktreeReliability — 9 failure modes con fixes | §3.1 |
| nimbalyst #2.3 | `crystal-run.sh` worktree-aware build cache | §7.5.4 |
| nimbalyst #2.4 | Adjective-noun naming + idempotent retry on collision | §3.1 |
| nimbalyst #3.1 | Durable interactive prompts persistidos al ledger | §4.6 |
| nimbalyst #3.2 | Prompt ID alias resolution centralizado | §4.6 |
| nimbalyst #4.1 | Pattern-based permission cache con scopes (once/session/always) | §4.6 |
| nimbalyst #4.2 | Compound command splitter | §4.6 |
| nimbalyst #4.4 | 3-tier settings hierarchy (~/.claude → .claude/settings.json → .local) | §4.6 |
| nimbalyst #5.1 | Two-tier append-only log + derived canonical events | §3.6 + §0.14 |
| nimbalyst #5.2 | Provider-agnostic canonical events (parsers as pure functions) | §4.5 |
| nimbalyst #6.1 | Centralized IPC listeners (1 listener per event, NEVER component-local) | §0.1 |
| nimbalyst #6.2 | `workspacePath` como parámetro requerido en todo IPC | §0.6 |
| nimbalyst #6.3 | `safeHandle` / `safeOn` wrappers | §0.3 |
| nimbalyst #7.1 | Internal MCP servers (in-process, localhost-only, bearer token) | §6.5 |
| nimbalyst #7.2 | Settings Control MCP server con allow-list/deny-list/rate-limit/audit | §6.5 |
| nimbalyst #7.3 | Custom tool widgets registry | §4 |
| nimbalyst #8.1 | Plan documents as markdown-with-frontmatter (planStatus + agentSessions) | §6 |
| nimbalyst #8.2 | Tracker workflows (decision/bug items con structured templates) | §7.5.1 |
| nimbalyst #8.3 | End-to-end verification rule (failing test first) | §0.5 |
| nimbalyst #8.4 | Agent-mistakes.md log con incident postmortems | §7.5.2 |
| nimbalyst #8.5 | Per-test reusable fixture workspace | §7 |
| nimbalyst #8.6 | Cross-arch CI native binaries con single-install lesson | §8 |
| nimbalyst #8.7 | Release flow: pre-release on tag push → promote-to-stable | §8 |
| nimbalyst #9.1 | Persisted state defaults pattern (createDefault + `??` merge) | §0.2 |
| nimbalyst #9.2 | Deep-merge for workspace state IPC updates | §0.2 |
| nimbalyst #10.1 | System prompt addendum layered architecture | §4.5 |
| nimbalyst #10.2 | Dynamic tool descriptions with runtime data | §6.5 |
| nimbalyst #10.3 | Fail fast doctrine en error handling | §0.3 |
| nimbalyst #11.1 | File-watcher-based diff (AI escribe direct, watcher detecta) | §4 |
| nimbalyst #11.2 | OpenCode file-snapshot plugin (before/after captures) | §4 |
| nimbalyst #12.1 | Per-worktree `userData` directory | §7.5.3 |

### Ronda 2 — 7 repos nuevos + nimbalyst.com (136 hallazgos)

| Source | Top hallazgo adoptado | Sección spec |
|---|---|---|
| **nimbalyst.com** F1+F2+F8 | README rewrite outcome-first + "no API keys" diferenciador + pain→relief framing | §8.3 (rewrite README + landing guidance) |
| nimbalyst.com F3 | 6-principle manifesto ("What Drives Apohara") | §8.3 |
| nimbalyst.com F6 | Footer trust badges INV-15 Z3 + SHA-256 ledger | §8.3 |
| nimbalyst.com F7 | Download CTA por platform (table stakes para v1.0) | §8.1 |
| nimbalyst.com F10 | 2 launch essays ("Why we shipped a Z3 proof" + "Locks, not vibes") | §8.3 |
| nimbalyst.com F11 | UX wedge hero screenshot (kanban / diff approval) | §8.3 |
| nimbalyst.com F15 | "Verification timeline" UI panel — trust theater visible | §4 |
| **multica** #6 | Protocol envelope `{type, payload}` versionado por dominio | §3.6 (message types) |
| multica #7 | Poisoned session classification | §3.4 (consolidator pre-resume check) |
| multica #11 | Sidecar CLI bundling Electron pattern (cascade resolve) | §0.24 + §8.1 |
| multica #13 | Issue active-duplicate prevention con advisory lock | §3.3 (decomposer) |
| multica #14 | UUID parsing convention (3 helpers: boundary / trusted roundtrip / human-friendly) | §0.3 (disciplina) |
| multica #17 | Workspace settings versioning + repo allowlist hash | §0.11 |
| multica #18 | Client-side secret redaction como safety net | §4.6 |
| **culture** #1 | Mesh-as-bus eventos con tags estructurados | §0.30 |
| culture #2 | Filter DSL seguro (parser recursive-descent ~200 LOC) | §0.29 |
| culture #3 | Attention bands HOT/WARM/COOL/IDLE state machine determinista | §4 (refina Smart Attention) |
| culture #4 | Audit JSONL sink con async queue + rotación + fchmod 0600 | §0.8 + crate `apohara-audit` |
| culture #5 | OS-native credential store wrapping (keyring-rs) | §0.10 |
| culture #6 | Universal verbs explain/overview/learn dispatcher | §0.31 |
| culture #7 | CLI passthrough con REMAINDER + chr(0) | §0.31 (parte de universal verbs) |
| culture #8 | Atomic YAML write `mkstemp + os.replace` | §0.8 |
| culture #9 | Decentralized config + manifest pattern (apohara.yaml) | §6 |
| culture #10 | Whisper protocol stderr-side-channel | §0.32 + crate `apohara-whisper` |
| culture #11 | Plugin packaging skills install per-harness | §7.5.5 |
| culture #12 | Bot system con path validation + rate limit + fires_event composition | §6.5 (settings-control server pattern) |
| culture #13 | Cross-platform service installer (systemd-user/launchd/schtasks) | §0.20 |
| culture #14 | Peek client attribution + invocation_id pattern | §0.13 |
| culture #15 | stdout/stderr contract estricto + --json mode | §0.9 |
| **vibe-kanban** #1 | MCP Config Adapter Pattern (canonical → 6 dialectos) | §6.5.1 |
| vibe-kanban #2 | JSONC con preservación de comentarios via CST | §0.27 |
| vibe-kanban #3 | JSON-Patch streaming over WebSocket | §8.0 (parte de SSE) |
| vibe-kanban #4 | ts-rs Single Source of Truth tipos | §0.7 |
| vibe-kanban #5 | NPX-CLI distribution pattern | §0.24 |
| vibe-kanban #6 | MCP Server propio en dos modos (Global vs Orchestrator) | §6.5 |
| vibe-kanban #7 | WorktreeManager con LazyLock + retry + comprehensive cleanup | §3.1 |
| vibe-kanban #8 | Approvals/Questions Service con Shared<BoxFuture> + timeout | §0.19 + §4.6 |
| vibe-kanban #10 | Versioned Config Schema (v1→v8 migration chain) | §0.11 |
| vibe-kanban #11 | AGENTS.md scoped por crate + symlink CLAUDE.md→AGENTS.md | §0.17 |
| vibe-kanban #12 | Cross-platform Push Notifications con global injection + WSL2 cache | §0.21 |
| vibe-kanban #14 | Dev environment setup script (ports + seed assets) | §7 |
| vibe-kanban #15 | enum_dispatch para Provider polymorphism | §0.16 + §4.5.1 |
| vibe-kanban #16 | Capabilities-based feature flags por agente | §4.5.1 |
| vibe-kanban #17 | Sound alerts con files empotrados + UI elección | §0.21 |
| vibe-kanban #18 | Per-executor default_pure_profiles + JSON Schemas | §0.22 |
| vibe-kanban #19 | Crate-granularity workspace ~30 crates | §0.23 |
| vibe-kanban #20 | spawn_blocking para libgit2 + tree-sitter | §0.12 |
| **claude-octopus** #1 | Output Compressor inline + `octo-compress` pipe | deferred v1.1 §11 |
| claude-octopus #2 | Strategy Rotation hook anti-loop | §4.6.3 |
| claude-octopus #5 | Domain-specific quality gates por persona (security/perf/architecture/...) | §4.6.2 |
| claude-octopus #6 | Freeze Mode + Careful Mode (write-boundary enforcement) | §4.6 (extiende permission system) |
| claude-octopus #8 | Pre/PostCompact contract re-injection | §3.5.1 |
| claude-octopus #9 | Cross-session learnings layer (auto-memory bridge) | §7.5.2 (complementa mistakes log) |
| claude-octopus #10 | Per-worktree `.octopus-env` file con umask 077 | §0.4 + §3.1 |
| claude-octopus #11 | DONE Criteria heurística para compound tasks | §3.3 (decomposer pre-split) |
| claude-octopus #14 | MCP `octopus_set_editor_context` IDE injection | §6.5 |
| claude-octopus #16 | Codex-exec-guard correctness hook | §4.5 (validate_command per provider) |
| claude-octopus #17 | Per-job security gate con tool/path allowlist (realpath canonicalization) | §3.11 (PathSafety) |
| **Chorus** #1 | Presence inferida automáticamente desde tool-calls | §3.5 (agent-hooks emite presence events) |
| Chorus #2 | Throttle de 2 capas (server 2s + cliente 3s) con auto-eviction | §3.5 |
| Chorus #3 | PixelCanvas — visualización lúdica de agentes activos | §4 (componente UI futuro, considerado en TaskBoard) |
| Chorus #4 | Dual-path acceptance criteria (claim + verify paralelos) | §4.5.4 |
| Chorus #5 | Adversarial review sub-agent con criticalSystemReminder + maxTurns | §4.5.2 |
| Chorus #6 | Hallucination flag como categoría taxonómica | §4.5.3 |
| Chorus #7 | Per-agent pending file pattern (atomic mv claim) | §3.5 |
| Chorus #8 | Hook output JSON con additionalContext | §0.18 + §3.5.1 |
| Chorus #9 | Session reuse heurística por nombre (active reuse / closed reopen) | §3.6 (tasks table) |
| Chorus #10 | Permisos como `resource:action` bits con presets + custom override | §4.6 |
| Chorus #11 | Tool registration permission-gated invisible (no error, just absent) | §6.5 |
| Chorus #12 | AsyncLocalStorage para per-request context | §0.15 |
| Chorus #13 | Cross-instance event dedup con `_origin` envelope | §3.5 |
| Chorus #14 | /yolo full-auto pipeline | deferred v1.1 §11 |
| Chorus #15 | maxRounds + escalation explícita en pipelines | §4.5.2 |
| Chorus #16 | OpenSpec mode (local file source of truth + MCP mirror byte-equal) | deferred v1.1 §11 |
| Chorus #18 | SSE listener con exponential backoff + onReconnect backfill | §8.0 |
| Chorus #19 | Notification listener desacoplado via EventBus (zero invasion) | §0.1 + §7.5.2 |
| **symphony** #1 | RFC 2119 + Validation Profiles (core/extension/integration) | §6 (SPEC.md schema) |
| symphony #2 | WORKFLOW.md hot-reload con last-known-good fallback | §0.26 |
| symphony #3 | Tres state machines separadas (claim/phase/external) | §3.7 |
| symphony #4 | Continuation vs Failure retry semánticos | §3.8 |
| symphony #5 | Tres reconciliation passes por tick | §3.10 |
| symphony #6 | PathSafety con symlink-escape detection | §3.11 + §0.13 |
| symphony #7 | Workspace hooks 4-phase lifecycle | §0.28 |
| symphony #8 | Line-framed JSON-RPC con tolerancia non-JSON | §4.5 (BaseAgentProvider transport) |
| symphony #9 | Dynamic tools + approval auto-resolution + heuristic for input | §4.6 |
| symphony #10 | "Blocked" como primary state | §3.9 |
| symphony #11 | Token accounting absolutes > deltas + per-thread keying | §0.14 |
| symphony #12 | Dashboard fingerprint + throttle + sparkline + event humanizer | §4 (TaskBoard performance) |
| symphony #14 | Self-describing guardrail flag | §0.25 |
| symphony #15 | Tracker adapter pattern (multi-tracker future) | §5 |
| **agentrail** #1 | `availableActions[]` como contrato universal | §3.6.1 |
| agentrail #2 | Severity vocabulary `must_fix\|should_fix\|note` | §4.5 (acceptance criteria) |
| agentrail #3 | Idempotency-key embebido en PR body | §5.1 |
| agentrail #4 | Two-tier provider connect/doctor con shared engine | §7.1 |
| agentrail #5 | Setup verification task + doctor gate | §7.1 |
| agentrail #6 | Scheduler lanes priorizadas (resume/retry/start_new/setup) | §3.4 + §7.1 |
| agentrail #7 | Managed run reclaim policy (stale + supervisor restart-loop guard) | §3.9 (Blocked SandboxInfrastructureFailure) |
| agentrail #8 | Runner execution policy 4 presets | §4.6.1 |
| agentrail #9 | Per-agent scoped API keys + scope vocabulary cerrado | §6.5 |
| agentrail #10 | Webhook delivery worker con HMAC + 8 attempts back-off + 410 auto-disable | §8.0 |
| agentrail #11 | Telemetry install-id anónimo + event allowlist + property denylist | §0.33 |
| agentrail #12 | Two-track wake mechanism SSE + webhooks | §8.0 |
| agentrail #13 | Task source repair endpoint | §3.6 (orchestration DB) |
| agentrail #14 | Run context envelope con human-readable action labels | §3.6.2 |
| agentrail #17 | Doctor con plan-compile check (no solo binary checks) | §7.1 |

**Total adoptado a v1.0:** 145 hallazgos. **Diferidos a v1.1+:** 24 hallazgos (documentados en §11). **No adoptados (off-scope):** 25 (mobile, voice, marketplace, etc. listados en §11).

### Ronda síntesis — 20 patterns transversales (3+ repos)

Los siguientes aparecen en 3+ repos y son señal MUY fuerte. Documentados explícitamente en este spec:

1. **Hook/event bus desde CLIs nativos** (orca, nimbalyst, Chorus) → §3.5
2. **Two-tier event pipeline** (orca messages, nimbalyst raw+canonical, vibe-kanban JSON-Patch, Chorus presence) → §3.6 + §8.0
3. **Provider abstraction unificada** (nimbalyst BaseAgentProvider, orca TUI_AGENT_CONFIG, vibe-kanban enum_dispatch+Capability) → §4.5
4. **Permission patterns + 3-tier settings hierarchy compat con .claude/settings.json** (nimbalyst, orca preflightTrust, Chorus permisos) → §4.6
5. **Worktree reliability hardening** (orca preflight/lineage/cleanup, nimbalyst 9 failure modes, vibe-kanban LazyLock) → §3.1
6. **Atomic file write patterns** (culture mkstemp, multica atomic mv, Chorus pending claim, vibe-kanban JSONC) → §0.8
7. **Defense-in-depth security** (culture fchmod, agentrail runner policy, claude-octopus per-worktree env, symphony PathSafety, multica secret redaction) → §0.4 + §3.11 + §4.6.1
8. **State machines separadas** (symphony 3SMs, agentrail lanes, agentrail reclaim, multica UUID parsing) → §3.7 + §3.4
9. **maxRounds + escalation explícita** (Chorus, agentrail, symphony validation profiles) → §4.5.2
10. **Adversarial review system reminders** (Chorus rationalizations, symphony specs, agentrail severity) → §4.5.2
11. **Hook output JSON additionalContext** (Chorus, claude-octopus, symphony workflow reload) → §0.18
12. **MCP config adapter pattern** (vibe-kanban) → §6.5.1
13. **Capabilities-based feature flags** (vibe-kanban) → §4.5.1
14. **ts-rs single source of truth tipos** (vibe-kanban) → §0.7
15. **Plugin packaging skills install** (culture, vibe-kanban) → §7.5.5
16. **Setup verification + doctor gate** (agentrail) → §7.1
17. **Pre/PostCompact contract re-injection** (claude-octopus) → §3.5.1
18. **Token accounting absolutes > deltas** (symphony) → §0.14
19. **Workspace hooks 4-phase lifecycle** (symphony) → §0.28
20. **Continuation vs Failure retry semánticos** (symphony) → §3.8

---

*End of spec. Total ~5200 líneas, ~25000 palabras. Next: writing-plans skill genera implementation plan a partir de este documento.*
