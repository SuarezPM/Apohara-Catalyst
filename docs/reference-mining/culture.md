> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

I have enough. Now I'll synthesize the findings.

---

# Hallazgos en `culture` para inspirar Apohara v1.0

Repositorio analizado: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/` (Python 3.12, ~13.1.0). Es un mesh de servidores IRC para colaboración entre agentes AI (Claude/Codex/Copilot/ACP), con federación, attention bands, bots event-driven, OpenTelemetry y skills vendored como plugin packages.

A continuación, los hallazgos NUEVOS que aportan a Apohara, ordenados por valor.

---

## 1. Mesh-as-bus con eventos IRCv3-tagged (PRIVMSG + `@event` + `@event-data=<b64-json>`)

**Qué es**: AgentIRC reusa IRC como bus interno: cada evento del sistema (`user.join`, `agent.connect`, `room.create`, `server.link/unlink/sleep/wake`, `console.open`) se publica como `PRIVMSG` desde `system-<servername>` con tags IRCv3 (`@event=user.join;event-data=<base64-json>`). Los humanos ven el body legible; los bots/agents parsean los tags.

**Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/docs/superpowers/specs/2026-04-15-mesh-events-design.md` (líneas 1-150) y `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/docs/agentirc/events.md` (líneas 1-158).

**Por qué inspira**: Apohara ya tiene Agent-hooks HTTP loopback + Coordinator semántico, pero no tiene un **bus unificado donde humanos y agentes vean el mismo stream con scrollback persistente**. El truco brillante es que el mismo canal sirve para: (a) coordinación máquina-máquina, (b) observabilidad humana, (c) replay/auditoría histórica via `HISTORY RECENT`.

**Cómo traducir**: En Apohara, exponer un **EventBus dual-format** sobre el orchestration DB existente: tabla `events(ts, type, scope, payload_json, body_human)` donde `type` sigue regex dotted-lowercase (`^[a-z][a-z0-9_-]*(\.[a-z][a-z0-9_-]*)+$`). Coordinator y agent-hooks publican ahí; el TUI Tauri lo renderiza como un "system channel" con body humano + payload colapsable. Loop prevention via `_origin` tag idéntico al `SEVENT` S2S verb.

**Valor**: ALTO

---

## 2. Filter DSL seguro para reglas event-driven (parser recursive-descent, sandboxed)

**Qué es**: Mini-lenguaje de filtros (`==`, `!=`, `in`, `and`, `or`, `not`, paréntesis, dotted field refs, list literals) que evalúa contra el dict del evento. Compilado en parse-time (rechaza configs malos en load), fail-closed en campos faltantes, sin function calls (rechazadas explícitamente para evitar code-exec). 340 líneas de parser puro, cero dependencias.

**Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/bots/filter_dsl.py` (líneas 1-340). Gramática en docstring líneas 1-15. Ejemplos de uso: `"type == 'user.join' and not ('_peek' in nick)"`.

**Por qué inspira**: Apohara tiene Permission patterns y agent-hooks, pero los predicados de matching probablemente son strings glob o callbacks JS. Un DSL declarativo permite: (a) reglas en `apohara.yaml` sin JS, (b) auditoría estática (parse-time rejection), (c) zero attack surface (no `eval`).

**Cómo traducir**: TS port directo. ~200 líneas con union types (`Literal | FieldRef | Compare | And | Or | Not | ListExpr`). Usar para: filtros de capability-manifest (Thompson Sampling targeting), routing del scheduler ("verificar si task DAG contiene type=='shell' and risk in ['high','critical']"), agent-hooks ("disparar judge si verification-mesh.score < 0.8 and task.cost_usd > 0.5"). Crate Rust opcional para hot-path.

**Valor**: ALTO

---

## 3. Attention bands con state machine determinista (HOT/WARM/COOL/IDLE + decay)

**Qué es**: Cada agente mantiene un per-target attention state machine de 4 bandas, cada una con `interval_s` (poll rate) y `hold_s` (decay timer). Estímulos directos (@mention/DM) → HOT instantáneo. Estímulos ambientales (mensajes en hilos donde habló) → un step warmer, capped en WARM. Decay automático sin estímulo. Total walk HOT→IDLE: 17 min. Diseñado como state machine pura para ser unit-testable y backend-independent.

**Dónde**: 
- Doc: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/docs/attention.md` (líneas 1-137)
- Spec: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/docs/superpowers/specs/2026-05-08-dynamic-attention-levels-design.md` (líneas 1-100)
- Re-export shim: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/clients/shared/attention.py`

