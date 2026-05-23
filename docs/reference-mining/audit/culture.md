# Audit: culture (15 hallazgos)

> Audit ejecutado 2026-05-22 sobre `feat/apohara-v1` HEAD (`d9372eb`).
> Fuente: `docs/reference-mining/culture.md` (15 hallazgos sintetizados del repo `_reference/culture/`).
> Plan de sprints: `docs/superpowers/plans/2026-05-22-reference-mining-sprints.md`.

## Resumen

| Status | Cantidad |
|---|---:|
| COMPLETO | 5 |
| PARCIAL | 4 |
| NO IMPLEMENTADO | 6 |
| RECHAZADO | 0 |
| AMBIGUO | 0 |
| **Total** | **15** |

Notas:
- Tres commits explícitamente ligados a `culture`: `1694a8a` (audit #4), `0e4e892` (attention #3), `ced2964` (smart-attention UI). Los demás patterns aplicables a Apohara llegaron por otros vectores (orca/nimbalyst) o aún están pendientes.
- El plan de sprints declara "IRC server engine — wrong shape para orchestrator" como descarte explícito. Ninguno de los 15 hallazgos auditados es realmente "IRC server engine" (la spec dejó solo los patterns extraíbles), así que no hay RECHAZADOS estrictos en esta lista; los gaps son de adopción, no de rechazo.

---

## Hallazgos

### Hallazgo 1: Mesh-as-bus con eventos IRCv3-tagged (PRIVMSG + `@event`)
- **Origen culture**: `_reference/culture/docs/superpowers/specs/2026-04-15-mesh-events-design.md`, `_reference/culture/docs/agentirc/events.md`.
- **Apohara actual**:
  - `src/core/ledger.ts` — SHA-256 chain JSONL (post-mortem, no live mesh).
  - `src/core/types.ts:438` — `EventLog { id, timestamp, type, severity, taskId?, payload }`.
  - `packages/desktop/src/lib/bus.ts` — EventTarget bus, in-process.
  - `src/core/hooks/events.ts` — typed hook events (`pre_tool_use`, `post_tool_use`, `stop`, …) NO dotted-namespace.
  - `src/core/dispatch/runner.ts:56` — single `type: "task_phase"` ledger event.
- **Status**: PARCIAL
- **Evidencia**:
  - `grep type src/core/types.ts:441` → `type: string` (sin regex ni body_human).
  - `grep "system-\|system-$" src/` → 0 matches (no hay system-channel concept).
  - `grep "user.join\|agent.connect\|task.created\|task.start" src/ packages/ crates/` → 0 matches (sin dotted-namespace consistente).
- **Gap**: Hay un ledger SHA-256 (forensics) y un bus in-process del UI, pero no existe un **single mesh stream dual-format** (body humano + payload colapsable) ni una convención dotted-lowercase obligatoria (`^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$`). No hay `_origin` tag para loop prevention.
- **Recomendación**: Agregar campo `body_human: string` y validador regex de namespaces dotted al `EventLog`; introducir un canal sistema (`system-orchestrator`) que reemita los eventos como mensajes legibles para que el TUI/Tauri muestre el mismo stream que ven los agent-hooks.

### Hallazgo 2: Filter DSL seguro recursive-descent (parser sandboxed)
- **Origen culture**: `_reference/culture/culture/bots/filter_dsl.py` (340 LoC).
- **Apohara actual**:
  - `src/core/safety/patterns.ts` — pattern matcher tipado por enum (`bash_prefix | webfetch_domain | edit_glob | mcp_prefix`), NO un evaluador booleano genérico.
  - `src/core/safety/bashCompoundAnalyzer.ts` — analizador AST de bash, distinto dominio.
- **Status**: NO IMPLEMENTADO
- **Evidencia**:
  - `find . -name "filter*.ts/rs"` → 0 matches.
  - `grep "FilterExpr\|filterExpression\|ConditionExpr\|conditionDsl"` → 0 matches.
  - `grep "FieldRef\|parseFilter"` → 0 matches.
- **Recomendación**: Portar `filter_dsl.py` a TS (~200 líneas, sin deps) como `src/core/orchestration/filter-dsl.ts`. Usar para predicados de agent-hooks (`type == 'task.completed' and not ('_peek' in nick)`), capability targeting y rules de auto-judge. Parse-time rejection es la mitad del valor.

### Hallazgo 3: Attention bands HOT/WARM/COOL/IDLE state machine
- **Origen culture**: `_reference/culture/docs/attention.md`, `_reference/culture/docs/superpowers/specs/2026-05-08-dynamic-attention-levels-design.md`, `_reference/culture/culture/clients/shared/attention.py`.
- **Apohara actual**:
  - `crates/apohara-attention/src/lib.rs` — state machine pura (`Band::Hot | Warm | Cool | Idle`, `Stimulus::Direct | Ambient`, `AttentionState::apply()`).
  - `crates/apohara-attention/src/lib.rs:30-43` — `BandSpec { hold }`, `Hot=60s`, `Warm=240s`, `Cool=720s`, `Idle=MAX`.
  - `packages/desktop/src/hooks/useTaskBoardSmartAttention.ts` (commit `ced2964`).
- **Status**: COMPLETO
- **Evidencia**:
  - `crates/apohara-attention/src/lib.rs:1-3` — header cita culture #3 + spec §4.
  - Commits `0e4e892` y `ced2964` referencian explícitamente "culture #3".
  - `#[ts(export)]` en `Band` → tipo cruzado a TS via §0.7.
- **Justificación COMPLETO**: state machine pura testable, OTEL-friendly (tracing::debug), saturación contra eventos out-of-order, integración UI cerrada.

### Hallazgo 4: Audit JSONL sink async-queue + rotación UTC + fchmod 0600
- **Origen culture**: `_reference/culture/culture/telemetry/audit.py` (382 LoC).
- **Apohara actual**:
  - `crates/apohara-audit/src/lib.rs` — `AuditSink::new(dir, instance)` con `mpsc::channel`, writer task dedicado, `EventKind` enum (13 variantes), rotación diaria + por tamaño 64 MiB.
- **Status**: COMPLETO
- **Evidencia**:
  - `crates/apohara-audit/src/lib.rs:1-9` — header cita culture #4 + §0.4.
  - `open_with_0600` + `pick_target_path` + `rotate_with_suffix` (implementan fchmod-on-fd y rotation suffixing).
  - `try_send` con `QueueOverflow` → no bloquea event loop.
  - Commit `1694a8a` etiquetado.
- **Justificación COMPLETO**: implementa los tres invariants (async-queue bounded, perms-on-fd, daily+size rotation). Falta solo el record schema `trace_id/span_id` (cubierto por OTEL, no por este crate).

### Hallazgo 5: OS-native credential store wrapping (Keychain/Credential Manager/libsecret)
- **Origen culture**: `_reference/culture/culture/credentials.py` (173 LoC).
- **Apohara actual**:
  - `crates/apohara-secrets/src/lib.rs` — `keyring::Entry` (que abstrae las 3 plataformas), `SecretScope { service, username }`, `SecretString` con `Zeroize` on drop + `Debug` redactado.
  - Funciones `store`, `lookup`, `delete` con same shape.
- **Status**: COMPLETO
- **Evidencia**:
  - `crates/apohara-secrets/src/lib.rs:1-6` — header refiere §0.10.
  - `SecretString::drop -> zeroize` — defeats heap re-read attacks (excede a culture, que mantenía `str` regular).
  - `fmt::Debug` retorna `"SecretString(***)"` (anti-log-leak).
- **Justificación COMPLETO**: usa `keyring-rs` para abstracción (mejor que el wrapper-de-3-binarios de culture). Zeroize + Debug redactado son refinamientos por encima del original.

### Hallazgo 6: Universal verbs `explain | overview | learn` dispatcher
- **Origen culture**: `_reference/culture/culture/cli/introspect.py` (320 LoC), `_reference/culture/culture/learn_prompt.py`.
- **Apohara actual**:
  - `src/cli.ts` — commander wiring: `config | auth | auto | dashboard | replay | state | stats | uninstall`. **No** existen `explain | overview | learn`.
  - `skills/apohara-cli/SKILL.md` y `skills/apohara-orchestration/SKILL.md` cubren parte del "learn" como contenido estático, pero no se exponen via CLI.
- **Status**: NO IMPLEMENTADO
- **Evidencia**:
  - `grep "explain\|overview\|learn" src/cli.ts src/cli/ src/commands/` → 0 hits funcionales.
  - `grep "register_topic\|registerTopic\|IntrospectRegistry"` → 0 matches.
  - `grep "apohara skills install\|apohara learn"` → 0 matches.
- **Recomendación**: T3.14 del sprint plan lo lista explícitamente como pendiente. Añadir `apohara learn <topic>` que emita markdown agent-ready desde un `IntrospectRegistry`. Beneficio inmediato: cada subcomando se auto-documenta.

### Hallazgo 7: `_passthrough` CLI pattern (`argparse.REMAINDER` + `prefix_chars=chr(0)`)
- **Origen culture**: `_reference/culture/culture/cli/__init__.py:105-146`.
- **Apohara actual**:
  - `src/cli.ts:33` — `program.parse(process.argv)` (commander estándar, sin pre-parse de forwarded verbs).
  - `src/providers/cli-driver.ts` — sí spawn-ea claude/codex/opencode, pero como providers internos, NO como `apohara claude <anything>` passthrough verbatim.
- **Status**: NO IMPLEMENTADO
- **Evidencia**:
  - `grep "REMAINDER\|passthrough\|spawnPassthrough\|forwardCommand"` → 0 matches.
  - `grep "apohara claude\|apohara codex\|apohara opencode"` → 0 matches.
- **Recomendación**: Agregar pre-parser en `src/cli.ts` que detecte `argv[2] ∈ {claude, codex, opencode}` y haga `Bun.spawn({cmd: argv.slice(2), stdio: 'inherit'})`. Crítico para Two-tier transcript: el wrapper se logueará automáticamente.

### Hallazgo 8: Atomic YAML/file write via `mkstemp` + `os.replace`
- **Origen culture**: `_reference/culture/culture/config.py` líneas 481-580; `_reference/culture/culture/mesh_config.py:121-139`; `_reference/culture/culture/bots/config.py:127-180`.
- **Apohara actual**:
  - `src/core/persistence/atomicWrite.ts` — `atomicWriteFile(path, content)` con `crypto.randomUUID()` para tmp name, `fh.datasync()` antes del rename, cleanup en `catch`.
  - `atomicWriteJson` envuelve con stable formatting.
  - `tests/core/persistence/atomicWrite.test.ts` cubierto.
- **Status**: COMPLETO
- **Evidencia**:
  - `src/core/persistence/atomicWrite.ts:1-21` — header refiere §0.8 + nota explícita sobre `fdatasync` para evitar zero-length post-rename.
  - `open(tmpPath, "w", 0o600)` — perms en el open (paridad con `fchmod`).
- **Justificación COMPLETO**: implementa el patrón con un refinamiento extra (datasync explícito) que culture no tenía documentado.

### Hallazgo 9: Decentralized config con manifest + per-directory `culture.yaml`
- **Origen culture**: `_reference/culture/culture/config.py:102-415`; spec `_reference/culture/docs/superpowers/specs/2026-04-09-decentralized-agent-config-design.md`.
- **Apohara actual**:
  - `src/core/config.ts` — solo env var parsing (zod schema sobre `process.env`).
  - `src/core/providers/agent-config.ts` — config en código TS (no per-project YAML).
  - No existe `apohara.yaml` per-proyecto ni `~/.apohara/registry.yaml`.
- **Status**: NO IMPLEMENTADO
- **Evidencia**:
  - `find . -name "apohara*.yaml"` → 0 matches (fuera de skills).
  - `find . -name "registry*"` solo da `pty/registry.ts` (unrelated).
  - `grep "loadConfig\|projectConfig"` → 0 hits que apunten a YAML per-project.
- **Recomendación**: Diseñar `apohara.yaml` per-proyecto + `~/.apohara/registry.yaml` (manifest path→id). Computar IDs en load-time (nunca persistir). Adopción incremental: empezar por `{providers, capabilities, mcp_servers}` y dejar `extras: HashMap` para forward-compat.

### Hallazgo 10: Whisper protocol stderr-side-channel daemon→agent
- **Origen culture**: `_reference/culture/plugins/claude-code/skills/irc/SKILL.md:177-188`; `_reference/culture/culture/clients/shared/ipc.py`.
- **Apohara actual**:
  - `src/providers/cli-driver.ts` — captura stdout/stderr de cada CLI, pero NO inyecta mensajes `[whisper:<type>]`.
  - `src/core/verification/qualityGates/` — orquestración de quality gates (post-hoc), no real-time correction al agente vivo.
- **Status**: NO IMPLEMENTADO
- **Evidencia**:
  - `grep -ln "whisper" src/ packages/ crates/` → 0 matches.
  - `grep "CORRECTION\|REMINDER\|BUDGET_WARNING\|DRIFT_DETECTED"` → 0 matches.
- **Recomendación**: Añadir `whispers.jsonl` en `.apohara/<run>/` watcheado por el cli-driver wrapper; emitir `[whisper:<type>] <msg>` a stderr antes de cada step del agente. Empezar con `CORRECTION` y `BUDGET_WARNING`. Skill bundle debe documentar "always read stderr".

### Hallazgo 11: Plugin packaging Claude Code + Codex first-class skill bundles
- **Origen culture**: `_reference/culture/plugins/claude-code/.claude-plugin/plugin.json`, `_reference/culture/plugins/claude-code/skills/irc/SKILL.md`, `_reference/culture/culture/learn_prompt.py:9-22` (`SKILL_DIRS`).
- **Apohara actual**:
  - `skills/apohara-cli/SKILL.md` con frontmatter (`name`, `description`).
  - `skills/apohara-orchestration/SKILL.md` con frontmatter.
  - No existe `plugin.json` ni un comando `apohara skills install <harness>` ni `SKILL_DIRS` mapping.
- **Status**: PARCIAL
- **Evidencia**:
  - `find . -name "SKILL.md" -path "*/skills/*"` → 2 archivos en `skills/` (los bundles existen).
  - `find . -name "plugin.json"` → 0 matches; `find -type d -name ".claude-plugin"` → 0 matches.
  - `grep "skills install\|skillsInstall"` → 0 matches.
- **Gap**: Los SKILL.md están escritos pero no hay installer ni distribución empaquetada. T3.13 del sprint plan declara esto explícitamente pendiente.
- **Recomendación**: Crear `apohara skills install <harness>` que copie los SKILL.md a `~/.claude/skills/apohara/`, `~/.config/codex/skills/apohara/`, `~/.config/opencode/skills/apohara/`. Añadir `plugin.json` mínimo y `force-include` en `package.json` (o el manifest npx-cli equivalente).

### Hallazgo 12: Bot system con `handler.py` cargado dinámicamente (path-validated)
- **Origen culture**: `_reference/culture/culture/bots/bot.py:235-269`, `culture/bots/config.py:31-37`, `culture/bots/template_engine.py:1-68`.
- **Apohara actual**:
  - `crates/apohara-pathsafety/src/lib.rs` — provee la primitiva de validación (`validate_cwd`, `SymlinkEscape`, `EscapesRoot`).
  - `src/core/safety/runnerPolicy/` — policy compiler para runners.
  - NO existe un bot system YAML-driven + custom handler script + fires_event chain ni template engine.
- **Status**: PARCIAL
- **Evidencia**:
  - `crates/apohara-pathsafety/src/lib.rs:8-12` — invariantes para evitar symlink escape están implementadas (la mitad del valor de #12).
  - `grep "fires_event\|firesEvent\|template_engine\|handler.py\|bot.yaml"` → 0 matches.
  - `grep "rate_limit.*handler\|per_handler"` → 0 matches.
- **Gap**: La primitiva de seguridad (path validation) existe, pero no hay un task-plugin / agent-hook YAML system que la consuma. No hay template engine ni rate limit per-handler.
- **Recomendación**: Si Apohara expone task templates declarativos, reutilizar `apohara-pathsafety` antes de cualquier `await import()` dinámico. Si no, dejar esto fuera de scope: el valor incremental sin un sistema de extensions es bajo.

### Hallazgo 13: Cross-platform service installer (systemd-user / launchd / schtasks)
- **Origen culture**: `_reference/culture/culture/persistence.py` (312 LoC).
- **Apohara actual**:
  - `crates/apohara-persistence/src/lib.rs` — `build_systemd_user_unit`, `build_launchd_plist`, `build_windows_schtasks` con validación de input agresiva (rechaza `\n`, `\r`, `%`, prefijos `@/-/+/:/!`).
  - `xml_escape` para plist values.
- **Status**: COMPLETO
- **Evidencia**:
  - `crates/apohara-persistence/src/lib.rs:1-7` — header refiere §0.20.
  - `crates/apohara-persistence/AGENTS.md:12` — "USER-LEVEL ONLY, never system daemons".
  - Validación de input excede a culture (que no validaba `%` ni prefijos de specifier).
- **Justificación COMPLETO**: implementa los 3 backends + endurece la superficie de injection más allá del original.

### Hallazgo 14: Peek attribution nick `<server>-<agent>__peek<hex>` + CR/LF sanitization
- **Origen culture**: `_reference/culture/culture/observer.py:70-105`, `_reference/culture/docs/agentirc/peek-clients.md`.
- **Apohara actual**:
  - `src/core/orchestration/tasks.ts:22-30` — `parentId` en task rows (cadena padre→hijo en DB).
  - `src/lib/sanitize.ts` — `redact()` para API keys (NO para CR/LF/control chars).
  - `src/core/persistence/envSanitizer.ts` — bloquea env vars sensibles (otro dominio).
  - No existe `APOHARA_INVOCATION_ID` ni nick scheme attribution.
- **Status**: PARCIAL
- **Evidencia**:
  - `grep "parent_id\|parentId" src/core/orchestration/tasks.ts` → confirmado (chain reconstructible).
  - `grep "invocation_id\|APOHARA_INVOCATION_ID"` → 0 matches.
  - `grep "sanitize_for_irc\|stripControlChars\|controlCharRe"` → 0 matches (`redact` solo cubre API keys).
- **Gap**: La cadena padre→hijo existe a nivel DB (tasks.parent_id) pero no a nivel CLI invocation (no hay env var heredada). Falta la sanitization de CR/LF/control chars para strings que entran a JSONL/logs.
- **Recomendación**: (1) Inyectar `APOHARA_INVOCATION_ID = "<parent>-<crypto.randomBytes(2).hex()>"` en cada cli-driver spawn. (2) Añadir `sanitizeLineProtocol(s)` que filtre `[0x20, 0x7F)` y aplicarlo al payload de `EventLog` antes de write al ledger.

### Hallazgo 15: Stable stdout/stderr contract + `--json` errors `{code, message, remediation}`
- **Origen culture**: `_reference/culture/culture/cli/_output.py`, `_reference/culture/culture/cli/_errors.py`, `_reference/culture/culture/cli/__init__.py:66-91`.
- **Apohara actual**:
  - `src/core/cli/errors.ts` — `ApoharaError { code, message, remediation, exitCode }`, constantes `EXIT_SUCCESS=0`, `EXIT_USER_ERROR=1`, `EXIT_ENV_ERROR=2`.
  - `src/core/cli/output.ts` — `emitResult`, `emitError`, `emitDiagnostic` con `jsonMode` propagation; `installCrashHandler` para unhandled rejection.
- **Status**: COMPLETO
- **Evidencia**:
  - `src/core/cli/output.ts:1-13` — header refiere §0.9 + nota "Apohara CLI must be parseable by other LLMs".
  - `emitError` coerce loose shapes a fully-populated payload (defensivo).
  - `emitDiagnostic` separa `_diagnostic: true` flag para JSON mode.
  - `tests/core/cli/output.test.ts` cubierto.
- **Justificación COMPLETO**: tres helpers + tres exit codes + crash handler idempotente. Falta solo el switch CLI-level `--json` cableado a cada subcommand (existe la primitiva, no la integración top-level).

---

## Apéndice — Top 3 gaps de mayor valor

1. **#2 Filter DSL** — ~200 LoC TS sin deps, habilita predicados declarativos en `apohara.yaml`, agent-hooks rules, capability targeting. Bloquea #9 (decentralized config).
2. **#10 Whisper protocol** — único mecanismo real-time para que el judge/critic corrija drift sin romper contrato de stdout. Complementa el ledger SHA-256 (post-mortem) con intervención en vivo.
3. **#6 Universal verbs `explain/overview/learn`** — auto-documentación agent-first nativa; sin esto el "skill bundle" (#11) es estático y los agentes redescubren el CLI cada vez.

## Apéndice — COMPLETOS bien justificados

- `#3 attention` → `crates/apohara-attention/src/lib.rs` (commits `0e4e892`, `ced2964`).
- `#4 audit` → `crates/apohara-audit/src/lib.rs` (commit `1694a8a`).
- `#5 secrets` → `crates/apohara-secrets/src/lib.rs` (refina culture con Zeroize).
- `#8 atomic-write` → `src/core/persistence/atomicWrite.ts` (refina con datasync).
- `#13 persistence` → `crates/apohara-persistence/src/lib.rs` (refina con input validation).
- `#15 stdout/stderr contract` → `src/core/cli/{errors,output}.ts`.
