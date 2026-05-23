I have more than enough context now. Let me deliver the comprehensive analysis. I'll skip looking at remaining ancillary files since I've captured the architecturally significant patterns.

---

# Symphony → Apohara v1.0: Análisis Exhaustivo

Symphony (openai/symphony) es un service Elixir/OTP que orquesta agentes Codex contra issues de Linear. Su core es **un solo SPEC.md de 2169 líneas language-agnostic** + una reference implementation Elixir/Phoenix/Bandit. Es scheduler/runner deliberadamente minimal (no tracker writes en el orchestrator, no persistent DB). El SPEC.md es el verdadero "producto"; el código Elixir es prueba viva.

A continuación, los hallazgos **NUEVOS** para Apohara v1.0, priorizados por valor.

---

## 1. SPEC como contrato versionable con RFC-2119 + "Implementation-defined" + Validation Profiles

**Qué.** SPEC.md adopta lenguaje normativo formal (RFC 2119: MUST/SHOULD/MAY/REQUIRED) y un concepto explícito `Implementation-defined` (sección "Normative Language"). Define **tres validation profiles** (`Core Conformance`, `Extension Conformance`, `Real Integration Profile`) y los aplica fila por fila al test matrix (§17) y al Definition of Done (§18). Cada bullet de DoD se etiqueta a un profile.

**Dónde.** `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/symphony/SPEC.md:9-14, 1916-2107`

**Por qué inspira.** El SPEC.md parser de Apohara ya consume frontmatter + acceptanceCriteria, pero no distingue niveles de conformance. Permitiría a Apohara declarar qué partes de un spec son obligatorias para considerar implementación "core compliant" vs "extension" vs "production-ready".

**Cómo traducir.** Extender el schema YAML del SPEC.md de Apohara para soportar:
- `normative.language: rfc2119` (toggle de strict-keyword parsing en decomposer)
- Por cada acceptanceCriterion / acceptance check, etiquetar `profile: core | extension | integration`
- Verification-mesh (judge/critic) recibe el profile y aplica diferente threshold (judge core debe ser unanime, extension puede ser mayoría)
- DoD generator filtra por profile cuando emite reportes

**Valor.** Convierte un spec en un contrato testeable que distingue "must ship" de "nice to have" — útil cuando Apohara coordina múltiples providers que pueden no soportar las mismas features.

---

## 2. WORKFLOW.md como "policy-as-code" repositorio-owned + hot-reload con last-known-good fallback

**Qué.** Symphony separa **policy** (WORKFLOW.md, owned by repo, version-controlled) de **service** (Symphony binary). El loader hace YAML frontmatter + markdown prompt body split; **detecta cambios al archivo (poll cada 1s con mtime+size+phash2) y re-aplica config + prompt sin reiniciar el proceso** (`WorkflowStore` GenServer). Si un reload falla, el servicio sigue corriendo con la **última config válida** y emite error visible al operador. Cambios al puerto HTTP no rebindean (excepción explícita documentada).

**Dónde.**
- SPEC: `SPEC.md:289-345, 522-541` (§5.1, §6.2)
- Código: `elixir/lib/symphony_elixir/workflow_store.ex` (GenServer + state.stamp con `{mtime, size, :erlang.phash2(content)}`)
- Loader: `elixir/lib/symphony_elixir/workflow.ex:85-114`

**Por qué inspira.** Apohara hoy tiene un parser SPEC.md robusto pero asume reload manual. El patrón "policy in repo + service hot-reloads" desacopla a operadores (que editan WORKFLOW.md) de la infra (que solo corre Apohara binary). Crítico para Apohara desktop Tauri: el usuario edita su SPEC y ve los cambios reflejarse sin reiniciar.

**Cómo traducir.**
- En el Rust core de Apohara: nuevo crate `apohara-workflow-watcher` usando `notify` (inotify/FSEvents/ReadDirectoryChangesW) en lugar de polling.
- Mantener un cache `LastKnownGoodSpec` por feature; si parse falla, log structured error pero seguir orquestrando con el cache.
- Distinguir explícitamente qué campos del spec son **live-reloadable** vs **restart-required** (ej. puerto del HTTP server vs `max_concurrent_agents`).
- Coordinator escucha eventos `WorkflowReloaded { fields_changed: [...] }` y los aplica a in-flight orchestration sin matar sessions activas.

**Valor.** Convierte SPEC.md de "doc estática" a "control plane viva" — el usuario puede ajustar concurrency, agent policy o prompts en tiempo real.

---

## 3. Decomposed lifecycle: separar "Orchestration States" (claim) de "Run Attempt Phases" (lifecycle) de "Tracker States" (external)

**Qué.** SPEC §7 distingue **tres state machines independientes**:
1. **Orchestration States** (`Unclaimed | Claimed | Running | RetryQueued | Released`) — interno al scheduler
2. **Run Attempt Lifecycle** (`PreparingWorkspace → BuildingPrompt → LaunchingAgentProcess → InitializingSession → StreamingTurn → Finishing → Succeeded/Failed/TimedOut/Stalled/CanceledByReconciliation`) — 11 fases por intento
3. **Tracker States** (externos: Linear `Todo|In Progress|...`)

