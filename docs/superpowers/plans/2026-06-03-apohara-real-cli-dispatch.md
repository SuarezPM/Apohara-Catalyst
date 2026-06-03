# Apohara — Real-CLI Dispatch Fix (deliberate, high-risk)

> **STATUS: PENDING APPROVAL.** Plan formal por consenso (ralplan, deliberate mode).
> Consenso CERRADO: Planner → Architect (SOUND-WITH-CHANGES, 4 bloqueantes) →
> Critic (ITERATE, 6 MAJOR) → **rev2** → Architect (**SOUND**, bloqueantes cerrados) →
> Critic (**APPROVE**). Fecha: 2026-06-03. Branch: `feat/apohara-catalyst`.
>
> Descubierto en el dogfooding S7 (gate manual del mesh). Memoria de contexto:
> `~/.claude/projects/.../memory/real-cli-dispatch-gap.md`. NO ejecutar sin
> aprobación explícita de Pablo (la ejecución es una decisión separada).

---

## Problema (verificado en código + `--help` + reference mining)

El `CliDriver` (`crates/apohara-dispatch/src/cli_driver.rs`) spawnea TODOS los
provider-CLIs igual:
`Command::new(&req.provider_id /*=binary_path*/).arg("--print").arg(prompt)` —
INCONDICIONAL en `dispatch` (~291) y `dispatch_streaming` (~345). Es dialecto
**solo-claude** y **sin flags de auto-permiso headless** → ningún CLI real
escribe archivos → ningún blade del mesh produce diff integrable. El bake-off usa
el MISMO `CliDriver` (`dispatch_loop.rs:223,750`) → el gap es de BASE, compartido
por bake-off Y mesh.

**Hallazgo decisivo (M1):** los tests del bake-off usan `/bin/echo`
(`cli_driver_tests.rs:157,222`, `api.rs:274`) — el spawn real-CLI **nunca
produjo output de un agente real**. El "bake-off verde" es **placebo**: prueba el
plumbing de spawn/env/serialización, no que claude/codex/opencode funcionen. Por
lo tanto **real-CLI dispatch es GREENFIELD**, no una regresión a evitar.

### Dialecto correcto por provider (robado de `upstream-source`, `upstream-source`; versiones claude 2.1.159 / codex-cli 0.57.0 / opencode 1.15.13)

| Provider | Comando headless-con-escritura | Prompt |
|---|---|---|
| **claude** | `claude -p --output-format stream-json --input-format stream-json --verbose --permission-mode bypassPermissions --disallowedTools AskUserQuestion [--model M]` | **stdin** (envelope JSON) |
| **codex** | `codex exec --skip-git-repo-check --sandbox workspace-write [--model M] -` (SIEMPRE `exec`; NO `--full-auto`) | **stdin** (texto plano, el `-` final) |
| **opencode** | `opencode run --format json --dangerously-skip-permissions [--dir CWD] [--model provider/model] <prompt>` | **argv** (posicional) |

---

## (1) RALPLAN-DR Summary

**Modo: DELIBERATE** (alto riesgo: spawns + auth + permisos headless + billing + pipe-deadlock).

### Principles (4)

1. **Additive / fail-closed / CI-green-preserving — y real-CLI dispatch es GREENFIELD, no una regresión a evitar.** El "bake-off verde" es placebo (tests con `/bin/echo`); no existe un baseline funcional de real-CLI que regresionar. El deber es preservar la **suite CI verde** (plumbing con `/bin/echo`, serde, env) y fallar-cerrado, no proteger un comportamiento real inexistente.
2. **El dialecto es dato, no inferencia frágil.** El provider se identifica por un campo explícito `provider_kind` poblado desde `ActiveProvider.id` (el roster id ya disponible en el call-site), no por basename del binario (symlinks/wrappers/paru-shims lo rompen).
3. **Construcción de comando = función pura testeable sin CLIs reales; ejecución = efecto aislado y a prueba de deadlock.** El sitio de spawn sólo ejecuta un `CommandSpec` ya construido (program+args+stdin). La lógica por-provider se testea por aserción de bytes sin CLIs reales; la escritura de stdin se aísla en su propia task para no deadlockear contra el drenado de stdout.
4. **Las disciplinas de seguridad son invariantes, no features.** env-sanitize allowlist, `CLAUDE_CONFIG_DIR` aislado (no HOME), `runSerialized` per-binary con **timeout anti-wedge de la cola FIFO**, atomic writes, y stdin construido SOLO desde prompt+role sin interpolar entorno. El dialecto permisivo es seguro SOLO porque Apohara ya aísla con worktree + config-dir + seccomp.

