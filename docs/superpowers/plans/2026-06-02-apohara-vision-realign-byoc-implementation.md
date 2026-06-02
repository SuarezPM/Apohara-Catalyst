# Plan de implementación — Apohara BYOC (realineación colaborativa)

> **Status: pending approval** · Modo: consensus (`--consensus --direct`) · Fuente: `.omc/specs/deep-interview-apohara-vision-realign.md` (deep-interview PASSED, 12.9%)
> Generado 2026-06-02. Rev. 7 (consensus **deliberate — APPROVED**). NO ejecutar sin aprobación explícita de Pablo.

## Requirements Summary
Realinear Apohara Catalyst a su visión colaborativa **BYOC**: un orquestador local-first donde N CLIs (blades autodetectados) claman tareas de una **Shared Task List (DAG)** vía un **bus MCP**, se comunican por un **Mailbox**, trabajan en partes distintas en paralelo (mesh coordinado en vivo), y un **integrador** consolida incrementalmente con review humano continuo. Slogan: *"No routing, no fallback, only power."* Estrategia: bootstrapping (Apohara se auto-mejora). Acceptance maestro: el dogfooding test.

**Hallazgo que define el plan:** ~la mitad del andamiaje ya existe pero **huérfano**:
- `apohara-mcp/src/server.rs:122` — `McpServer` + `ToolRegistration` (`:59`) genuino y testeado. El caller del bootstrap **sí existe** (`apohara-mcp/src/api.rs:203` `mcp_bootstrap_servers_inner`, gated `APOHARA_RUST_MCP`, hace `Box::leak` en `:212`); el huérfano real es que **el desktop no depende de `apohara-mcp`** (`apohara-desktop-dioxus/Cargo.toml`).
- `apohara-dispatch/src/state.rs:28,106,126` — claim-lifecycle real (`RunState`, `can_transition`, `fresh_claim_token`) **solo usado en tests**.
- `apohara-coordinator/src/coordinator.rs:225` — `Coordinator::tick` sobre **mock** (`MockTask`, `:137`); `StallDetected` (`:246-260`) reusable.
- `apohara-dispatch/src/cli_driver.rs:225` — `dispatch_streaming` sólido (env sanitizado, backpressure) — **reusable**. ⚠️ `runSerialized` per-binary **nunca se portó** (`cli_driver.rs:4,184` "rides later G1.A tasks").
- **El dispatch productivo a providers existe y es SECUENCIAL:** `crates/apohara-desktop-dioxus/src/coroutines/dispatch_loop.rs:63` `run_dispatch` → `:79` `for p in providers` (corutina del desktop, no test — confirmado por grep). F1.4 es **reemplazo**, no construcción.
- **NO existen** (0 hits): Shared Task List/DAG ejecutable, Mailbox, claim con file-lock.

## RALPLAN-DR

### Principles
1. **Reusar antes de construir.** El andamiaje huérfano se cablea, no se reescribe.
2. **Rebanada vertical primero, y la más delgada es el CLAIM heterogéneo** — validar que 2 CLIs opacos coordinan, antes de cablear el bus.
3a. **MCP-pull (claim/check_inbox) es la lingua franca uniforme** — todo blade lo soporta (es cliente MCP vía `injection.rs:142`).
3b. **MCP-push (server→blade) NO es uniforme** — depende del hook-runtime per-CLI; entra en F2 como mejora de latencia, con el poll como fallback permanente (cumple R13: "push **+ poll de respaldo**").
4. **Humano en el loop siempre.** Ningún paso muta sin gate; anti `apohara auto`.
5. **Dogfooding como north star.** Cada fase se valida por la capacidad de Apohara de mejorarse a sí misma.

### Decision Drivers (top 3)
1. **De-riskear factibilidad con CLIs opacos** — ¿2 blades heterogéneos coordinan sin doble-asignación? Se responde primero (F0.0).
2. **Time-to-first-mesh** — habilita el bootstrapping.
3. **Reuso del código existente.**

### Viable Options
- **Opción A — Bus MCP primero.** *Cons:* pospone la validación de la tesis hasta después de pagar todo el bus.
- **Opción B — Filesystem-first.** *Cons:* sacrifica la lingua franca MCP (constraint lockeado R5).
- **Opción C (ELEGIDA) — Híbrido:** MCP-pull como bus + estado filesystem (atómico, file-lock) + push como mejora de F2. Refinada: validar el claim heterogéneo (F0.0) ANTES del bus.
- **Invalidación:** A pospone el de-risking; B rompe la lingua franca. C subsume con el reordenamiento claim-primero.

