> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

I have enough comprehensive context. Now let me synthesize the findings.

# Hallazgos en Chorus

**Resumen ejecutivo:** Chorus es un **AI-Human collaboration server** (Next.js + Postgres + MCP HTTP Streamable), no un orchestrator multi-AI tipo Apohara. Sin embargo, su modelo conceptual — *"Reversed Conversation"* (AI propone, humano verifica) — y especialmente sus mecanismos para presence inferida, dual-path verification, hooks de plan de sub-agente, y review-as-adversarial-loop aportan ideas muy concretas. Lo destacable es que Chorus ya resuelve a nivel de plataforma muchos de los problemas que Apohara enfrenta a nivel de orchestrator local, con patrones traducibles a Tauri+Rust.

---

## Categoría: Real-time Observability

### Hallazgo 1: Presence inferida automáticamente desde tool-calls
- **Qué**: Wrapper que intercepta `registerTool` del MCP server y emite eventos `PresenceEvent` (view/mutate) fire-and-forget, sin que el agente declare presencia explícitamente.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/src/mcp/tools/presence.ts:180-202` (wrapper `enablePresence`), `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/docs/PRESENCE_DESIGN.md:46-99` (diseño).
- **Por qué inspira**: Apohara ya tiene "Smart Attention 4 niveles" pero a nivel de orchestrator. Esta técnica permite mostrar en la UI desktop qué agente está leyendo/mutando qué recurso, *sin* requerir que cada CLI provider emita telemetría — se infiere del MCP call. Es exactamente lo que falta para que el coordinator semántico de Apohara muestre "estoy mirando" vs "estoy editando" con cero esfuerzo del agente.
- **Cómo traducir**: En el `apohara-indexer` Rust sidecar, envolver el handler MCP loopback con un middleware que clasifique por nombre de tool (`get_` → view, otros → mutate), extraiga UUIDs/paths de los args, y emita un event al broadcast bus de Tauri (`tauri::Manager::emit_all`). Frontend usa `useSyncExternalStore` con TTL 3s.
- **Valor**: ALTO

### Hallazgo 2: Throttle de 2 capas (server 2s + cliente 3s) con auto-eviction
- **Qué**: Map throttle keyed por `agent+entity` con ventana deslizante de 2s server-side, y eviction map a los 30s; cliente complementa con auto-clear a 3s.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/src/lib/event-bus.ts:107-138` (`emitPresence` + `_ensureEvictionTimer`), `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/src/hooks/use-presence.ts:44-92`.
- **Por qué inspira**: Apohara va a tener eventos de hooks loopback con bursts altos (un agente puede llamar 50 tools/s). Sin throttle, satura WebView. La asimetría server-throttle (anti-burst) vs client-throttle (anti-re-render) es elegante: no requiere lockstep.
- **Cómo traducir**: En el agent-hooks loopback server Rust, usar `dashmap::DashMap<(AgentId, EntityId), Instant>` con cheap insert, y un `tokio::task` que evict cada 30s. Cliente TS usa el mismo patrón con `setTimeout`. El `unref()` del eviction timer (línea 134) evita bloquear shutdown — patrón importante para CLIs Node-like.
- **Valor**: ALTO