### Decision Drivers (top-3)

1. **No hay baseline funcional de real-CLI** → el "anti-regresión del bake-off" deja de ser un driver válido; el driver real es **llegar a un real-CLI que funcione lo antes posible, fail-closed, sin romper la suite CI verde de plumbing**.
2. **Cambio de firma prompt argv→stdin (claude/codex)** introduce el **pipe-deadlock write-stdin-vs-drain-stdout** como modo de falla dominante → fuerza `CommandSpec` + escritura de stdin en task aislada + test de deadlock real.
3. **`binary_lock` se mantiene durante TODO el dispatch** (`cli_driver.rs:420-430`) → un dispatch colgado sin timeout **wedge-ea la cola FIFO entera de ese binario** → el timeout es anti-wedge permanente, no liveness opcional.

### Viable Options

**Opción A (ELEGIDA) — Reemplazo directo del `--print` por dialecto-por-provider, con kill-switch de emergencia documentado.**
El `CommandSpec`-por-provider es el path por defecto y único en producción desde el merge. Se conserva un env var de **rollback puro** `APOHARA_DIALECT_LEGACY=1` que fuerza el path argv `--print` legacy SOLO como escape de emergencia operativo (no como gate de feature), con `tracing::warn!` ruidoso cuando está activo, a remover en el mismo sprint que la limpieza S19.
- Pros: una sola ruta viva, sin gate de feature que mantener; el dogfood prueba exactamente lo que corre en producción; **sin auto-contradicción** (no hay "default OFF que deja real-CLI roto"); el kill-switch da rollback sin bifurcar la semántica de feature.
- Cons: un bug en el dialecto afecta a todos los runs desde el merge — mitigado porque (a) no hay usuarios de real-CLI hoy (greenfield), (b) el kill-switch revierte al plumbing conocido en un export, (c) los AC automatizados (deadlock/anti-wedge/cred-leak/command-spec) prueban el path antes del merge.

**Opción B (rechazada) — gate-flag `APOHARA_REAL_CLI_DIALECT`.** default-OFF reintroduce E1 (real-CLI roto por defecto) y se auto-contradice con el pre-mortem; default-ON-por-un-sprint es A con más ceremonia, sin proteger nada que el kill-switch de A no cubra, dado que no hay baseline funcional. B se reduce a A con más ceremonia.

**Opción C (invalidada) — permission-profile UI configurable.** YAGNI; un único `PermissionProfile` permisivo hardcodeado, justificado por el aislamiento worktree+config-dir+seccomp.

### Pre-mortem (5 escenarios)

- **E1 — "El path por defecto deja real-CLI roto."** *Resuelto por la decisión A:* el dialecto ES el default desde el merge. El único "roto por defecto" sería un kill-switch accidentalmente activo; mitigación: `tracing::warn!` ruidoso por spawn cuando activo, remoción trackeada en el mismo sprint.
- **E2 — "El refactor stdin filtra credenciales o rompe el aislamiento per-binary."** `build_spawn_env` NO se toca (ortogonal); test que afirma env del child sin `*_API_KEY` y `CLAUDE_CONFIG_DIR` presente con `HOME` intacto; `dispatch_streaming_serialized` sigue único entrypoint vivo.
- **E3 — "El CLI cuelga en headless y el reaper no lo cosecha."** claude SIEMPRE `--disallowedTools AskUserQuestion`; codex SIEMPRE `exec`; timeout duro + inactividad (semantic-inactivity codex) con stderr-tail; `kill_on_drop(true)` + matar process-group (anti-huérfanos opencode).
- **E4 (pipe deadlock) — "Escribir stdin secuencialmente antes de drenar stdout."** El child que emite >~64KB stdout mientras lee stdin llena su pipe de stdout, se bloquea en `write`, deja de consumir stdin, y nuestra escritura de stdin se bloquea → deadlock mutuo. *Mitigación:* escritura de stdin en su propia `tokio::spawn` task que dropea el `ChildStdin` al terminar, concurrente con los readers (`cli_driver.rs:358,379`). AC + test (Story 3).
- **E5 (cola FIFO wedged) — "Un dispatch colgado sin timeout bloquea toda la cola del binario."** `dispatch_streaming_serialized` mantiene el `binary_lock` por todo el dispatch; un claude colgado wedge-ea toda la cola FIFO de claude. *Mitigación:* timeout duro; al expirar, kill (kill_on_drop + process-group) y liberación del `binary_lock`. AC + test (Story 3).