Y crítico: Una transición exitosa (`Succeeded`) **no es terminal** desde el orchestrator. Después de una salida normal del worker el orchestrator programa un **continuation retry** corto (1s) que vuelve a chequear el tracker para decidir si arrancar otro turn. Es decir, success ≠ done.

**Dónde.** `SPEC.md:598-694, 1865-1913` y `elixir/lib/symphony_elixir/orchestrator.ex:200-244` (handle_agent_down con :normal → schedule_issue_retry attempt=1 delay_type=:continuation).

**Por qué inspira.** Apohara tiene scheduler + ledger SHA-256 + verification-mesh, pero la separación rígida entre "claim state" y "phase state" no parece explícita. Si Apohara mezcla "task is running" con "task succeeded but pending verification" se vuelve frágil.

**Cómo traducir.**
- Orchestration DB SQLite ya planeada → tablas separadas: `orchestrator_claims` (issue_id, claim_state, claim_token) y `run_attempts` (attempt_id, phase, started_at, finished_at, error).
- Coordinator semántico expone `Claim` API: `claim()`, `release()`, `retry_with_backoff()`, **independiente** del lifecycle del agent provider.
- BaseAgentProvider refactor: cada provider reporta phase transitions (`phase=PreparingWorkspace`, `phase=StreamingTurn`) que se enrutan al orchestrator. Provider NO controla retry decisions.
- Continuation-retry pattern: cada task que completa "normalmente" no se marca como done hasta que el coordinator confirme via re-check (puede ser polling git, polling tracker, polling test results).

**Valor.** Permite distinguir "agent terminó su turn" de "task está done", evitando ciclos perdidos donde un agent dice "completé" pero el tracker o tests dicen "sigue activo".

---

## 4. Continuation turns vs Retry turns: dos delays muy distintos en la misma queue

**Qué.** El retry scheduler tiene **dos clases de delay**:
- **Continuation retry**: delay fijo `1000ms` después de salida normal — para re-chequear si el issue sigue activo y arrancar otro turn en el mismo thread.
- **Failure retry**: exponential backoff `min(10000 * 2^(attempt-1), max_retry_backoff_ms)` con cap (default 5 min).

El mismo `RetryEntry` lleva un `delay_type: :continuation | :failure` para decidir qué fórmula aplicar. Dentro del worker (no del orchestrator), el primer turn usa **full rendered prompt**; los continuation turns subsecuentes envían **solo continuation guidance** ("the previous turn completed normally, resume from current workspace state, don't restate task") al mismo live Codex thread — la conversación con el agent se preserva.

**Dónde.**
- SPEC: `SPEC.md:626-637, 751-760, 1230-1237`
- Orchestrator: `elixir/lib/symphony_elixir/orchestrator.ex:13-15, 1172-1183`
- AgentRunner: `elixir/lib/symphony_elixir/agent_runner.ex:133-145` (build_turn_prompt con turn_number=1 vs >1)

**Por qué inspira.** Apohara tiene retry pero (por lo descrito en el contexto) no parece distinguir "agent quiere seguir trabajando" de "agent crasheó". Mezclar ambos en un único exponential backoff causa loops innecesariamente lentos para tasks legítimas en progress.

**Cómo traducir.**
- Scheduler de Apohara: enum `RetryReason { Continuation, TransientFailure, StallDetected, ProviderError }`. Continuation = fixed 1s; Failure = exponential cap; Stall = also exponential pero con reason marcada.
- Two-tier transcript ya planeado → el tier "inner conversation" del provider debe preservarse a través de continuation turns; el outer transcript registra `turn_count` y el delta entre turns.
- Provider wrapper expone `continue_turn(previous_session_id)` vs `start_turn(fresh_prompt)` — diferente prompt template.

**Valor.** Throughput dramáticamente mejor en tasks largas (donde 80% de los "agent exits" son continuation-eligibles, no fallas).

---

## 5. Tres reconciliation passes por tick: stall detection + tracker state refresh + missing-issue cleanup

**Qué.** Cada poll tick ejecuta reconciliation **antes** del dispatch loop, en este orden estricto:

**Pass A — Stall detection (`reconcile_stalled_running_issues`):** Por cada running issue, calcula `elapsed_ms` desde `last_codex_timestamp` (o `started_at` si nunca emitió evento). Si excede `codex.stall_timeout_ms` (default 5min) → mata el worker y schedule retry. Si stall_timeout ≤ 0 → skip detection.

**Pass B — Tracker state refresh:** Fetch states para todos los running ids. Por cada:
- terminal state → kill worker + cleanup workspace
- still active → update in-memory issue snapshot (en `running_entry.issue`)
- neither active nor terminal (ej. "Human Review") → kill worker **sin** cleanup workspace

**Pass C — Missing-issue cleanup:** Si un running_id no apareció en el fetch results, también termina (asume issue borrado/oculto).