## Fases de implementación

### Fase 0 — Validar la tesis + encender el bus
- **F0.0 (PRIMERO — de-risking):** claim filesystem con **file-lock advisory real** (hoy solo `.apohara-lock` con PID, `apohara-worktree/src/lifecycle.rs:69`, no advisory). Reusar `RunState`/`fresh_claim_token` (`apohara-dispatch/src/state.rs:28,126`). **Smoke heterogéneo:** 2 procesos CLI reales (`claude` + `codex`) claman el mismo lock → exactamente 1 gana. Sin MCP, sin desktop. Responde Driver #1.
- **F0.1:** desktop **depende de `apohara-mcp`** y llama al wrapper existente `api.rs:203` (NO escribir caller nuevo). **Idempotencia del bootstrap — mecanismo concreto:** envolver el `Box::leak` (`api.rs:212`) en un `OnceCell`/guard estático para garantizar un único bus por proceso (evita fugas en re-runs / hot-reload Dioxus).
- **F0.2:** tools de bus vía `ToolRegistration` (`server.rs:59`, patrón `build_<name>_tools` de `servers/mod.rs:10`): `get_tasks`, `claim_task`, `release_task`, `report_result` (valida token), `send_message`, `check_inbox`.
- **F0.3:** smoke MCP — cliente clama vía tool y manda mensaje. *(unit + integration sobre `apohara-mcp`)*

### Fase 1 — Rebanada vertical: 2 blades colaboran (MVP)
- **F1.1 Shared Task List (DAG) + reaper de claims stale:** DAG persistido en filesystem (atómico tmp+rename) sobre el claim de F0.0. **Reaper INDEPENDIENTE del coordinator** (detección propia: TTL del token + heartbeat + PID muerto) — NO depende de `Coordinator::tick`/`MockTask`, evitando la dependencia circular F1.1↔F2.1; cuando F2.1 cablea el coordinator real, el reaper se unifica con `StallDetected` (`coordinator.rs:246`). **Race de token expirado cubierto:** `report_result` (F0.2) valida el token contra el claim **actual**; un blade que revive tras ser reapeado y reporta con token viejo es rechazado (su nodo ya fue re-clamado).
- **F1.2 Mailbox (poll):** `check_inbox` (**poll MCP — camino REQUERIDO y único de F1**, uniforme y robusto). El push server→CLI es **compromiso de F2.3** (no opcional indefinido — cumple R13), con el poll como fallback permanente.
- **F1.3 Autodetección de blades en PATH:** extender `list_active_providers` (`apohara-dispatch/src/api.rs:75`, hoy 3 ids fijos `:43`). **Manejo de blade no-MCP:** un binario detectado que NO complete el handshake/bootstrap MCP se **excluye del roster y se reporta** en el dashboard (no falla silenciosamente; cumple el constraint del spec "participa si habla MCP"). Verificar paths de config per-CLI contra upstream.
- **F1.4 Reemplazar el loop secuencial + PORTAR `runSerialized`:** sustituir `for p in providers` (`crates/apohara-desktop-dioxus/src/coroutines/dispatch_loop.rs:79`, dentro de `run_dispatch :63`) por un loop de blades que claman vía MCP. ⚠️ **BLOQUEANTE: portar la cola FIFO per-binary (`runSerialized`) ANTES de paralelizar** — 2 blades del mismo binary (`claude`) concurrentes contienden en los locks de `~/.claude/` y el 2º cuelga hasta el SIGKILL de 120s (past-incident vivido). **Orden (corregido tras Architect):** `runSerialized` es el **invariante por defecto**; el **aislamiento de estado per-blade** (`CLAUDE_CONFIG_DIR`/`HOME` propio, inyectado **post-sanitización** porque NO está en `ENV_ALLOWLIST` `:26`; + sesión/auth replicada per-HOME) **relaja** la serialización solo tras un **test verde de no-contención** para ese binary. Nunca remover la serialización sin ese gate. Cada blade ejecuta con `CliDriver::dispatch_streaming` (`cli_driver.rs:225`).
- **F1.5 Wiring IDE Mode → motor real:** Run (`left_pane.rs:29`, `objective_pane.rs:133`) despacha de verdad; `TaskBoard` refleja claim/estado real (no la proyección UI de `state/tasks.rs`); streams por blade a `SSE_EVENTS`. Detrás de flag (`APOHARA_RUST_DISPATCH`, `api.rs:22`).
- **F1.6 Integración incremental + integrador serializado:** al completar cada nodo, merge incremental (`apohara-worktree::merge`, `lifecycle.rs:155`, `--no-ff` sin lock). **Diseño elegido (resuelve la ambigüedad del "o"):** un **integrador único** (lógica interna de Apohara-Lead en el MVP, promovible a blade dedicado del roster en F2.2) **serializa todos los merges** — un solo escritor del `HEAD` compartido, sin race. + gates (`run_all_gates`) + `CodeDiffPane` muestra el diff del mesh.
- **F1.7 Dogfooding smoke (criterio maestro — GATE MANUAL, no CI):** apuntar a un clone/branch del repo, "mejorá X"; ≥2 blades claman+chatean(poll)+integran; Pablo acepta el diff. Verificación por juicio humano, no test verde automatizado.