### Plan de test expandido (deliberate)

- **Unit:** `build_command_spec(kind, &req)` por provider (aserciones program/args/stdin, flags obligatorios presentes, prohibidos ausentes); `parse_line(kind, &line)` por provider con fixtures JSON; `ProviderKind::from_roster_id`; envelope stdin SOLO desde prompt+role.
- **Integration (sin CLIs reales):** test de deadlock (helper que consume stdin hasta EOF Y emite >128KB stdout concurrente, completa sin colgar); test anti-wedge (helper que cuelga → timeout lo mata → el siguiente FIFO procede); stub que emite líneas JSON canónicas por provider → `on_line`→parser→token-accounting; stub que ignora SIGTERM cosechado por kill_on_drop.
- **E2E (gated + dogfood manual):** test `#[ignore]` con CLIs reales; dogfood manual runbook-S7 sobre `~/mesh-dogfood` gradúa la confianza (NO es el AC técnico).
- **Observability:** cada spawn logea program+args redactados (nunca prompt/tokens, §0.4) + provider_kind + duration_ms + exit/timeout/inactivity reason; kill-switch activo → `tracing::warn!`; stderr-tail en `DispatchOutcome.error`; token-accounting best-effort por provider (no panic, no bloquea).

---

## (2) Plan — Stories atómicas

**Gate por story (todas):** `cargo build --workspace` + `cargo test -p <crate>` + `cargo clippy --workspace --all-targets -- -D warnings`. Cero warnings.
**Leyenda:** 🔴 = CODE-REVIEW ADVERSARIAL obligatorio (auth/spawn/parsing).

### Story 1 — `ProviderKind` propio en `apohara-dispatch` + `provider_kind` en `DispatchRequest`
**Crate:** `apohara-dispatch`. **Riesgo:** bajo. **Code-review:** estándar.

Enum `ProviderKind` (`Claude`/`Codex`/`Opencode`) PROPIO de `apohara-dispatch`, con `from_roster_id(&str) -> Option<Self>` mapeando `claude-code-cli`/`codex-cli`/`opencode-go`. NO reusa `apohara_mcp::ProviderId`: el dep-graph es `apohara-mcp → apohara-dispatch` (`mcp/Cargo.toml:36-39`), nunca al revés; reusar el de mcp sería ciclo. La duplicación de los 3 ids canónicos es **costo necesario documentado** (comentario en el código). Agregar `pub provider_kind: Option<ProviderKind>` a `DispatchRequest`, `#[serde(default)]` (additive; `None` = path argv-legacy).

**Acceptance (testable):**
- `from_roster_id("claude-code-cli")==Some(Claude)` + codex/opencode; `from_roster_id("gemini")==None`.
- `DispatchRequest` serializado sin `provider_kind` deserializa a `None` (retrocompat wire).
- Comentario declara la duplicación-por-dep-graph y el porqué (anti-ciclo).
- Deriva `Serialize/Deserialize/Clone/Debug/PartialEq`.

### Story 2 — `CommandSpec` + command-builder puro por provider 🔴
**Crate:** `apohara-dispatch`. **Riesgo:** alto. **Code-review:** **ADVERSARIAL**.

`pub struct CommandSpec { program: String, args: Vec<String>, stdin: Option<String> }` + función pura `build_command_spec(kind: Option<ProviderKind>, req: &DispatchRequest) -> CommandSpec`:

- **`None` (legacy/kill-switch):** `program=req.provider_id`, `args=["--print", &req.prompt]`, `stdin=None`. Byte-idéntico al actual.
- **`Claude`:** `args=["-p","--output-format","stream-json","--input-format","stream-json","--verbose","--permission-mode","bypassPermissions","--disallowedTools","AskUserQuestion"]` (+`["--model",m]`); `stdin=Some(<envelope JSON>)` = `{"type":"user","message":{"role":"user","content":[{"type":"text","text":prompt}]}}`+`\n`.
- **`Codex`:** `args=["exec","--skip-git-repo-check","--sandbox","workspace-write"]` (+`["--model",m]`) `+["-"]`; `stdin=Some(prompt)` texto plano. SIEMPRE `exec`; NO `--full-auto`.
- **`Opencode`:** `args=["run","--format","json","--dangerously-skip-permissions","--dir",workspace]` (+`["--model",m]`) `+[prompt-posicional]`; `stdin=None`.