### Hallazgo 3: PixelCanvas — visualización lúdica de hasta N agentes activos
- **Qué**: Canvas sprite-based donde cada agente activo aparece como un personaje pixel-art con estados (`empty`, `idle`, `typing`, `celebrate`, `looking`), driven por SSE events.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/src/components/pixel-canvas.tsx:30-95`, `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/src/services/session.service.ts:407-505` (`getActiveSessionsForProject` merge session+sessionless).
- **Por qué inspira**: Apohara va a tener orquestación visible (multiple CLI drivers ejecutando), y mostrar "qué hace cada uno" puede ser árido. Un widget visual lúdico con sprites + animaciones de "task-done celebrate" da feedback humano emocional con costo bajo. La lógica de merge "session-based + sessionless workers" es clave para no doble-contar.
- **Cómo traducir**: Tauri widget React con `<canvas>` + sprites en `src-tauri/icons/agents/`. Estados driven por broadcast del orchestrator: dispatch → `typing`, verify-pass → `celebrate`, idle → animación de respiración. Slots fijos (5-7) y deterministic seat assignment por agent hash.
- **Valor**: MEDIO

---

## Categoría: Verification & Review

### Hallazgo 4: Dual-path acceptance criteria (dev self-check + admin verify)
- **Qué**: Cada AcceptanceCriterion tiene 2 trayectorias paralelas independientes: campos `devStatus/devEvidence/devMarkedBy*` (auto-check del desarrollador) y `status/evidence/markedBy*` (verificación admin), con `computeAcceptanceStatus` que unifica.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/prisma/schema.prisma:242-266` (modelo), `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/src/services/task.service.ts:142-168` (`computeAcceptanceStatus`).
- **Por qué inspira**: El verification-mesh de Apohara distingue judge≠critic. Este modelo va más allá: registra evidence dual con auditoría (quién marcó, cuándo, con qué evidencia textual) por cada criterio atómico. Permite detectar drift entre lo que el dev afirma vs lo que el verificador realmente comprobó — un mismatch dev/admin es señal de hallucination.
- **Cómo traducir**: En SQLite orchestration DB, agregar tabla `acceptance_criterion` con campos paralelos `claim_*` (judge) y `verify_*` (critic), más `verify_status` derivado por reducer puro Rust. UI Tauri muestra ambos en una tabla side-by-side con diff highlight cuando difieren.
- **Valor**: ALTO

### Hallazgo 5: Adversarial review sub-agent con system reminders críticos + max turns
- **Qué**: Sub-agent `task-reviewer` con `criticalSystemReminder_EXPERIMENTAL` que enumera anti-patrones autodetectables ("verification avoidance", "seduced by 80%"), permission Bash read-only granular, `maxTurns: 50`, output cap 800 chars con formato VERDICT estructurado.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/public/chorus-plugin/agents/task-reviewer.md:1-158`, especialmente líneas 12-21 (critical reminder) y 119-123 (rationalizations).
- **Por qué inspira**: Apohara tiene "judge≠critic" arquitectónico pero los prompts del critic son críticos para que no rubber-stamp. El patrón "RECOGNIZE YOUR OWN RATIONALIZATIONS" enumera fallos típicos de auto-engaño LLM ("The code looks correct based on my reading — reading is not verification"). El "Turn budget rule" (cuando quedan ≤3 turns, parar y postear hallazgos parciales) evita verificadores que se quedan sin tiempo y no entregan.
- **Cómo traducir**: En Apohara, cada critic provider recibe un system_prompt estructurado con: (a) lista de "rationalizations to recognize", (b) reglas BLOCKER vs NOTE, (c) Round-1 vs Round-N awareness (Round-N solo verifica si los BLOCKERs previos están resueltos — no introduce nuevos NOTEs), (d) hard cap output. Persistir el prompt en `apohara-templates/critics/{judge,critic}.md` y versionarlo.
- **Valor**: ALTO

### Hallazgo 6: Hallucination flag explícito en reviewers
- **Qué**: Tanto proposal-reviewer como task-reviewer tienen instrucción explícita: "Flag any specific external detail that looks like it could be LLM-fabricated (API signatures, model IDs, SDK versions, CLI flags, config keys, endpoint paths, etc.) as NOTE."
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/public/chorus-plugin/agents/proposal-reviewer.md:58`, `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/public/chorus-plugin/agents/task-reviewer.md:90`.
- **Por qué inspira**: Apohara verification-mesh no tiene categoría taxonómica para hallucinations. Esta heurística textual ("specific external detail the developer likely wrote from memory rather than referencing docs") es difícil de automatizar con regex pero trivialmente delegable a un critic LLM. Es la categoría de bug más común y menos cubierta por test suites.
- **Cómo traducir**: En el verification-mesh, agregar tipo de finding `HALLUCINATION_RISK` (severity entre NOTE y BLOCKER). El critic puede marcar items que después un check programático verifica contra docs/source (ej. SDK actual vs versión inventada). Persistir en agent-mistakes.md log con tag `hallucination:*`.
- **Valor**: ALTO

---

## Categoría: Sub-agent Lifecycle Management