### Fase 2 — Mesh completo + scheduler + push
- **F2.1** Cablear `apohara-coordinator` con storage real (hoy mock, `coordinator.rs:122/137`) como scheduler del DAG; storage tras trait para swap incremental. Unifica el reaper de F1.1 con `StallDetected`.
- **F2.2 Reparto equitativo configurable:** default afinidad + balanceo (reusar `auto_spawn::decide_auto_spawn`, `auto_spawn.rs:78`), configurable por proyecto. Respeta runSerialized (no 2 tareas/binary en paralelo). Opción de promover el integrador a blade dedicado.
- **F2.3 Push-hooks (mejora de latencia, cumple R13):** canal server→CLI vía el hook-runtime de cada CLI (PreToolUse/Stop reinyectando contexto). El poll de F1.2 sigue como fallback.
- **F2.4 Dashboard de utilización:** utilización por blade (anti-idle), wall-clock, gates, % aceptación, sobre `apohara-token-accounting`. Muestra blades excluidos por no-MCP (F1.3).

### Fase 3 — Planner socrático + consenso
- **F3.1** Motor socrático nativo de Apohara (lógica propia, cero tokens) → **PLAN MAESTRO (DAG)**.
- **F3.2** Modo consenso opt-in (consenso solo en fase PLAN).

### Fase 4 — Capas de producto
- **F4.1** Permisos por blade × fase (plan read-only / exec write / review humano) sobre `PermissionRequest`.
- **F4.2** Memoria persistente: `apohara-episodic` + `apohara-indexer` + persistir contexto del mesh en sqlite.
- **F4.3** Context Forge como compresión del contexto compartido (LLMLingua-2). **Es un sidecar Python externo** (`SuarezPM/Apohara_Context_Forge`, `apohara-context-forge/`), invocado **vía MCP** (tool `get_optimized_context`) — NO es una lib Rust del workspace.
- **F4.4** Modo guiado opt-in (reusa `apohara-event-humanizer`) + Vibecoding skin sobre el motor del IDE Mode.