Si state refresh falla, **mantiene workers running** (no provoca crashes) y reintenta next tick.

**Dónde.** `elixir/lib/symphony_elixir/orchestrator.ex:300-505, 557-614`, SPEC `SPEC.md:779-808`

**Por qué inspira.** Apohara verification-mesh (judge/critic) está orientada a output verification. Pero falta un loop equivalente de **runtime reconciliation** del estado externo — qué pasa si el agent provider se cuelga sin reportar, si el GitHub PR fue cerrado durante el run, si el ticket fue cancelado. El smart-attention ya planeada se beneficiaría de este loop.

**Cómo traducir.**
- Coordinator añade `ReconciliationTick` cada `poll_interval_ms` (configurable, no por-feature) que:
  1. Stall detection por todas las orchestrations vivas (comparando ledger timestamps).
  2. External-state refresh: poll github-bridge para PR states, poll tracker workflows, poll workspace fs para detectar cambios manuales.
  3. Drift detection: comparar el estado actual del repo/PR/tracker contra el preamble del dispatch — si divergen, registrar en orchestration DB y notificar smart-attention.
- Permission patterns: cuando una orchestration es "ineligible" (issue cancelado, PR cerrado), provider session debe matarse limpio sin matar el workspace (preservar evidencia para post-mortem).

**Valor.** Apohara deja de "creer ciegamente" en el ledger interno y verifica el mundo real cada N segundos. Smart-attention puede priorizar cuáles drifts requieren intervención humana.

---

## 6. Workspace path safety: 3 invariantes formales + sanitización + symlink-escape detection

**Qué.** SPEC §9.5 define tres invariantes que un implementer **MUST** cumplir:
1. `cwd == workspace_path` antes de lanzar el agent subprocess.
2. `workspace_path` debe tener `workspace_root` como prefix después de canonicalización (resolver symlinks).
3. Workspace dir name sólo `[A-Za-z0-9._-]`, demás chars → `_`.

La implementación Elixir va más allá: `PathSafety.canonicalize` resuelve symlinks segment-by-segment, y detecta el caso "el path parece estar dentro del root pero al resolver symlinks escapa" como un error específico `:workspace_symlink_escape` distinto de `:workspace_outside_root`. Pre-launch validation rechaza ambos.

**Dónde.**
- SPEC: `SPEC.md:886-905, 1618-1629`
- Path safety: `elixir/lib/symphony_elixir/path_safety.ex` (entera, 50 lines elegantes con segment-by-segment lstat + read_link_all + recursión)
- Workspace validation: `elixir/lib/symphony_elixir/workspace.ex:358-398`
- AppServer cwd validation: `elixir/lib/symphony_elixir/codex/app_server.ex:147-187`

**Por qué inspira.** Apohara-sandbox crate cubre execution sandbox, pero un agent malicioso (o mal-prompt) puede pedir al provider hacer `cd /tmp/../../etc` o usar symlinks plantados. El symlink-escape check específico es defensa real.

**Cómo traducir.**
- Crate `apohara-pathsafety` (Rust) con `canonicalize_recursive(path: &Path) -> Result<PathBuf, PathSafetyError>` que reproduce el algoritmo Elixir (lstat + readlink loop con detección de cycle / max depth).
- Workspace reliability ya planeada → preflight validation:
  ```rust
  enum WorkspaceSafetyError {
      EscapesRoot { canonical: PathBuf, root: PathBuf },
      SymlinkEscape { surface: PathBuf, target: PathBuf },
      InvalidCharsInIdentifier(String),
      EqualToRoot,
  }
  ```
- Antes de cada CLI provider invocation: `validate_cwd(&task.workspace, &config.workspace_root)?` — falla la task, no el orchestrator.
- Sanitization: `safe_identifier(s: &str) -> String` con regex `[^a-zA-Z0-9._-]` → `_`.

**Valor.** Defensa explícita contra symlink attacks que un container sandbox no cubre (porque el container ya está dentro del workspace root del host).

---

## 7. Workspace hooks como "ciclo de vida operacional" extensible: 4 hooks + timeout + truncation

**Qué.** Cuatro shell hooks con semánticas precisas y diferenciadas:
- `after_create` (fatal failure → aborta workspace creation)
- `before_run` (fatal failure → aborta attempt actual)
- `after_run` (failure logged + ignored — always runs después de cualquier outcome)
- `before_remove` (failure logged + ignored — cleanup proceeds anyway)

`hooks.timeout_ms` (default 60_000) aplica a todos. Hook output se **trunca a 2048 bytes** antes de loggear (sanitize). Hooks corren via `sh -lc <script>` con `cwd=workspace_path, stderr_to_stdout`. Para SSH remoto, los hooks se serializan a shell script y se ejecutan via ssh con el mismo timeout.

El truco brillante: `before_remove` puede ejecutar lógica de cleanup (ej. cerrar PR de GitHub asociado al branch antes de borrar el workspace), implementado en `Mix.Tasks.Workspace.BeforeRemove` que se invoca desde el hook.