### Hallazgo 7: Per-agent pending file pattern para identificar sub-agents (atomic mv claim)
- **Qué**: PreToolUse:Task hook escribe un archivo por agente en `.chorus/pending/<name>` con metadata; SubagentStart hace `mv pending/X claimed/<agent_id>` (atómico en mismo filesystem) para "claim" un agente sin race conditions.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/public/chorus-plugin/bin/on-pre-spawn-agent.sh:41-58`, `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/public/chorus-plugin/bin/on-subagent-start.sh:56-97`.
- **Por qué inspira**: Apohara worktree-reliability orphan adoption se basa en algo similar pero a nivel git worktree. Este patrón resuelve el problema más complejo de **correlacionar sub-agents spawneados sin shared state**: cada PreToolUse no sabe cuál SubagentStart le corresponderá. La estrategia FIFO fallback (claim el oldest pending si no hay match exacto) es elegante.
- **Cómo traducir**: En Apohara, cuando el coordinator dispara un dispatch a un CLI provider, escribe `~/.apohara/pending/<dispatch_id>.json`; el agent-hooks loopback server, al recibir el primer hook del agente, hace `rename()` (atómico POSIX) a `~/.apohara/active/<session_uuid>.json`. Permite re-attach correcto incluso si el coordinator muere entre dispatch y primer hook.
- **Valor**: ALTO

### Hallazgo 8: Hook output JSON con `additionalContext` para inyectar al sub-agente
- **Qué**: Los hooks de Claude Code aceptan output JSON con dos campos: `systemMessage` (visible al user) y `hookSpecificOutput.additionalContext` (inyectado al contexto del LLM). Permite que un hook escriba directamente al prompt del agente.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/public/chorus-plugin/bin/chorus-api.sh:124-163` (`hook_output` con jq), `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/public/chorus-plugin/bin/on-subagent-start.sh:208-247` (inyección workflow completo).
- **Por qué inspira**: Dispatch preamble + drift detection de Apohara ya está. Pero esto agrega un canal extra: cada hook puede actualizar el system context del agente en tiempo real (no solo al inicio). Ej: cuando el orchestrator detecta que un worktree quedó sucio durante la sesión, puede inyectar "warning: tu worktree tiene archivos sin commit, ejecutá `git status` antes de seguir" sin interrumpir el agente.
- **Cómo traducir**: El agent-hooks loopback Rust ya devuelve JSON al CLI driver wrapper. Agregar campo `hookSpecificOutput.additionalContext` que el wrapper inserte como `<system-reminder>` block (igual que Claude Code lo hace). Útil para reminders periódicos: "te quedan 3 min de timeout", "el ledger detectó un conflicto en el archivo X".
- **Valor**: ALTO

### Hallazgo 9: Session reuse heurística por nombre (active reuse / closed reopen / else create)
- **Qué**: Antes de crear una sesión, el hook lista sessions existentes, busca match por nombre. Si `active` → reuse + heartbeat; si `closed/inactive` → reopen; else create new.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/public/chorus-plugin/bin/on-subagent-start.sh:103-172`.
- **Por qué inspira**: Apohara session lifecycle no contempla reopen. Este pattern evita explosion de sesiones cuando el mismo "frontend-worker" agent es spawneado N veces en una jornada. La consolidación temporal por nombre permite hilo coherente en la transcript canónica.
- **Cómo traducir**: En orchestration DB, agregar `agent_sessions.reopened_at` (datetime nullable) y lógica de checkin: si existe session con `name=X, status='closed', closed_at < 7d ago` → reopen vs new. El two-tier transcript de Apohara muestra reopens como continuación del mismo hilo con un divisor visual.
- **Valor**: MEDIO

---

## Categoría: Auth & Permissions

### Hallazgo 10: Permisos como `resource:action` bits con presets + custom override
- **Qué**: Grid 5×3 (idea/proposal/document/task/project × read/write/admin) = 15 bits. Presets (`developer_agent`, `pm_agent`, `admin_agent`) son listas hardcoded; user puede añadir `customPermissions[]` que se unionan al preset. Helper `groupPermissionsByResource` aggrega para output compacto.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/src/lib/authz/types.ts:1-19`, `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/src/lib/authz/presets.ts:1-41`, `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/src/lib/authz/permissions.ts:17-63`.
- **Por qué inspira**: Apohara ya tiene "permission patterns con scopes + 3-tier settings hierarchy" pero no especifica el algebra de combinación preset+custom. Este pattern de "union de preset + customs" con compute-on-request es escalable y debuggeable (`groupPermissionsByResource` muestra al agente exactamente qué puede hacer).
- **Cómo traducir**: En Apohara `capability-manifest`, las permissions del agente son `Vec<(Resource, Action)>` con `ALL_PERMISSIONS` generado por `flatMap`. Los presets son `const PRESET: &[(Resource, Action)] = &[...]`. `compute_effective_permissions(roles, customs) -> HashSet<Permission>`. Importante: serializar siempre como flat string array (no Set) para JSON cross-boundary, como en `permissions: Permission[]` (línea 30 auth.ts).
- **Valor**: ALTO