## Acceptance Criteria (testables)
- [ ] **F0.0:** test de concurrencia — N procesos claman el mismo lock, exactamente 1 gana; 2 CLIs reales heterogéneos validados.
- [ ] **F0:** cliente MCP clama tarea + envía mensaje vía tools; tests verdes en `apohara-mcp`; bootstrap idempotente (segundo `api.rs:203` no crea un 2º bus).
- [ ] **F1 (maestro, GATE MANUAL):** abrir Apohara → clone/branch → "mejorá X" → ≥2 blades heterogéneos claman sin doble-asignación (file-lock), se comunican (poll), integran incremental verde (merges serializados, HEAD sin corromper), **sin cuelgues de 120s** (runSerialized portado), y Pablo acepta el diff.
- [ ] **F1:** autodetección lista ≥2 CLIs con paths de config correctos; un binario no-MCP se excluye y se reporta; `dispatch_loop.rs:79` ya no usa `for p in providers`.
- [ ] **F2:** `Coordinator::tick` sobre Shared Task List real; dashboard muestra cero idle mientras hay trabajo desbloqueado; reaper libera claims stale; push entrega un mensaje con latencia < poll-interval.
- [ ] **F3:** dado un prompt, el DAG resultante tiene ≥2 nodos con dependencias declaradas y 0 ciclos; en modo consenso, ≥2 blades emiten refinamientos y el plan final difiere del borrador inicial.
- [ ] **F4.1:** un blade en fase PLAN no puede escribir (read-only enforced, intento de write rechazado).
- [ ] **F4.2:** tras cerrar y reabrir, el contexto del mesh (decisiones + handoffs) se recupera de sqlite y un blade nuevo lo lee.
- [ ] **F4.3:** Context Forge comprime un contexto de prueba (≥1 llamada **vía MCP al sidecar `apohara-context-forge`** a la tool `get_optimized_context` con `tokens_saved > 0`; verificar el nombre exacto de la tool en el `mcp/server.py` del sidecar antes de escribir el test).
- [ ] **F4.4:** el modo guiado emite narración en paralelo sin frenar el dispatch; Vibecoding skin monta sobre el mismo motor del IDE Mode.

## Risks and Mitigations
| Riesgo | Mitigación | Fase |
|---|---|---|
| **`runSerialized` no existe** → 2 `claude` concurrentes cuelgan 120s (past-incident) | Portar cola FIFO per-binary ANTES de paralelizar; scheduler nunca asigna 2 tareas/binary | F1.4 (bloqueante) |
| **Merge `--no-ff` sin lock** → integraciones paralelas corrompen HEAD | Integrador único serializa todos los merges (un escritor) | F1.6 |
| **Reaper ausente / dependencia circular F1.1↔F2.1** | Reaper con detección PROPIA (TTL+heartbeat+PID), independiente del coordinator mock; se unifica en F2.1 | F1.1 |
| **Race de token expirado** (blade reapeado revive y reporta) | `report_result` valida el token contra el claim actual; token viejo rechazado | F0.2/F1.1 |
| **Blade detectado que no habla MCP** | Excluir del roster + reportar en dashboard (no falla silencioso) | F1.3 |
| **`Box::leak` → fuga de servers en re-runs** | `OnceCell`/guard estático: un bus por proceso | F0.1 |
| **Push server→CLI puede no existir** para un blade opaco | Poll (`check_inbox`) es el contrato permanente; push = mejora | F1.2/F2.3 |
| **Comentario doc stale** `adapters/opencode.rs:1` (MINOR — el caller `injection.rs:142` ya usa `opencode.jsonc`) | Corregir el comentario; verificar discovery per-CLI | F1.3 |
| **Coordinator mock→real invasivo** | Storage tras trait; swap incremental | F2.1 |
| **Scope enorme** | F0.0+F1 es la rebanada vertical que ya entrega valor | — |
| **Regresión desktop v2** | F1.4/F1.5 detrás de `APOHARA_RUST_DISPATCH`; harness visual existente | F1 |

## Verification Steps
1. `cargo build --workspace` + `cargo test -p apohara-mcp -p apohara-dispatch -p apohara-coordinator` por fase.
2. `cargo clippy --workspace -- -D warnings`.
3. **F0.0:** test de concurrencia (N claman → 1 gana) + smoke 2 CLIs reales.
4. **F1.4:** test de no-cuelgue (2 tareas del mismo binary se serializan; ninguna SIGKILL a 120s).
5. **F1 (gate manual):** correr la app (`cargo run -p apohara-desktop-dioxus`, `WEBKIT_DISABLE_DMABUF_RENDERER=1`) + dogfooding smoke.
6. **F2:** test del scheduler (cero idle con trabajo desbloqueado) + test de entrega push (latencia < poll).
7. **F3:** test del planner (prompt → DAG con deps, 0 ciclos) + test de consenso (plan final ≠ borrador).
8. **F4:** test de permisos (write en fase plan rechazado) + test de persistencia (recuperar ctx del mesh tras reinicio) + test de Context Forge (`tokens_saved > 0`).
9. `apohara doctor` / `verify-setup` verdes.

## Open Questions (resueltas en rev3, registradas)
- **Dispatch productivo:** confirmado en `dispatch_loop.rs:79` (corutina, no test). F1.4 es reemplazo.
- **Reaper vs coordinator mock:** F1.1 usa detección propia independiente → sin dependencia circular.
- **Integrador:** lógica interna de Apohara-Lead en MVP (F1.6); promovible a blade dedicado en F2.2.