Un único `PermissionProfile` permisivo hardcodeado (Opción C invalidada). **El envelope stdin se construye SOLO desde `prompt` y `role`; ningún valor de entorno se interpola** (M6).

**Acceptance (testable, sin CLIs reales):**
- `build_command_spec(None, req)` → exacto `["--print", prompt]`, `stdin=None`.
- claude: `args` contiene `-p`, `--permission-mode bypassPermissions`, `--disallowedTools AskUserQuestion`, `--input-format stream-json`; `stdin` parsea JSON con `content[0].text==prompt`; prompt NO en `args`.
- codex: `args[0]=="exec"`, contiene `--skip-git-repo-check`+`--sandbox workspace-write`, termina en `"-"`, NO contiene `--full-auto`; `stdin==Some(prompt)`; prompt NO en `args`.
- opencode: `args` contiene `run`,`--format json`,`--dangerously-skip-permissions`,`--dir <workspace>`; prompt es el ÚLTIMO posicional; `stdin==None`.
- **M6:** test que construye el spec con env contaminado (`ANTHROPIC_API_KEY` set) y afirma que NINGÚN valor de entorno aparece en `stdin` ni en `args`.

### Story 3 — Ejecutar `CommandSpec` en `dispatch_streaming` (stdin-aware, deadlock-safe, timeout anti-wedge) 🔴
**Crate:** `apohara-dispatch`. **Riesgo:** alto (spawn + stdin-pipe + serialización + timeout). **Code-review:** **ADVERSARIAL**.

**Alcance de conversión — declarado (M3):** de los dos spawn paths que hardcodean `--print`:
- **`dispatch_streaming` (`:341-405`) → SE CONVIERTE.** Es el path real-CLI VIVO de la UI (`dispatch_loop.rs:223,750`, bake-off + mesh).
- **`dispatch` no-streaming (`:279-310`) → SE DEJA argv-legacy.** Verificado: único caller `rust_dispatch_inner` (`api.rs:28`) ← CLI `apohara` (`main.rs:205`), marcado *"legacy path kept until Phase 2 S19 delete"*. No ejerce un agente real en un flujo de usuario. Convertirlo es YAGNI sobre código condenado → se deja con nota en el código.

Diseño: `dispatch_streaming` construye el `CommandSpec` vía `build_command_spec(req.provider_kind, &req)` salvo que `APOHARA_DIALECT_LEGACY=1` fuerce `None` (rollback de emergencia, no gate de feature; `tracing::warn!` ruidoso). Spawn: `Command::new(spec.program).args(spec.args)`; si `spec.stdin.is_some()` ⇒ `.stdin(Stdio::piped())`. **La escritura de stdin va en su propia `tokio::spawn` task que toma `ChildStdin`, escribe y lo dropea (cierra) al terminar — concurrente con los readers de stdout/stderr (`:358,379`), NUNCA secuencial** (M2/E4). `build_spawn_env` NO se toca (E2). Envolver el dispatch en `tokio::time::timeout` duro; al expirar: kill (kill_on_drop + process-group), retornar `success=false` con stderr-tail (M4/E5). `dispatch_streaming_serialized` (`:420-430`) sigue único entrypoint vivo; el guard del `binary_lock` se libera al retornar (incluso por timeout).

**Acceptance (testable):**
- **M2/E4 (deadlock):** un dispatch contra un helper-fixture que **consume stdin hasta EOF Y emite >128KB en stdout concurrentemente** completa sin colgar (test con timeout de guarda). El helper DEBE ejercer backpressure real — usar `/bin/cat` con payload >128KB o un helper Rust `read_to_end(stdin)` + `write(vec![b'x'; 200_000])`. **Helpers que ignoran stdin (`echo`/`yes`) NO ejercen el backpressure y son INVÁLIDOS para este test** (un `echo` de >128KB pasa el gate sin probar nada — el `cargo test` no atrapa un test mal construido). AC textual: *"la escritura de stdin ocurre en una `tokio::spawn` independiente que dropea el `ChildStdin` al terminar; nunca en el hilo de drenado de stdout"*.
- **M4/E5 (anti-wedge):** un helper que cuelga (`sleep infinity`) es killed al expirar T; un SEGUNDO dispatch del MISMO binary_key procede (no queda wedged en la FIFO) — test que encola dos serialized dispatches, el primero cuelga, afirma que el segundo completa tras el timeout. AC textual: *"un dispatch que excede T es killed (kill_on_drop + process-group) Y el `binary_lock` queda libre para el siguiente FIFO"*.
- Integration stdin: spawn de `/bin/cat` con `stdin=Some("X")` ⇒ stdout captura `"X"`.
- Kill-switch: con `APOHARA_DIALECT_LEGACY=1`, el spec ejecutado es legacy (`--print`) aunque `req.provider_kind==Some(Claude)`; sin el kill-switch, usa el dialecto.
- **E2:** env del child sin `*_API_KEY`; `CLAUDE_CONFIG_DIR` presente cuando `config_isolation.is_some()`, `HOME` intacto.
- `dispatch` no-streaming permanece byte-a-byte `--print` (test de no-conversión + nota en código citando `main.rs:205` / S19).
- Stub que ignora SIGTERM cosechado por kill_on_drop (sin huérfano).