**Dónde.**
- SPEC: `SPEC.md:385-406, 861-905`
- Hooks impl: `elixir/lib/symphony_elixir/workspace.ex:165-356` (con Task.async + Task.yield para timeout + Task.shutdown brutal_kill on timeout)
- Output sanitization: `workspace.ex:346-356`
- before_remove example: `elixir/lib/mix/tasks/workspace.before_remove.ex` (cierra PRs antes de remover workspace)

**Por qué inspira.** Apohara tiene CLI wrapper providers + sandbox, pero no parece tener un hook system unificado para "antes/después de cualquier provider session". Y el patrón before_remove como punto de extensión para "cleanup external state" (PR, tracker comment, etc.) es valiosísimo.

**Cómo traducir.**
- Schema YAML del SPEC.md de Apohara: nueva sección `hooks: { before_decompose, after_decompose, before_dispatch, after_dispatch, before_verify, after_verify, before_consolidate, after_consolidate }` con `timeout_ms` global.
- Sidecar `apohara-hooks` (Rust + Bun) que ejecuta los scripts con timeout estricto + output truncation a N bytes + estructured logging (`hook=<name> task_id=<...> exit_code=<...> truncated=<bool>`).
- Categorizar cada hook como `fatal | best_effort` para igualar la semántica diferenciada de Symphony.
- "before_remove" → "after_consolidate" cleanup hook para cerrar PRs, post tracker comments, archivar logs, etc.

**Valor.** Punto de extensión universal sin tocar el core de Apohara. Usuarios pueden bootstrap workspaces, validar tests pre-dispatch, archivar artifacts post-verify.

---

## 8. JSON-RPC 2.0 stdio framing con line buffering + noeol/eol pattern + non-JSON line tolerance

**Qué.** El cliente Codex es JSON-RPC 2.0 sobre stdio con line-framed messages (max line size 1 MB / 10 MB recommended). El receiver loop maneja explícitamente:
- `{:data, {:eol, chunk}}` — línea completa, decodifica JSON
- `{:data, {:noeol, chunk}}` — línea parcial, acumula en `pending_line`
- Líneas non-JSON (ej. stderr leak, banner messages) → log como `debug` (o `warning` si contiene "error/fail/panic"), **continúa receiving** sin matar la session
- `{:exit_status, status}` → terminal error `:port_exit`
- Timeout per-read vs per-turn diferenciados (`read_timeout_ms` default 5s vs `turn_timeout_ms` default 1h)

Para handshake: `initialize` (id=1) → wait response → `initialized` notification → `thread/start` (id=2) → wait response with thread_id → `turn/start` (id=3) → stream loop.

**Dónde.** `elixir/lib/symphony_elixir/codex/app_server.ex:9-14, 340-440, 922-980` y SPEC `SPEC.md:906-1015`

**Por qué inspira.** Apohara wraps CLI providers (claude/codex/opencode `--pure`), y `--pure` modes típicamente son line-framed JSON. La distinción `eol/noeol` y la tolerancia a líneas non-JSON entremezcladas son detalles concretos que evitan que un stderr leak del provider mate la session.

**Cómo traducir.**
- BaseAgentProvider refactor: `LineFramedTransport` con buffer `pending_line: String`. `read_line()` retorna `Frame::Json(Value) | Frame::NonJson(String) | Frame::EndOfStream`.
- Provider drivers procesan Frame::NonJson logueando con severity heurística (regex `(error|warn|warning|failed|fatal|panic|exception)` → warn; sino debug).
- Dos timeouts: `provider.read_timeout_ms` (sync request/response) y `provider.turn_timeout_ms` (total stream). Stall detection del orchestrator es la **tercera** capa.
- Internal MCP servers: si Apohara expone MCP a providers, mismo pattern de framing aplica.

**Valor.** Robustness contra providers ruidosos. Apohara no se cae cuando claude/codex emiten un warning misterioso por stderr durante el stream.

---

## 9. Dynamic tool exposure: declarar tools client-side al provider con strict input schema + structured error envelope

**Qué.** Symphony advertise un set de "client-side dynamic tools" al Codex app-server en el `thread/start` payload via `dynamicTools: [...]`. Solo uno está estandarizado: `linear_graphql`. Tool spec incluye `name`, `description`, **JSON Schema completo del input** (`type=object`, `required: ["query"]`, `properties: {query: string, variables: object|null}`). Cuando Codex invoca un tool, Symphony lo ejecuta y responde con un envelope **uniforme**:
```json
{
  "success": true|false,
  "output": "string",
  "contentItems": [{"type": "inputText", "text": "..."}]
}
```
Si tool no soportado: response con error pero **no mata la session** ("supportedTools" en el error msg para que el modelo aprenda).

Auto-handling de approvals: `commandApproval`/`fileChangeApproval`/`execCommandApproval`/`applyPatchApproval` se manejan con un único helper `approve_or_require(... auto_approve_requests)`. Si `auto_approve=true` → emite decision "acceptForSession". Si no → emite `:approval_required` y falla la session limpio.