**Pendientes (no bloquean, resolver al implementar):**
- **Tool MCP de Context Forge:** verificar el nombre exacto en `apohara-context-forge/.../mcp/server.py` antes del test de F4.3.
- **Criterio de no-contención (F1.4):** definir cuántas corridas concurrentes sin cuelgue prueban "aislamiento verde" antes de relajar `runSerialized` para un binary.

## Pre-mortem (modo deliberate — 3 escenarios de fallo)
*Asumí que el proyecto fracasó. ¿Por qué? — y cómo lo prevenimos.*

### Escenario 1 — "El mesh heterogéneo nunca cooperó de verdad"
El smoke de F0.0 pasó con 2 procesos triviales, pero `claude` y `codex` **reales** nunca coordinaron: uno ignoró el contexto del mailbox, el otro no respetó el claim, y "trabajar en partes distintas" degeneró en pisarse archivos.
- **Causa raíz:** un CLI opaco no tiene incentivo nativo de chequear el claim/mailbox — el MCP-pull es *disponible* pero no *forzado*. Si el blade no llama `claim_task`/`check_inbox`, el mesh no existe.
- **Señal temprana:** en F0.0, 2 blades reales con una dependencia real (no solo el lock) — si uno escribe sin clamar, falla acá, no en F1.
- **Mitigación:** el **prompt de spawn de cada blade DEBE instruir explícitamente** "clamá antes de tocar archivos; `check_inbox` cada N pasos" (el `DispatchRequest.prompt` de `cli_driver.rs:134` es el punto de inyección). El claim se vuelve protocolo-por-convención reforzado por el prompt + los hooks PreToolUse (bloquear writes sin claim activo). **Refuerza el acceptance de F0.0** con coordinación real, no solo exclusión mutua del lock.

### Escenario 2 — "`runSerialized` colapsó la paralelización a ~secuencial"
Para evitar el cuelgue de 120s se serializó per-binary. Pero el roster real es mayormente **el mismo binary** (varios `claude` con distinto config/rol) → la serialización mató el paralelismo y el "máximo poder" se evaporó.
- **Causa raíz:** el anti-idle asume blades de binarios distintos, pero BYOC permite **N instancias del mismo binary**; el cuelgue viene de contender en `~/.claude/` compartido, no del binary en sí.
- **Mitigación (corregida tras Architect):** **`runSerialized` per-binary es el INVARIANTE de seguridad por defecto** (siempre activo en F1.4; garantía determinista anti-cuelgue). El **aislamiento de estado per-blade** (HOME/config dir propio) es una **optimización que RELAJA la serialización solo tras un test verde de no-contención** para ese binary. ⚠️ Dos correcciones de código: (a) `CLAUDE_CONFIG_DIR` **NO está en `ENV_ALLOWLIST`** (`cli_driver.rs:26`) → `sanitize_env` lo elimina; hay que inyectarlo **post-sanitización** (como los markers `APOHARA_*` en `:110`), no confiar en el overlay. (b) Aislar HOME es un movimiento de **auth**, no solo de concurrencia: cada blade necesita su sesión/credenciales en el HOME aislado o arranca sin login (zona del past-incident *wrong-account-billed*). **Mover a F1.4 como sub-tareas explícitas.** Aislamiento parcial = heisenbug peor que serializar → nunca remover la serialización sin el test de aislamiento verde per-CLI.