### Story 4 — Parser de output por provider en `apohara-token-accounting` + `success` terminal 🔴
**Crate:** `apohara-token-accounting` (parsing) + integración en `apohara-desktop-dioxus` `on_line`. **Riesgo:** medio-alto. **Code-review:** **ADVERSARIAL**.

Diseño (m7 — ubicación resuelta): el parsing por provider vive en `apohara-token-accounting`, no en `apohara-dispatch`. Justificación: token-accounting es LEAF (cero deps `apohara-*`, lo importan 4 crates); `parse_usage_snapshot` ya vive en `budget.rs:30-52` y ya tolera claude-nested + flat top-level + `None` sin panic. **El discriminante de `parse_line` es un enum PROPIO de token-accounting (o `&str`/discriminante simple), NO el `ProviderKind` de `apohara-dispatch`** — importar `ProviderKind` desde dispatch invertiría el dep-graph (token-accounting es leaf) y rompería `cargo build --workspace`; `apohara-dispatch` mapea su `ProviderKind` → ese discriminante al llamar. Firma: `parse_line(kind, line: &str) -> ParsedLine` y `parse_usage_snapshot(kind, line)`. claude stream-json: `type` system/assistant/result, `result.is_error` terminal, `session_id`, `usage`. codex/opencode: eventos JSON por línea. Línea no-matcheante ⇒ `None`. `success` final = exit code (Story 3) ∧ ausencia de `is_error` terminal claude.

**Acceptance (testable con fixtures):**
- Fixtures `tests/fixtures/{claude,codex,opencode}/*.jsonl`; `parse_line` extrae `is_error`/`session_id`/usage por provider.
- claude `{"type":"result","is_error":true}` ⇒ fallo terminal.
- Línea no-JSON o sin usage ⇒ `None` (no panic) — preserva el contrato actual.
- Token-accounting de claude byte-a-byte verde (no-regresión del test en `budget.rs`).
- Comentario declara la ubicación (leaf crate, anti-fragmentación) y que el discriminante es propio (anti-ciclo) — m7 + fleco-2 cerrados.

### Story 5 — Wire del call-site + graduación de confianza (dogfood manual, NO es AC técnico)
**Crate:** `apohara-desktop-dioxus` (`build_request`). **Riesgo:** medio. **Code-review:** estándar.

`build_request` (`dispatch_loop.rs:1016`) setea `provider_kind: ProviderKind::from_roster_id(&p.id)` (el roster id, NO el `binary_path` que hoy va a `provider_id`). Bake-off y mesh comparten `build_request` → ambos heredan el dialecto. Con Opción A, el dialecto es el default desde el merge; el kill-switch `APOHARA_DIALECT_LEGACY` es solo rollback de emergencia.

**Separación AC técnico vs graduación (m8):**
- **AC técnico (automatizado, BLOQUEA la story):** `build_request` test afirma `req.provider_kind==Some(Claude)` para `p.id=="claude-code-cli"`; `cargo test --workspace` verde. Lo que PRUEBA que stdin-dispatch funciona son los tests de M2 (deadlock) + M4 (anti-wedge) + fixtures de Story 4 — NO el dogfood.
- **Graduación de confianza (humano, runbook-S7 reproducible, NO bloquea el merge técnico):** dogfood manual sobre `~/mesh-dogfood` (`APOHARA_MESH=1 APOHARA_RUST_DISPATCH=1`, sin kill-switch), objetivo conocido; acceptance del dogfood = al menos un blade produce diff integrable. Resultado documentado en `real-cli-dispatch-gap.md`. Runbook: `docs/superpowers/runbooks/2026-06-02-s7-mesh-dogfooding-manual-gate.md`.

**Acceptance (testable):**
- `build_request` setea `provider_kind` desde `p.id` (test).
- `cargo test --workspace` verde con el dialecto por default.
- Dogfood manual verde documentado (gate de confianza, separado del AC técnico).