### Hallazgo 11: Tool registration permission-gated invisible (no error, just absent)
- **Qué**: `registerPermissionedTool` simplemente no registra la tool si el agente no tiene la permission requerida — la tool no aparece en `list_tools`, no devuelve "permission denied".
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/src/mcp/tools/register-helpers.ts:26-39`.
- **Por qué inspira**: Apohara tiene MCP servers internos con bearer auth, pero el modelo es binary (permit/deny). Este pattern de "invisibilidad" es superior para LLM agents: si la tool no existe, no la intentará llamar, no gastará tokens en error handling. Para Apohara con `apohara.ledger`, `apohara.runs`, `apohara.indexer` esto evita que un developer agent vea tools admin-only y se confunda.
- **Cómo traducir**: En cada MCP server interno Rust (axum + rmcp), el handler de `tools/list` filtra por `auth_context.permissions`. Mismo principio en `tools/call`: si tool no listada, retornar `MethodNotFound` (no `PermissionDenied`). Documentar en `apohara.audit` qué permissions fueron requested para diagnóstico.
- **Valor**: MEDIO

---

## Categoría: Context Propagation

### Hallazgo 12: AsyncLocalStorage para per-request context (logger + requestId)
- **Qué**: `AsyncLocalStorage<RequestContext>` que envuelve cada API handler; permite `getRequestLogger()` desde cualquier punto del stack sin pasar el logger como parámetro.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/src/lib/request-context.ts:1-15`, `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/src/lib/api-handler.ts:43-94`.
- **Por qué inspira**: Bun tiene `AsyncLocalStorage` (compat Node). Apohara va a tener múltiples flujos concurrentes (decomposer, scheduler, ledger writer) y necesita correlacionar logs por dispatch. Sin ALS, hay que pasar `logger` como prop por todo el call stack — verbose y propenso a olvidos.
- **Cómo traducir**: En el orchestrator Bun side, envolver cada dispatch handler con `requestContext.run({ dispatchId, sessionId, logger: childLogger }, async () => {...})`. En Rust side, usar `tracing::Span` + `tracing::instrument`. El ledger SHA-256 entries auto-pickup `dispatchId` desde contexto sin parámetros explícitos.
- **Valor**: MEDIO

### Hallazgo 13: Cross-instance event dedup con `_origin` envelope
- **Qué**: Cuando hay multi-instance (Redis pub/sub), cada envelope lleva `_origin: instanceId` para que cada nodo descarte sus propios echos. Además marca eventos remotos con `_remote: true` para que listeners puedan saltear DB writes ya hechos por el originator.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/src/lib/event-bus.ts:37-105`.
- **Por qué inspira**: Apohara v1.0 es single-instance, pero el orchestrator y los Rust sidecars son procesos separados que comparten eventos via loopback. El `_origin` pattern aplica directamente: previene loops cuando un evento del indexer se propaga al orchestrator y vuelve.
- **Cómo traducir**: Cada proceso Rust tiene un UUID al startup (`process_id = Uuid::new_v4()`). Los broadcasts al orchestrator incluyen `_origin: process_id`. El bus del orchestrator (Tauri `Manager::emit`) marca `_remote: true` cuando vienen de otro proceso. Permite que el coordinator sepa "este file-changed event vino del indexer, no lo re-indexes".
- **Valor**: MEDIO

---

## Categoría: Skills & Workflows

### Hallazgo 14: `/yolo` skill — full-auto pipeline con escape hatch
- **Qué**: Skill que ejecuta el ciclo completo Idea→Proposal→Execute→Verify de forma autónoma usando wave-based parallel sub-agents, con verification adversarial entre fases y un escape hatch: "Ctrl+C en cualquier momento. Todas las entidades persisten en Chorus. Resume manualmente via /develop o /review."
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/public/chorus-plugin/skills/yolo/SKILL.md:1-50` (overview), `:262-310` (proposal review loop), `:380-440` (verification con maxRounds).
- **Por qué inspira**: Apohara tiene decomposer + scheduler pero el "modo autónomo end-to-end" no está spec'd. El patrón "wave-based" (ejecutar todos los tasks unblocked en paralelo, esperar wave, verificar, continuar) es traducible directo a Apohara DAG executor. La idempotencia del escape (resume manual) es clave para confiabilidad: si crashea, no perdés nada.
- **Cómo traducir**: En Apohara CLI, agregar `apohara yolo "<prompt>"` que: (1) llama decomposer, (2) ejecuta scheduler en modo wave (parallel disponibles + barrier), (3) entre waves invoca verification-mesh, (4) reopen tasks con FAIL, (5) reporting final. Estado persistido en orchestration DB cada paso, comando `apohara resume <dispatch_id>` retoma desde último wave completado.
- **Valor**: ALTO