Para `requestUserInput` interactivo: extrae las opciones de questions[].options[], busca "Approve this Session" / "Approve Once" / cualquier label que empiece con "approve"/"allow", auto-responde. Si no hay match → responde con un mensaje canned ("This is a non-interactive session..."). Eso evita stalls infinitos.

**Dónde.**
- Dynamic tool: `elixir/lib/symphony_elixir/codex/dynamic_tool.ex` (entera)
- App server tool routing: `elixir/lib/symphony_elixir/codex/app_server.ex:454-921`
- SPEC §10.5: `SPEC.md:1038-1095`

**Por qué inspira.** Apohara tiene Internal MCP servers + Agent-hooks HTTP loopback + Custom tool widgets. Lo NUEVO es:
1. **Approval auto-resolution decisión por config** (no caso por caso en código).
2. **Envelope estandarizado para responses** con `success/output/contentItems` que es trivialmente compatible con cualquier provider que entienda content blocks.
3. **Heurística para responder `requestUserInput` sin colgar la session** — extrae labels "Approve*", "Allow*" automáticamente.
4. **Tools declarados client-side, no MCP-server side** — el orchestrator anuncia capabilities directamente al provider sin necesitar un MCP server middleware.

**Cómo traducir.**
- Internal MCP servers de Apohara pueden permanecer, pero adicionar un canal `ClientSideToolBridge` donde el provider wrapper anuncia tools en el handshake sin necesitar un MCP server separado.
- Approval policy en frontmatter SPEC.md de Apohara:
  ```yaml
  agent:
    approval_policy:
      sandbox_approval: auto_accept_for_session
      file_changes: auto_accept_for_session
      mcp_elicitations: reject
      user_input_required: auto_answer_unavailable
  ```
- Provider wrapper expone helper `try_resolve_approval_request(request) -> ResolvedAction` con la misma heurística (buscar "approve"/"allow" labels).
- Tool response envelope unificado en BaseAgentProvider: `ToolResponse { success: bool, output: String, content_items: Vec<ContentItem> }`.

**Valor.** Apohara puede correr unattended sin que un `--require-confirmation` random del provider la cuelgue.

---

## 10. "Blocked" como estado primario distinto de "Retrying" — operator-aware orchestration

**Qué.** Symphony implementación (no en SPEC v1, pero presente en código) introduce un cuarto estado: **`blocked`**. Cuando una session emite `:turn_input_required`, `:approval_required`, o un MCP elicitation request, el orchestrator NO retry — sino que mueve el issue a `state.blocked` (map separado de `running` y `retry_attempts`). El issue sigue claimed (no se vuelve a despachar) pero ya no consume worker slot. El dashboard lo muestra como blocked con su `error` field.

Reconciliation tiene un pass dedicado `reconcile_blocked_issues` que chequea si el tracker state cambió (terminal → release; non-active → release; sigue active → keep blocked). Los blocked entries son **in-memory only** — restart limpia el map y el issue se vuelve candidate de dispatch otra vez.

**Dónde.**
- Orchestrator state: `elixir/lib/symphony_elixir/orchestrator.ex:24-44` (`blocked: %{}`)
- Block routing: `orchestrator.ex:200-244, 722-749`
- Blocked reconciliation: `orchestrator.ex:325-451`
- README mention: `elixir/README.md:28-32`

**Por qué inspira.** Apohara ya tiene Smart Attention. Pero "blocked" es un primary state, no un attention flag. Distinguir "agent está corriendo y necesita input" de "agent falló y reintenta" de "agent está done" es semánticamente fundamental para UX (Tauri dashboard) y para la verificación-mesh (un blocked task no se debe pasar al judge).

**Cómo traducir.**
- Orchestration DB SQLite ya planeada: schema `claim_state ENUM('unclaimed','claimed','running','blocked','retrying','released')`.
- Smart Attention pasa de "scoring de prioridades" a "blocked queue es siempre top priority" + scoring para el resto.
- TaskBoard kanban: nueva columna "Blocked / Needs Operator" entre "Running" y "Review".
- Block reasons enumerados: `BlockedReason::ApprovalRequired | UserInputRequired | McpElicitation | StalledAfterInputRequest | ProviderRejected`.
- Restart behavior: blocked entries son in-memory; al restart se vuelven candidates de re-dispatch (igual que Symphony). Consistencia con "scheduler state es in-memory by design".

**Valor.** Operador ve inmediatamente qué necesita su atención vs qué está fallando solo vs qué está progresando.

---

## 11. Token accounting con "absolute totals over deltas" + per-thread keying + context-window separation