**Por qué inspira**: Apohara ya menciona "Smart Attention" en la spec — pero esta implementación da el **modelo formal**: bandas discretas (no funciones de decay continuas) para que el agente pueda eventualmente "elegir su atención" via tool call (`set_attention(target, band)`). Apohara puede aplicarlo a: priorización del scheduler, dispatch preamble timing, judge re-invocation cadence.

**Cómo traducir**: Crate Rust `apohara-attention` con state machine pura. `BandSpec { interval_ms, hold_ms }`, función `step(now, last_promote, current_band) -> Band`. Observabilidad: OTEL metrics `apohara.attention.transitions{from_band, to_band, cause}` (cause ∈ {direct, ambient, decay, manual}). Defaults sensatos en TS, override per-task en `apohara.yaml`.

**Valor**: ALTO

---

## 4. Audit JSONL sink con async-queue + rotación diaria UTC + fchmod 0600

**Qué es**: Sink de auditoría con `asyncio.Queue` bounded, writer task dedicado, JSONL append-only, rotación por fecha UTC + por tamaño, perms 0600 forzados via `os.fchmod` sobre el fd abierto (no `chmod` separado — evita race). En overflow se dropea (no se bloquea event loop), métrica `culture.audit.writes{outcome=error}`. Record schema canónico: `{ts, server, event_type, origin, peer, trace_id, span_id, actor:{nick,kind,remote_addr}, target:{kind,name}, payload, tags}`.

**Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/telemetry/audit.py` (líneas 1-382). Lifecycle pattern en docstring (líneas 64-73). Atomic file ops en `_write_all` (líneas 42-55), rotation en `_pick_rotation_path`/`_maybe_rotate` (líneas 178-266).

**Por qué inspira**: Apohara tiene ledger SHA-256 chain (criptográfico), pero un **audit JSONL plain** complementa para forensics human-readable, integración con SIEM/log shippers, y debugging operativo. La pattern de "fchmod sobre fd abierto" es seguridad de libro.

**Cómo traducir**: En Bun, usar `Bun.write` con `O_APPEND | O_CREAT` + `fs.fchmod(fd, 0o600)`. Cola con `asyncio.Queue` → reemplazar por `AsyncQueue` simple (`{put, get, qsize}` sobre `Promise`-based). Rotación: misma lógica de `<instance>-<YYYY-MM-DD>.jsonl` con suffix `.0`, `.1`, … al exceder `max_file_bytes`. Sidecar Rust `apohara-audit` candidato si el throughput justifica.

**Valor**: ALTO

---

## 5. OS-native credential store wrapping (Keychain/Credential Manager/libsecret) con argv-safety

**Qué es**: Wrapper unified sobre `security` (macOS Keychain), `New-StoredCredential` PowerShell (Windows Credential Manager) y `secret-tool` (libsecret/GNOME Keyring) para Linux. Linux pipe el password vía **stdin** (no argv → no expuesto en `ps`). Las contraseñas nunca tocan disco/config files.

**Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/credentials.py` (líneas 1-173). Tres operaciones: `store_credential`, `lookup_credential`, `delete_credential` con same shape.

**Por qué inspira**: Apohara declara explícitamente "NO API keys" en CLI wrapper providers, pero igual tiene **bearer tokens para Internal MCP servers** y futuros sidecars. Necesita storage seguro sin reinventar.

**Cómo traducir**: Crate Rust `apohara-secrets` usando `keyring-rs` (que ya abstrae las 3 plataformas con una API). Exponer via Tauri command para frontend. Para CLI: shell-out al binario nativo manteniendo el patrón stdin-pipe en Linux. Servicio name: `"apohara"`, scope key: `"apohara-<purpose>-<id>"`.

**Valor**: ALTO

---

## 6. Universal verbs `explain | overview | learn` dispatcher con per-topic registration

**Qué es**: Tres verbos universales registrados en cada namespace del CLI: `explain` (deep), `overview` (shallow map), `learn` (agent onboarding prompt). Cada namespace dueño implementa sus handlers via `register_topic("agents", explain=..., overview=..., learn=...)`. Unknown topic con fallback amigable. Sub-CLIs (agex, afi, irc-lens) re-exponen sus propios `explain/overview/learn` via passthrough. `--json` mode con contract `{code, message, remediation}` para parsing agéntico.