### Hallazgo 15: maxRounds + escalation explícita en pipelines de review
- **Qué**: Configuración `maxProposalReviewRounds: 3` y `maxTaskReviewRounds: 3` con escalation explícita cuando se agotan: el pipeline NO se detiene — flagea ese item como "ESCALATED" y continúa con el resto, emitiendo un reporte final con la lista de items que necesitan intervención humana.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/public/chorus-plugin/skills/yolo/SKILL.md:429-440` (max rounds task), `:303-310` (max rounds proposal).
- **Por qué inspira**: Apohara verification-mesh puede entrar en loops infinitos judge↔critic↔dev↔retry. El patrón "max rounds per item + continue pipeline" evita que un task bloquee todo el DAG. La distinción "abort proposal pipeline" vs "skip task and continue" reconoce que las dependencies del DAG permiten paralelismo aunque algunos nodos fallen.
- **Cómo traducir**: En scheduler Apohara, cada DAG node tiene `max_verify_rounds: u8` configurable. Cuando se agota, status pasa a `ESCALATED`, el node no bloquea descendientes que no dependan de su output, y se persiste en `decision_gates` table con razón. CLI muestra final report con `apohara status --escalated`.
- **Valor**: ALTO

---

## Categoría: Documentation & Patterns

### Hallazgo 16: OpenSpec mode — local files autoritativos, MCP como mirror byte-equal
- **Qué**: Patrón "Local file is source of truth, Chorus is the mirror". Reglas no-negociables: NO retypear contenido markdown via LLM (token cost + byte drift), siempre via wrapper bash `chorus-api.sh mcp-tool ... "$PAYLOAD"` con `jq -Rs '.'` byte-faithful encoder.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/public/chorus-plugin/skills/openspec-aware/SKILL.md:76-99` (Rule 1), :100-101 (Rule 2 halt on error).
- **Por qué inspira**: Apohara plan documents markdown+frontmatter ya está, pero no especifica el patrón "single source of truth + LLM no re-emite contenido pesado". Esto resuelve: (a) ahorro de 20k+ tokens por documento, (b) garantía byte-equality (markdown tables, fences, URLs largas) que LLM re-emission rompe ~5-10% del tiempo.
- **Cómo traducir**: En Apohara CLI, comando `apohara doc sync <path>` que llee el file local y lo pushee al MCP server interno (`apohara.runs`) por byte stream — el LLM nunca ve el contenido completo. Solo pasa los metadatos (path, sha256, size). Si el agente quiere LEER, hace `apohara doc fetch` que retorna ruta local para Read tool.
- **Valor**: ALTO