**Qué.** `elixir/docs/token_accounting.md` (305 líneas) documenta una política rigurosa derivada del Codex source code:
- **Preferir absolute totals** (`thread/tokenUsage/updated.tokenUsage.total`, fallback `TokenCountEvent.info.total_token_usage`).
- **Ignorar deltas** (`tokenUsage.last`, `last_token_usage`) para dashboard/API totals.
- **NUNCA mezclar** generic `params.usage` con cumulative thread totals — clasificar por event type, no por field name.
- Key totals por `thread_id`, no por `issue_id`, porque un thread spans multiple turns.
- Trackear `absolute_total` como high-water mark: solo update si `new_total >= stored_total`.
- `model_context_window` se reporta separado de "spend" — no es un counter de uso.

Implementación: tracker entries guardan `codex_input_tokens`, `codex_output_tokens`, `codex_total_tokens` (absolute aggregates) + `codex_last_reported_*` (high-water marks para evitar double-count). El delta entre `codex_total_tokens` y `codex_last_reported_total_tokens` se agrega al `state.codex_totals` global (orchestrator-wide).

**Dónde.** `elixir/docs/token_accounting.md` (entero) y `elixir/lib/symphony_elixir/orchestrator.ex:1438-1466, 1581-1585`

**Por qué inspira.** Apohara tiene ledger SHA-256 + consolidator. Pero ledger entries con token counts mal contabilizados (delta vs total confusion) pueden duplicar costos reportados 3x-4x. Esto pasa más en multi-provider porque cada uno tiene diferente schema de usage.

**Cómo traducir.**
- Crate `apohara-token-accounting` (Rust) con:
  ```rust
  pub enum TokenSource {
      AbsoluteTotal { input: u64, output: u64, total: u64, source_event: &'static str },
      Delta { input: u64, output: u64, total: u64, source_event: &'static str },
  }
  pub struct ThreadTokenLedger {
      thread_id: String,
      absolute_total_input: u64,  // high-water mark
      absolute_total_output: u64,
      absolute_total: u64,
      last_reported: TokenSnapshot,
      model_context_window: Option<u64>,
  }
  impl ThreadTokenLedger {
      pub fn apply(&mut self, source: TokenSource) -> TokenDelta { /* absolute > stored => update; delta => ignore */ }
  }
  ```
- Per-provider adapter: traduce el schema de `usage` events de claude/codex/opencode al enum `TokenSource` etiquetando absolute vs delta.
- Consolidator suma absolutes desde el ledger, no desde events brutos.
- Two-tier transcript guarda el raw event Y el normalized TokenSource para auditability.

**Valor.** Cost reporting fiable cuando mezclás providers — single source of truth en lugar de "cada provider cuenta su propia cosa".

---

## 12. Observability dashboard con throttled rendering + sparkline + snapshot fingerprint + idle re-render

**Qué.** `StatusDashboard` GenServer renderiza terminal UI con técnicas no-triviales:
- **Snapshot fingerprint**: hash del último snapshot rendered. Solo re-render si snapshot cambió O si pasaron N ms desde el último render (idle re-render mínimo 1s para no congelar el reloj).
- **Throttle a render_interval_ms** (default 16ms = 60 fps cap). Si llega un update antes del intervalo → enqueue en `pending_content` y schedule un `flush_render` timer con el delay residual.
- **Sparkline graph**: 24-column histograma de throughput (tps) en ventana 10min, agrupado en buckets de 25s, renderizado con Unicode block chars `▁▂▃▄▅▆▇█`.
- **Token throughput (TPS)**: derivado de samples `[{timestamp_ms, total_tokens}]` con ventana móvil 5s. Pruning de samples viejos cada render.
- **Auto-width adapter**: lee `IO.columns()` para detectar ancho de terminal, ajusta column width del event column. Fallback a env `COLUMNS` o default 115.
- **Humanización de eventos Codex**: ~50 reglas que convierten `{"method": "item/commandExecution/requestApproval", "params": {"command": ["bash", "-c", "..."]}}` a `command approval requested (bash -c ...)`. Cada wrapper event y cada turn method tiene su propio formatter.
- **Diff/plan/streaming events**: muestra `plan updated (5 steps)`, `turn diff updated (12 lines)`, etc., parsing las payloads para contar.

PubSub broadcast `:observability_updated` al Phoenix.PubSub topic `observability:dashboard` cuando el orchestrator cambia state — Phoenix LiveView dashboard escucha el mismo topic.

**Dónde.**
- `elixir/lib/symphony_elixir/status_dashboard.ex` (1953 lines)
- PubSub: `elixir/lib/symphony_elixir_web/observability_pubsub.ex`
- LiveView consumer: `elixir/lib/symphony_elixir_web/live/dashboard_live.ex`

**Por qué inspira.** Apohara Tauri desktop necesita un dashboard pero "re-render on every event" es CPU killer. Las técnicas de fingerprint + throttle + flush_timer son aplicables 1-a-1 a un React frontend. Y la **humanización de eventos** es trabajo enorme que ya está hecho (incluye Codex-specific events pero la metodología aplica a cualquier provider).