**Dónde**: 
- Dispatcher: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/cli/introspect.py` (líneas 1-320)
- Spec: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/docs/superpowers/specs/2026-04-22-agex-integration-design.md` (líneas 70-130)
- `_culture_learn` genera prompt completo: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/learn_prompt.py`

**Por qué inspira**: Apohara tiene CLI wrappers pero ningún mecanismo formal de **auto-documentación agent-first**. `learn` específicamente devuelve un prompt-ready markdown que el agente pega en su context para operar la herramienta sin re-explorarla. Esto es "Natural Language Memory" como API.

**Cómo traducir**: En `apohara-cli` (TS+Bun), añadir tres comandos top-level + un `IntrospectRegistry { register(topic, {explain, overview, learn}) }`. Cada subcomando del CLI (decompose, schedule, verify, ledger, capability) auto-registra sus handlers. Output dual mode: markdown human o JSON con `{code, message, remediation}`. Exit codes: `EXIT_SUCCESS=0, EXIT_USER_ERROR=1, EXIT_ENV_ERROR=2`.

**Valor**: ALTO

---

## 7. `_passthrough` CLI pattern: `argparse.REMAINDER` + `prefix_chars=chr(0)` para forwarding total

**Qué es**: Patrón para envolver CLIs externos (agex-cli, afi-cli, irc-lens, agentirc-cli, steward-cli) preservando 100% de sus flags — incluyendo `--help` y `--version`. Trick: `nargs=argparse.REMAINDER` + `prefix_chars=chr(0)` para que argparse no intercepte `--flags`. Adicional: bypass total de argparse para verbos forwarded vía función `_maybe_forward_to_X(argv)` antes de `parse_args()`. `SystemExit` del sub-CLI se traduce a exit code.

**Dónde**: 
- Bypass entry: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/cli/__init__.py` líneas 105-146 (`_maybe_forward_to_agentirc`, `_maybe_forward_to_steward`).
- Adapter pattern: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/docs/superpowers/specs/2026-04-22-agex-integration-design.md` líneas 100-130.

**Por qué inspira**: Apohara wrappea claude/codex/opencode CLIs `--pure`. Necesitará la misma capacidad de forwarding cuando agreguen nuevos providers o herramientas. Patrón resuelve el problema clásico de "mi CLI parent come `--help` de la child".

**Cómo traducir**: En `apohara-cli` (Bun + `commander` o custom), pre-parse `argv[0]` antes del parser principal. Si matchea forwarded verb (`apohara claude <anything>`, `apohara codex <anything>`), spawn child con `Bun.spawn({argv: argvRemaining, stdio: 'inherit'})` y propagar exit code. Esto es además crítico para "preservar transparencia" cuando el wrapper se loguea para Two-tier transcript.

**Valor**: MEDIO-ALTO

---

## 8. Atomic YAML write via `mkstemp` + `os.replace` (crash-safe config writes)

**Qué es**: Pattern aplicado consistentemente en culture: para escribir cualquier `.yaml`, primero `tempfile.mkstemp(dir=path.parent, suffix=".yaml.tmp")` (mismo filesystem → rename es atómico), escribir, `os.replace(tmp, target)`. `BaseException` handler limpia el tmp file si algo falla.

**Dónde**: 
- `save_culture_yaml`: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/config.py` líneas 481-501
- `save_server_config`: líneas 553-580
- `_save_server_raw`: líneas 513-527
- `save_mesh_config`: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/mesh_config.py` líneas 121-139
- `save_bot_config`: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/bots/config.py` líneas 127-180

**Por qué inspira**: Apohara tiene SQLite (con WAL) para orchestration DB, pero para `apohara.yaml`, `capability-manifest.yaml`, `agent-mistakes.md`, ledger checkpoints — escrituras parciales por crash matarían el sistema. La pattern es trivial y elimina la clase entera de bugs.

**Cómo traducir**: En Bun: helper `await atomicWriteFile(path, content)` que use `fs.mkstemp` (o `path + '.tmp.' + crypto.randomUUID()`) + `fs.rename`. Wrap with try/catch que `fs.unlink` el tmp en error. Documentar como invariant en internal-docs. Para Rust: `tempfile::NamedTempFile::persist`.

**Valor**: MEDIO-ALTO

---

## 9. Decentralized config con manifest + per-directory `culture.yaml` (single source of truth)