### Hallazgo 17: Reversed Conversation como design principle explícito
- **Qué**: AI-DLC core philosophy "AI proposes, humans verify (not human prompt → AI execute)". Implementado a nivel de modelo de datos: Proposal es container draft, requiere admin approval para materializar entidades.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/CLAUDE.md:1-10`, `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/docs/AIDLC_GAP_ANALYSIS.md:17-26`.
- **Por qué inspira**: Apohara decomposer NL→DAG es propose-mode pero el DAG materializa directo. Insertar un "approval gate" para DAGs grandes (>N tasks, >M story points) replicaría el pattern: el orchestrator propone DAG, el humano lo revisa en UI Tauri antes de dispatch. Cambia la mentalidad de "AI ejecuta y vos revisás output" a "AI propone plan y vos aprobás antes de gastar compute".
- **Cómo traducir**: En Apohara coordinator, agregar `decision_gate: 'plan_approval'` automático cuando blast-radius > threshold. UI Tauri muestra DAG visual + estimated cost + estimated time, con botones approve/reject/edit. La edit re-prompts el decomposer con diff. Persistir approval en `decision_gates` con sha256 del DAG aprobado para auditoría.
- **Valor**: MEDIO

---

## Categoría: Communication & Notifications

### Hallazgo 18: SSE listener con exponential backoff + onReconnect backfill callback
- **Qué**: ChorusSseListener client-side con reconexión automática (1s→2s→4s...30s max), `onReconnect` callback que permite back-fill de notifications perdidas durante el disconnect.
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/packages/openclaw-plugin/src/sse-listener.ts:1-184`.
- **Por qué inspira**: Apohara Tauri frontend va a consumir eventos del Rust backend via `tauri::Manager::emit`. Si el frontend se duerme (laptop sleep, idle) y al despertar perdió eventos, el patron `onReconnect` (que dispara una refetch de "estado actual") garantiza eventual consistency sin requerir replay log.
- **Cómo traducir**: En Tauri frontend, hook `useApohara()` con `EventSource`-like sobre IPC. Tracking de `lastEventTimestamp`; on reconnect, llamar `apohara.runs.list_since(timestamp)` para back-fill. Backoff exponencial igual.
- **Valor**: MEDIO

### Hallazgo 19: Notification listener desacoplado via EventBus (zero invasion)
- **Qué**: `notification-listener.ts` subscribe al EventBus para eventos `activity` y genera notifications automáticamente — sin que el código de services llame a `notificationService` directamente. "All wiring happens via EventBus."
- **Dónde**: `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/chorus/src/services/notification-listener.ts:1-58`.
- **Por qué inspira**: Apohara tracker workflows (decision/bug items) podrían generarse automáticamente desde eventos del orchestrator sin que cada componente sepa de la existencia del tracker. Es event sourcing light: actividad emitida → múltiples listeners crean derived state (notifications, mistake-log, telemetry).
- **Cómo traducir**: Apohara internal event bus (Rust `tokio::sync::broadcast`) emite `LedgerEntry`. Listeners separados consumen para: (a) auto-poblar `agent-mistakes.md` cuando entry tipo `verify_fail`, (b) push notification al frontend, (c) update tracker workflow si entry tipo `decision_made`. Cada listener es un `tokio::spawn` independiente, agregable sin modificar el productor.
- **Valor**: ALTO

---

## Notas finales sobre divergencia arquitectónica

Chorus es **server-side multi-tenant SaaS** mientras Apohara es **desktop single-user orchestrator**. Esto hace que algunos patrones de Chorus (multi-tenant `companyUuid` scoping, OIDC, API key rotation, AWS CDK) no apliquen. Sin embargo, **los patrones de orquestación agent-side son universales**: presence inference, dual-path verification, hook-based session lifecycle, adversarial review prompts, max-rounds escalation, y AsyncLocalStorage context propagation son aplicables directos.

**Tres patrones que NO recomiendo adoptar**:
- *Polymorphic `assigneeType + assigneeUuid`*: Apohara solo tiene agentes (no humanos asignables a tasks), simplificá con FK directa.
- *Multi-tenant `companyUuid` por todas las queries*: irrelevante para single-user desktop.
- *Stateless MCP per-request*: Apohara tiene loopback persistente con bearer + audit log; mantener stateful es más eficiente local.

**El paradigma más rescatable de Chorus**: la "Reversed Conversation" como modelo mental + el modelo de datos Proposal/Idea/Document/Task que separa "draft que se revisa" de "entidad ejecutable". Vale la pena considerar si Apohara debería tener un `decision_gates.plan_proposal` table que registre planes propuestos vs ejecutados, para auditoría post-mortem.