### Escenario 3 — "El dogfooding nunca convergió: los diffs eran incompatibles"
F1 llegó a "2 blades producen un diff" pero la integración + review nunca cerró: los diffs sobre el mismo objetivo eran incompatibles, el integrador serializado se volvió cuello de botella, y Pablo rechazó todo.
- **Causa raíz:** descomponer un objetivo en partes **verdaderamente ortogonales** (DAG sin solapamiento de archivos) es el problema difícil; sin buena descomposición, el mesh produce conflictos, no valor. F1 asume el DAG dado, pero el DAG nace en F3 (planner).
- **Tensión de ordenamiento revelada:** el **valor de F1 depende de la calidad de descomposición de F3.** 
- **Mitigación (corregida tras Architect — split):** (1) **Táctico, a F1.7:** el dogfooding usa **objetivos pre-descompuestos manualmente** con ownership de archivos disjunto (ej. "blade A toca `crates/apohara-mcp/`, B toca `crates/apohara-dispatch/`"). Barato, correcto, suficiente para el MVP. (2) **Scheduling, candidata a F2.2 (NO adelantar a F1):** ⚠️ `conflict_matrix` **NO es path-aware** — opera sobre `TaskSymbolManifest` (`SymbolRef{file,symbol,kind}`, `manifest.rs:33`) y exige un **manifest A-PRIORI** (qué símbolos toca cada tarea *antes* de correrla) que un blade opaco **no produce** (solo se conoce post-diff). Un guard de paths a granularidad de archivo es un **componente nuevo simple** (comparar `file`), no reuso tal cual. Adelantarlo a F1 metería en el MVP el problema difícil (manifest a-priori de caja negra) que el plan correctamente difirió.

### Escenario 4 — "El dogfooding se quedó sin combustible (presupuesto de tokens)"
El mesh corrió, pero N blades reales sobre el mismo objetivo, cada uno con el contexto compartido inyectado, quemaron N× tokens de las suscripciones de Pablo. A pocas iteraciones de bootstrapping, las cuotas de los planes se agotaron y el dogfooding se frenó.
- **Causa raíz:** la estrategia ES el dogfooding iterativo, pero el plan optimiza factibilidad y paralelismo y **nunca modela el costo en tokens por run**. Para un producto que se construye a sí mismo, quedarse sin cuota mata el bootstrapping.
- **Mitigación:** medir tokens por run en el dashboard (F2.4, reusa `apohara-token-accounting`); **throttling/budget configurable** (tope de blades por costo); **Context Forge (F4.3) sube de "capa de producto" a palanca de viabilidad económica** del bootstrapping (−44% del contexto compartido).

*(Otros 2 fallos identificados por el Architect, registrados como riesgos: **contexto-compartido divergente** — conflicto semántico entre blades que leen versiones distintas del estado, análogo del merge pero NO atrapado por conflict_matrix; **humano cuello-de-botella** — el review continuo de R16 serializa N flujos de diffs en un solo revisor, trasladando el idle del blade al humano.)*

## Expanded Test Plan (modo deliberate)
| Nivel | Cobertura |
|---|---|
| **Unit** | claim file-lock (N hilos → 1 gana); `can_transition` (`state.rs:106`, transiciones válidas/inválidas); `fresh_claim_token` unicidad; **validación de token en `report_result`** (rechaza token reapeado); lógica del reaper (TTL/heartbeat/PID); parsing de autodetect PATH; handlers MCP (`claim_task`/`send_message`/`check_inbox`); **orden FIFO de `runSerialized`**; comparador de paths solapados a granularidad de archivo; **extender** el test existente `spawn_env_strips_secrets...` (`cli_driver_tests.rs:11,37`) al caso `CLAUDE_CONFIG_DIR` inyectado post-sanitización **sin regresar** el strip de `ANTHROPIC_API_KEY`/`OPENAI_API_KEY` (past-incident wrong-account) |
| **Integration** | bus MCP arranca + cliente clama vía tool (idempotencia: 2º bootstrap no crea 2º bus); 2 blades simulados claman sin doble-asignación; mailbox poll entrega mensaje; **merge serializado de 2 worktrees sin corromper HEAD**; `Coordinator::tick` sobre storage real desbloquea deps; blade con `HOME` aislado no contiende en `~/.claude/`; **construir** el result-watcher de resultados de claim (el único watcher Rust hoy, `apohara-spec/watcher.rs`, es de specs `*.md` — distinto dominio) con el patrón **rescan-on-any-event + poll backup**; test: resultado vía tmp+rename detectado, no ignorado (past-incident inotify) |
| **E2E** | **dogfooding smoke** (app real, 2 CLIs reales, objetivo de código con paths disjuntos, diff aceptado); **no-cuelgue de 120s** con 2 tareas mismo binary (aisladas o serializadas); blade no-MCP excluido del roster; clone/branch del propio repo mejorado por el enjambre |
| **Observability** | dashboard de **utilización por blade** (anti-idle medido en vivo); **audit log JSONL** de claims/mensajes/merges (reusa `apohara-audit`, fchmod 0600); métricas wall-clock vs estimación secuencial; trazas de "qué blade hizo qué nodo del DAG"; conteo de claims reapeados; **participación-en-protocolo** (writes-sin-claim, ratio blades-que-clamaron vs spawneados, último check_inbox por blade — detecta el Escenario 1 en producción); **tokens por run** (presupuesto, Escenario 4) |