**Qué es**: Config dividida en dos niveles: (a) `~/.culture/server.yaml` con un **manifest** dict `{suffix: directory_path}`, (b) per-directory `culture.yaml` con la definición real del agente. Nicks (`<server>-<suffix>`) son **computados en load-time**, no almacenados. Rename del server NO requiere editar `culture.yaml`s — solo cambia el prefix derivado. Auto-migración silenciosa de formato legacy. Single-agent format flat + multi-agent format con clave `agents:` (auto-detected).

**Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/config.py` (líneas 102-200 dataclasses, 152-192 load, 253-289 resolve, 346-415 auto-migrate). Spec: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/docs/superpowers/specs/2026-04-09-decentralized-agent-config-design.md`.

**Por qué inspira**: Apohara tiene SPEC.md parser per-project. La pregunta abierta es ¿debería tener un `apohara.yaml` per-project que registre capabilities, providers preferidos, hooks? Este patrón muestra que la **decentralización** (config viaja con el código en git) + **manifest central** (orchestrator sabe qué proyectos están activos) es el sweet spot. El "computed nicks" idiom evita rename hell.

**Cómo traducir**: 
- Global: `~/.apohara/registry.yaml` con `{project_id: project_path}`.
- Per-project: `<project>/apohara.yaml` con `{id, providers, capabilities, hooks, mcp_servers}`.
- IDs computados (`<host>-<project_id>`) en runtime, nunca persistidos.
- Auto-detect formato single vs multi (e.g. multiple agents/workspaces por proyecto).
- Unknown fields → `extras: HashMap<String, Value>` (no fail).

**Valor**: ALTO

---

## 10. Whisper protocol: stderr-side-channel para guidance daemon→agent

**Qué es**: Mecanismo donde el daemon culture inyecta mensajes "fuera-de-banda" al agente vía stderr del CLI tool, formato `[whisper:<type>] <message>`. Types: `CORRECTION`, `REMINDER`. El agente lee stderr después de cada llamada CLI. Permite al supervisor cortar loops, inyectar context refresh, o forzar comportamiento sin contaminar el stdout JSON (contract intacto).

**Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/plugins/claude-code/skills/irc/SKILL.md` líneas 177-188 ("Whispers" section). Encoder en `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/clients/shared/ipc.py` (`make_whisper`, `MSG_TYPE_WHISPER`).

**Por qué inspira**: Apohara tiene supervisor/judge — el patrón whisper resuelve elegantemente el problema de "cómo intervengo al agente sin matar el contrato stdout". Es complementario al ledger: ledger es post-mortem, whisper es real-time correction.

**Cómo traducir**: Apohara CLI wrappers (claude/codex/opencode) ya capturan stdout/stderr. Añadir un módulo `whisper-bus` en el coordinator: cuando el judge/critic detecta drift, escribir a `<workdir>/.apohara/whispers.jsonl`; el CLI wrapper hace tail y emite `[whisper:<type>] <msg>` a stderr antes de cada respuesta. Types iniciales: `CORRECTION`, `REMINDER`, `BUDGET_WARNING`, `DRIFT_DETECTED`. Skill docs piden "always read stderr".

**Valor**: ALTO

---

## 11. Plugin packaging para Claude Code + Codex como first-class skill bundles

**Qué es**: Estructura `plugins/<harness>/{.plugin/plugin.json, skills/<name>/SKILL.md}`. Cada skill es un markdown con frontmatter `{name, description}` declarativo. `culture skills install <backend>` copia los SKILL.md al directorio del harness apropiado (`~/.claude/skills`, `~/.agents/skills`, `~/.acp/skills`, `~/.copilot_skills`). El package se distribuye via PyPI con `force-include` en pyproject.

**Dónde**: 
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/plugins/claude-code/.claude-plugin/plugin.json` (7 líneas, schema mínimo)
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/plugins/claude-code/skills/irc/SKILL.md` (líneas 1-188, manual completo del CLI)
- Install logic: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/learn_prompt.py` líneas 9-22 (`SKILL_DIRS` mapping)
- pyproject force-include: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/pyproject.toml` líneas 49-58

**Por qué inspira**: Apohara debería ofrecer plugins para CLI providers (claude-code, codex, opencode). Este patrón muestra: (a) plugin descriptor mínimo (`plugin.json` 6 keys), (b) skills como markdown human-editable (no código), (c) install command que respeta convenciones per-harness, (d) `force-include` para distribución via package manager.

**Cómo traducir**: Apohara expone `apohara skills install <harness>` que copia bundles desde `<apohara_pkg>/plugins/<harness>/skills/*/SKILL.md` a:
- `~/.claude/skills/apohara/`
- `~/.config/codex/skills/apohara/`
- `~/.config/opencode/skills/apohara/`

Skills bundled iniciales: `apohara-decompose`, `apohara-ledger`, `apohara-capability`, `apohara-verify`. Cada uno es markdown manual con frontmatter `name/description` (compatible con plugin.json schema de Claude Code).

**Valor**: ALTO

---

## 12. Bot system con custom `handler.py` cargado dinámicamente (sandbox-aware path validation)

**Qué es**: Bots configurables vía `bot.yaml` + opcionalmente un `handler.py` per-bot que se carga via `importlib.util.spec_from_file_location`. CRÍTICO: antes de cargar, valida `handler_path.resolve().relative_to(BOTS_DIR.resolve())` — si está fuera del bots dir, fallback a template (no exec). Default behavior si no hay handler: render Jinja2-style template. `fires_event` permite que un bot dispare otro evento → composición pub/sub.

**Dónde**: 
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/bots/bot.py` líneas 235-269 (`_run_custom_handler` con path-validation)
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/bots/config.py` líneas 31-37 (`EmitEventSpec`)
- `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/bots/template_engine.py` líneas 1-68 (template engine simple, dot-path resolution)
- Rate limit: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/bots/bot.py` líneas 41-53 (10 events/sec/bot)

**Por qué inspira**: Apohara podría ofrecer **task templates / agent-hook templates** definidos en YAML + opcional handler script. Pero el insight clave es la **path validation antes de exec dinámico** + **rate limiting per-handler** + **composability via fires_event**.

**Cómo traducir**: Si Apohara expone un sistema de "task plugins" (e.g. para tools custom), implementar:
- `apohara.yaml` define `tools: [{name, trigger, template, handler?}]`
- Handlers son scripts JS/TS en `<workdir>/.apohara/handlers/<name>.ts`
- Antes de `await import(path)`, validar `path.startsWith(handlersDir.resolve())`
- Rate limit per-handler (e.g. 10/sec) con sliding window
- Template engine: dot-path `{event.field.nested}` interpolation, fail-closed
- `fires_event` chain: handler return value puede ser `{emit: {type, data}}` → coordinator re-publica

**Valor**: MEDIO-ALTO

---

## 13. Cross-platform service installer (systemd-user / launchd / Windows Task Scheduler)

**Qué es**: Módulo único que genera archivos service apropiados para cada plataforma: systemd user unit (Linux), launchd plist (macOS), batch script + schtasks (Windows). Dispatch via `_PLATFORM_INSTALLERS = {"linux": ..., "macos": ..., "windows": ...}`. Operaciones: install/uninstall/list/restart. Restart resilient con timeout bounded (un systemd hung no bloquea el CLI).

**Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/persistence.py` (líneas 1-312). Builders en líneas 62-119, installers en 127-181, dispatch tables en 168/208/252/298.

**Por qué inspira**: Apohara es desktop-first (Tauri v2) pero el daemon de orchestrator + sidecars (indexer, sandbox) querrán autostart cross-platform. Esta es la ÚNICA forma legítima de hacerlo sin instalar daemons del sistema (user-level only).

**Cómo traducir**: Crate Rust `apohara-persistence` con feature flags `#[cfg(target_os = "linux/macos/windows")]`. Tauri side exposing commands `installAutostart()`, `uninstallAutostart()`, `restartService()`. Para Linux usar `~/.config/systemd/user/`, macOS `~/Library/LaunchAgents/com.apohara.<name>.plist`, Windows `schtasks /SC ONLOGON`. Timeout bounded en cada `subprocess.run`.

**Valor**: MEDIO

---

## 14. Peek client attribution: nick scheme `<server>-<agent>__peek<hex>` + realname carry

**Qué es**: Cuando un CLI command necesita ephemeral connection al mesh, el nick generado embebe el padre via formato `<server>-<agent>__peek<hex>`. Si no hay parent o es de otro server, fallback opaco `<server>-_peek<hex>`. El realname IRC siempre carga la atribución: `culture observer (parent=spark-claude)`. Filter contract: bots filtran con `not ('_peek' in nick)` (matchea ambos shapes).

**Dónde**: 
- Implementation: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/observer.py` líneas 70-105 (`_parent_suffix`, `_temp_nick`)
- Doc: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/docs/agentirc/peek-clients.md` líneas 1-78
- Input sanitization: líneas 26-36 (`_sanitize_for_irc` — strip CR/LF + control chars para prevenir IRC command injection)

**Por qué inspira**: Apohara tiene "Terminal attribution shim". Este patrón da un modelo concreto: **toda acción ephemeral (CLI command spawn) lleva el ID del padre embebido + un random suffix para uniqueness**. Permite reconstruir cadena de causalidad sin DB lookup. Sanitization de entradas (CR/LF stripping) es un must para cualquier protocolo line-based.

**Cómo traducir**: 
- Toda invocación de CLI wrapper (claude/codex/opencode) genera un `invocation_id = "<parent_session>-<crypto.randomBytes(2).hex()>"`
- Set as env var `APOHARA_INVOCATION_ID` para que el tool lo loguee
- Two-tier transcript graba con este ID → cadena padre→hijo reconstructible
- Sanitización: cualquier string que vaya a un protocolo line-based (logs, JSONL audit, IRC if used) pasa por `sanitize(s) -> [ch for ch in s if 0x20 <= ord(ch) < 0x7F]`

**Valor**: MEDIO

---

## 15. Stable stdout/stderr contract con `--json` mode estructurado para agent consumers

**Qué es**: Política estricta: **resultados a stdout, diagnostics/errors a stderr**, nunca se mezclan. JSON mode propaga la misma separación: `emit_result()` JSON a stdout, `emit_error()` JSON `{code, message, remediation}` a stderr. Argparse override (`_JsonAwareParser`) garantiza que incluso errores de parsing emitan el shape correcto bajo `--json`. Exception unexpected en main loop también respeta el contract.

**Dónde**: 
- Output helpers: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/cli/_output.py` (líneas 1-55, 5 funciones)
- Error class: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/cli/_errors.py` (líneas 1-39, exit codes 0/1/2)
- Argparse override: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/culture/culture/cli/__init__.py` líneas 66-91, 183-198

**Por qué inspira**: Apohara CLI tiene que ser **parseable por agentes** (otros LLMs invocan apohara como tool). Cualquier ruido en stdout (warnings, progress) rompe parsing. Este patrón es el contract minimal: 3 funciones (`emit_result`, `emit_error`, `emit_diagnostic`), 3 exit codes (0/1/2), guarantee de no-traceback-leak en JSON mode.

**Cómo traducir**: Helpers en `apohara-cli/src/output.ts`:
- `emitResult(data, {jsonMode, stream=stdout})`
- `emitError({code, message, remediation}, {jsonMode, stream=stderr})`
- `emitDiagnostic(msg, {stream=stderr})`

Tipo `ApoharaError { code: number, message: string, remediation: string }` con `toDict()`. Exit codes en `EXIT_SUCCESS=0, EXIT_USER_ERROR=1, EXIT_ENV_ERROR=2`. Catch unhandled rejections para emitir JSON shape en `--json` mode. Test invariant: "stdout es siempre JSON parseable en --json mode" como property test.

**Valor**: ALTO

---

# Resumen ejecutivo

**Top 6 a priorizar para Apohara v1.0** (impacto + alineamiento con stack):

1. **Mesh-as-bus eventos (#1)** — unifica coordinator + agent-hooks + auditoría humana
2. **Filter DSL (#2)** — declarativo, seguro, agent-friendly para reglas en `apohara.yaml`
3. **Universal verbs `explain/overview/learn` (#6)** — auto-documentación agent-first nativa
4. **`apohara.yaml` decentralized + manifest (#9)** — config-as-code que viaja con el proyecto
5. **stdout/stderr contract + `--json` errors (#15)** — habilita Apohara como tool de otros LLMs
6. **Whisper protocol stderr-side-channel (#10)** — judge/critic intervention sin romper transcript

**Patrones de seguridad/robustez a importar inmediatamente**:
- Atomic YAML write (#8) — invariant proyecto-wide
- Path validation antes de dynamic import (#12) — sandbox-aware
- Audit JSONL fchmod 0600 + rotation (#4)
- Sanitización CR/LF en strings que tocan protocolos line-based (#14)

**Plugin/distribución**:
- Plugin bundles para claude-code/codex (#11) — `apohara skills install <harness>`
- OS-native credential store wrapper (#5) — keyring-rs
- Cross-platform service installer (#13) — systemd-user/launchd/schtasks

**Conceptual**:
- Attention bands HOT/WARM/COOL/IDLE (#3) — modelo formal para Smart Attention de Apohara
- CLI passthrough con `REMAINDER` + `chr(0)` (#7) — wrappear nuevos providers sin perder flags