**Cómo traducir.**
- Tauri frontend: hook `useThrottledSnapshot(snapshot, intervalMs=16, idleRerenderMs=1000)` que toma fingerprint con `JSON.stringify + hash` y solo re-renderiza cuando difiere o pasaron N ms.
- Crate `apohara-event-humanizer` (Rust) o módulo TS con dispatch table per-provider: `humanize_event(provider: ProviderKind, event: ProviderEvent) -> HumanReadable`. Empezar con las ~50 reglas de Symphony copiadas y portadas a claude/codex/opencode equivalents.
- Internal observability bus: emite `OrchestrationUpdate` events al Tauri frontend via Tauri's event system; el frontend usa el mismo throttling pattern.
- Sparkline component (React) consumiendo `tps_samples` con la misma ventana móvil.

**Valor.** Dashboard responsive sin overhead. Eventos legibles sin que el usuario aprenda el schema interno de cada provider.

---

## 13. SSH worker extension: ejecutar el agent en hosts remotos manteniendo orchestrator central

**Qué.** Appendix A del SPEC define un modelo de "central orchestrator + remote workers" sobre SSH. Decisiones clave:
- Orchestrator sigue siendo single source of truth para polling, claims, retries, reconciliation.
- `worker.ssh_hosts: [...]` define el pool.
- `worker.max_concurrent_agents_per_host` cap per-host.
- Cada run se asigna a un host; continuation turns **deben** quedarse en el mismo host/workspace.
- `workspace.root` se interpreta en el remote host (no en el orchestrator).
- Codex app-server se lanza via `ssh -T host bash -lc '<remote_command>'` con stdio piping.
- Preferir el "previously used host" en retries cuando está disponible (workspace locality).
- Failover: si host falla **antes** de side effects → re-dispatch a otro host. Si **después** → nuevo attempt (no failover invisible).
- Implementación least-loaded host selector con stable tie-breaking.

Test infra: `live_e2e_docker/Dockerfile + docker-compose.yml` genera dos workers SSH disposable en localhost ports, monta `~/.codex/auth.json`, verifica SSH connectivity, corre el e2e. Sin SSH hosts configurados, levanta los containers automáticamente.

**Dónde.**
- SPEC: `SPEC.md:2109-2169`
- SSH transport: `elixir/lib/symphony_elixir/ssh.ex` (entero, 100 lines elegantes)
- Worker host selection: `elixir/lib/symphony_elixir/orchestrator.ex:1217-1277`
- Remote workspace prepare: `elixir/lib/symphony_elixir/workspace.ex:48-79` (shell script serializado con `set -eu`, marker `__SYMPHONY_WORKSPACE__` para parsear output)
- E2E docker: `elixir/test/support/live_e2e_docker/{Dockerfile,docker-compose.yml}`

**Por qué inspira.** Apohara desktop podría querer offload el cómputo pesado a una workstation remota o cloud sandbox. Symphony muestra el patrón mínimo: orchestrator local + worker remoto via SSH stdio, con preservación de locality.

**Cómo traducir.**
- Apohara future extension (no v1.0): crate `apohara-remote-worker` opcional. `WorkerLocation::Local | Ssh { host: String, port: Option<u16> }`.
- Scheduler asigna location en dispatch time, lo persiste en la orchestration DB para retry preference.
- "Previously used location" pinning para continuations.
- Remote workspace setup: serializar el plan de bootstrap (hooks `after_create`) a shell script y ssh-execute con timeout.
- Test infra equivalente con docker compose o devcontainers para reproducible e2e sin depender de SSH hosts permanentes.

**Valor.** Path claro para distributed Apohara más adelante; v1.0 puede dejarlo como extension flag.

---

## 14. CLI guardrails acknowledgement: requerir flag explícito para correr sin guardrails

**Qué.** El CLI fuerza al usuario a pasar `--i-understand-that-this-will-be-running-without-the-usual-guardrails` para arrancar. Sin él, imprime un banner ANSI red/bright con caja Unicode:
```
╭──────────────────────────────────────────────────────╮
│                                                      │
│ This Symphony implementation is a low key engineering preview. │
│ Codex will run without any guardrails.               │
│ SymphonyElixir is not a supported product and is presented as-is. │
│ To proceed, start with `--i-understand-that-this-will-be-running-without-the-usual-guardrails` CLI argument │
│                                                      │
╰──────────────────────────────────────────────────────╯
```

**Dónde.** `elixir/lib/symphony_elixir/cli.ex:8-9, 105-144`

**Por qué inspira.** Pattern UX brillante: en lugar de un `--yes` genérico, el flag literal **describe lo que estás aceptando**. Imposible pasarlo accidentalmente o en CI por confusión.

**Cómo traducir.**
- Apohara CLI: ciertos modos peligrosos (ej. `--allow-network-during-agent-execution`, `--skip-verification-mesh`) requieren flags self-describing largos.
- Banner ANSI con caja Unicode el primer arranque o cuando se detecta config arriesgada (sandbox=full-access).
- Logs estructured event `cli.guardrails_bypassed { flag, user, timestamp }`.

**Valor.** Compliance pattern + audit trail + UX que disuade copy-paste sin pensar.

---

## 15. Adapter pattern con behaviour callbacks + runtime dispatch via config — base para multi-tracker future