## ADR — Arquitectura BYOC de Apohara
- **Decision:** Realinear Apohara a un orquestador colaborativo **BYOC** (mesh cross-CLI sobre bus MCP híbrido — **Opción C**), implementado por fases con la rebanada vertical (claim heterogéneo → 2 blades colaboran) **primero**.
- **Drivers:** (1) de-riskear la factibilidad con CLIs opacos; (2) time-to-first-mesh para habilitar el bootstrapping; (3) reuso del andamiaje huérfano existente.
- **Alternatives considered:** **A** (bus MCP primero) — pospone el de-risking hasta pagar todo el bus; **B** (filesystem-first) — sacrifica la lingua franca MCP lockeada en R5/R11.
- **Why chosen:** C combina la lingua franca MCP (BYOC escalable) + la robustez del estado filesystem + el push/poll de R13; el reordenamiento claim-primero (F0.0) ataca el Driver #1 en ~100 líneas antes de cablear nada.
- **Consequences:** (+) ~la mitad del transporte ya existe (`McpServer`, `RunState`, `Coordinator`); (+) cada fase entrega valor verificable, el dogfooding habilita el bootstrapping; (−) el push server→CLI es per-CLI y opaco (mitigado: `check_inbox` poll es el contrato permanente); (−) obliga a portar `runSerialized` antes de paralelizar (past-incident de los 120s).
- **Follow-ups:** confirmar el nombre de la tool MCP del sidecar Context Forge (F4.3); decidir si se promueve a modo `--deliberate` (pre-mortem de 3 escenarios + test plan unit/integration/e2e/observability) antes de ejecutar F1.

## Changelog
- rev1: draft inicial (Planner).
- rev2: Architect review — reordena F0.0 claim-primero, corrige F0.1 (caller existe), separa Principle 3 pull/push, degrada push a F2, +4 riesgos (runSerialized, merge, reaper, idempotencia).
- rev7: Critic (deliberate) **APPROVED** — consenso deliberate CERRADO. 3 MINOR de precisión aplicados (env-leak = extender test existente `cli_driver_tests.rs:11`; result-watcher = construir, no reusar; header rev6→7). +2 open questions (tool MCP de Context Forge, criterio de no-contención F1.4).
- rev6: Architect (deliberate) **SOUND-WITH-CHANGES** aplicado — corrige insight HOME (`CLAUDE_CONFIG_DIR` no en allowlist + auth per-HOME + `runSerialized` invariante), corrige insight conflict_matrix (symbol-aware con manifest a-priori, NO path-aware; split táctico-F1.7 / scheduling-F2.2), +Escenario 4 (presupuesto tokens) +2 riesgos (contexto divergente, humano cuello-de-botella), +3 tests past-incident (env-leak, result-watcher, participación-protocolo).
- rev5: promovido a **deliberate** — pre-mortem (3 escenarios) + expanded test plan (unit/integration/e2e/observability). Pre-mortem reveló 2 insights: aislar `HOME` per-blade > serializar (F1.4); adelantar descomposición-ortogonal-por-paths a F1 (reusa `conflict_matrix`). Re-validación Architect+Critic deliberate.
- rev4: Critic **APPROVED** — fix MINOR F4.3 (Context Forge = sidecar Python vía MCP, no lib Rust) + ADR agregado. Consenso alcanzado (Planner→Architect→Critic, 2 iteraciones).
- rev3: Critic review — corrige cita F1.4 (`apohara-desktop-dioxus/.../dispatch_loop.rs:79`, confirmada por grep), degrada riesgo opencode a MINOR (caller ya correcto), añade acceptance testables a F3/F4/Context Forge/Vibecoding, resuelve ambigüedades F1.2-push (compromiso F2) y F1.6-integrador (único serializado), +3 riesgos sistémicos (token expirado, blade no-MCP, dependencia circular F1.1↔F2.1), mecanismo de idempotencia (OnceCell), verification steps F2-F4, F1.7 marcado gate manual.