---

## (3) ADR — Real-CLI Dispatch Dialect

- **Decision:** Introducir `CommandSpec { program, args, stdin }` construido por la función pura `build_command_spec` por `ProviderKind` propio de `apohara-dispatch`, ejecutado como path por defecto y único en `dispatch_streaming` desde el merge (Opción A), con un kill-switch de rollback `APOHARA_DIALECT_LEGACY=1` (no feature-gate) que fuerza el argv `--print` legacy. La escritura de stdin se aísla en su propia task (anti-deadlock) y todo dispatch tiene timeout duro (anti-wedge de la FIFO). El parsing por provider se consolida en `apohara-token-accounting` (con discriminante propio, anti-ciclo). `dispatch` no-streaming se deja argv-legacy (condenado a borrado S19).
- **Drivers:** no hay baseline funcional de real-CLI (el bake-off verde es placebo); el cambio argv→stdin introduce el pipe-deadlock como modo dominante; el `binary_lock` sostenido durante el dispatch hace del timeout un anti-wedge permanente.
- **Alternatives considered:** **Opción B** (gate de feature) — rechazada: default-OFF reintroduce E1 y se auto-contradice; default-ON-por-un-sprint es A con más ceremonia. **Detección por basename** — rechazada por fragilidad; el roster id es autoritativo. **Opción C** (permission-profile UI) — invalidada por YAGNI. **Parsing en `apohara-dispatch`** — descartado a favor de token-accounting (leaf, ya tolerante, anti-fragmentación).
- **Why chosen:** post-hallazgo, sin baseline funcional, la "preservación del bake-off" no es un driver; A entrega el camino más corto y limpio a un real-CLI funcional, con rollback operativo vía kill-switch (sin bifurcar la semántica de feature) y sin la auto-contradicción del gate default-OFF. Los modos de falla del cambio (deadlock E4, wedge E5) están cubiertos por AC automatizados, no por el dogfood manual.
- **Consequences:** (+) una sola ruta viva, sin deuda de gate de feature; (+) builders/parsers 100% unit-testeables sin CLIs; (+) deadlock y wedge cubiertos por tests deterministas. (−) un bug en el dialecto afecta todos los runs desde el merge (mitigado: greenfield sin usuarios + kill-switch + AC pre-merge); (−) token-accounting best-effort por provider; (−) duplicación necesaria de los 3 ids canónicos entre mcp y dispatch (anti-ciclo, documentada).
- **Follow-ups:** (1) remover el kill-switch `APOHARA_DIALECT_LEGACY` y cualquier rama argv-legacy en el mismo sprint que la limpieza S19; (2) borrar `dispatch` no-streaming en S19; (3) timeout de inactividad semántica de codex como knob si el default resulta agresivo; (4) `--model` por UI cuando haya demanda; (5) capturar fixtures JSON reales de las 3 versiones para el suite de parsers.

---

## Trazabilidad (cambio del consenso → ubicación)

| Cambio | Reflejado en |
|---|---|
| **M1** re-derivar opción + Principle 1 greenfield | Principle 1, Drivers 1, Options → **Opción A**, E1 (resuelto) |
| **M2** deadlock AC + test | Principle 3, E4, Story 3 AC (+ fleco-1 Architect: helper que ejerce backpressure real) |
| **M3** qué paths se convierten | Story 3 "Alcance de conversión" (solo `dispatch_streaming`; `dispatch` legacy) |
| **M4** binary_lock anti-wedge + test | Principle 4, Driver 3, E5, Story 3 AC |
| **M5** E4+E5 al pre-mortem | Pre-mortem E4 + E5 |
| **M6** stdin sin material de ENV_ALLOWLIST | Principle 4, Story 2 AC |
| **m7** parsing en token-accounting | Story 4 |
| **m8** AC técnico vs dogfood de graduación | Story 5 |
| **Fleco-1 Architect** (helper deadlock no-placebo) | Story 3 AC (`/bin/cat`/helper Rust; `echo`/`yes` inválidos) |
| **Fleco-2 Architect** (discriminante propio en token-accounting) | Story 4 (anti-ciclo) |

## Veredictos del consenso
- Planner rev1 → Architect **SOUND-WITH-CHANGES** (4 bloqueantes) → Critic **ITERATE** (6 MAJOR).
- Planner rev2 → Architect **SOUND** (bloqueantes cerrados) → Critic **APPROVE**.