**Qué.** `SymphonyElixir.Tracker` define un Elixir behaviour con 5 callbacks (`fetch_candidate_issues`, `fetch_issues_by_states`, `fetch_issue_states_by_ids`, `create_comment`, `update_issue_state`). El módulo Tracker hace `adapter().<method>()` donde `adapter/0` lee `Config.settings!().tracker.kind` y devuelve `Linear.Adapter` o `Tracker.Memory`. Tests inyectan `Memory` con issues hardcoded via `Application.put_env(:symphony_elixir, :memory_tracker_issues, [...])`.

Esto deja la puerta abierta para Jira/Asana/GitHub Issues sin tocar el orchestrator. SPEC §18.2 lo lista explícitamente como "Recommended Extension".

**Dónde.**
- Behaviour: `elixir/lib/symphony_elixir/tracker.ex` (47 lines)
- Linear adapter: `elixir/lib/symphony_elixir/linear/adapter.ex`
- Memory adapter (test): `elixir/lib/symphony_elixir/tracker/memory.ex`

**Por qué inspira.** Apohara github-bridge ya existe. Pero el patrón "behaviour callback + runtime adapter selection + memory fixture for tests" es el blueprint exacto para soportar tracker-agnostic operation sin romper el resto del sistema.

**Cómo traducir.**
- Trait `TrackerAdapter` en Rust:
  ```rust
  #[async_trait]
  pub trait TrackerAdapter: Send + Sync {
      async fn fetch_candidate_tasks(&self, project: &str) -> Result<Vec<Task>>;
      async fn fetch_task_states_by_ids(&self, ids: &[String]) -> Result<Vec<Task>>;
      async fn fetch_tasks_by_states(&self, states: &[String]) -> Result<Vec<Task>>;
      async fn create_comment(&self, task_id: &str, body: &str) -> Result<()>;
      async fn update_task_state(&self, task_id: &str, state: &str) -> Result<()>;
  }
  pub struct MemoryAdapter { /* test fixture */ }
  pub struct GithubIssuesAdapter { /* uses github-bridge */ }
  pub struct LinearAdapter { /* future */ }
  ```
- Registry lazy: `TrackerRegistry::resolve(config.tracker.kind)` → `Arc<dyn TrackerAdapter>`.
- Tests usan `MemoryAdapter` para reproducible orchestration sin red.

**Valor.** Multi-tracker support sin acoplar el coordinator a APIs específicas; testing rápido sin mock complejo.

---

## Resumen ejecutivo de aportes

| # | Hallazgo | Valor para Apohara | Esfuerzo (S/M/L) |
|---|---|---|---|
| 1 | RFC 2119 + Validation Profiles en SPEC | Spec más maduro, judge configurable | M |
| 2 | WORKFLOW.md hot-reload + last-known-good | Operador edita spec sin reiniciar | M |
| 3 | Tres state machines separadas (claim/phase/external) | Orchestration robusta, success ≠ done | L |
| 4 | Continuation vs Failure retry semánticos | Throughput dramático en tasks largas | S |
| 5 | Tres reconciliation passes por tick | Drift detection real con mundo externo | M |
| 6 | PathSafety con symlink-escape detection | Defensa real contra path attacks | S |
| 7 | Workspace hooks (4) con semánticas fatal/best-effort | Punto de extensión universal | M |
| 8 | Line-framed JSON-RPC con tolerancia non-JSON | Robustez contra providers ruidosos | S |
| 9 | Dynamic tools + approval auto-resolution + heuristic for input | Unattended operation sin colgarse | M |
| 10 | "Blocked" como primary state | UX semánticamente clara, prioritization correcta | M |
| 11 | Token accounting: absolutes > deltas + per-thread keying | Cost reporting fiable multi-provider | M |
| 12 | Dashboard fingerprint + throttle + sparkline + event humanizer | Tauri UI performante con UX cuidada | L |
| 13 | SSH workers (extension) | Path para distributed Apohara futuro | L (opcional) |
| 14 | Self-describing guardrail flag | UX + compliance pattern | S |
| 15 | Tracker adapter behaviour pattern | Multi-tracker sin acoplar coordinator | S |

**Inspiraciones específicas que cambian cómo Apohara procesa specs (pedido especial):**

- (#1) Profile-aware acceptance criteria: cada criterion declara `profile: core | extension | integration`, el judge/critic mesh filtra qué evaluar.
- (#2) Spec hot-reload: SPEC.md parser observa el archivo y emite eventos de cambio al coordinator sin reiniciar tasks vivas.
- (#3) `outOfScope` debería ser un state en lugar de un campo informativo — si un task drift hacia algo declarado outOfScope, la reconciliation lo bloquea.
- (#7) Sección `hooks:` en frontmatter SPEC.md como first-class citizens del schema.
- (#11) Si Apohara genera reportes de costo basados en specs, el documento `token_accounting.md` de Symphony es referencia obligada — copiar el pattern de "ignore deltas, prefer absolutes, key by thread".