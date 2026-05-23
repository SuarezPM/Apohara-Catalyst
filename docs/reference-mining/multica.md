Tengo más que suficiente material. Compongo el reporte final.

# Hallazgos del repo `multica/` para Apohara v1.0

Voy a estructurar 14 hallazgos novedosos, priorizados de mayor a menor valor. Multica es radicalmente distinto a Apohara: **cliente/daemon split** (frontend Next.js + Electron contra backend Go monolítico, daemon agente local en Go que ejecuta CLI agents headless en máquinas de usuarios). Es Linear-como-orquestador, no un "todo-en-uno". Esto cambia varios supuestos arquitectónicos.

---

## 1. Arquitectura cliente-daemon separada: servidor central + daemons distribuidos por máquina

**Qué:** Multica parte completamente el orchestrator. El "server" (Go + Chi + Postgres+pgvector + WebSocket hub) es central y stateless desde el punto de vista de ejecución. El "daemon" es un proceso Go por máquina de usuario que detecta CLIs locales (`claude`, `codex`, `copilot`, `opencode`, `openclaw`, `hermes`, `gemini`, `pi`, `cursor-agent`, `kimi`, `kiro-cli`) y ejecuta las tareas que el server le despacha.

**Dónde:** 
- `server/internal/daemon/daemon.go` (ciclo de vida, sincronización workspaces, ~1.8k LOC)
- `server/internal/daemon/wakeup.go` (loop de wakeup vía WS)
- `server/pkg/agent/agent.go` (Backend interface unificada — Apohara puede tomar esto literal)
- `server/internal/handler/daemon.go` (endpoints de registro/heartbeat/claim)
- `CLI_AND_DAEMON.md` líneas 156-194 (configuración + flujo)

**Por qué inspira:** Apohara hoy es "todo en un proceso Bun". Multica demuestra que partir orchestrator-central / agent-runtime-local resuelve simultáneamente (a) multi-máquina (mi laptop personal + mi máquina de trabajo registran el mismo workspace), (b) seguridad (la API key del provider nunca toca el server), (c) escalabilidad horizontal sin sharding (cada daemon es un actor independiente con `runtime_id` UUID estable).

**Cómo traducir:** Apohara v1.1+ podría introducir un modo "daemon-only" donde `apohara daemon start` es un proceso separado del CLI/dashboard. El scheduler/decomposer/ledger permanece central; los CLI wrapper providers (claude/codex/opencode) se mueven al daemon. Empezar publicando `apohara daemon` como un binary opcional que se registra contra `apohara server` vía HTTP+WS con bearer token.

**Valor:** Habilita teams self-hosted donde múltiples humanos comparten un único orchestrator pero ejecutan agentes en sus propias máquinas con sus propias API keys. Sin esto, Apohara está limitado a "single-user single-host".

---

## 2. Identidad de daemon estable como UUIDv7 persistido + migración legacy

**Qué:** El daemon mantiene un UUIDv7 en `~/.multica/daemon.id` (machine-scoped, no profile-scoped) escrito atomicamente con tmpfile+rename y `0600` perms. Si falta, hay un mecanismo de **promoción** desde el layout antiguo por-profile, más una función `LegacyDaemonIDs(hostname, profile)` que genera variantes (`host`, `host.local`, `host-profile`) para que el server pueda hacer merge de runtime rows huérfanos.

**Dónde:** `server/internal/daemon/identity.go` (244 líneas, completo)

**Por qué inspira:** Apohara puede tener este problema cuando empiece a tener "instancias persistentes" (e.g. CI runners, dev environments). El patrón "UUID estable + lista de IDs legacy para merge" es exactamente lo que permite que un usuario cambie hostname, mude de máquina, o promueva una instancia sin perder histórico.

**Cómo traducir:** Si Apohara introduce daemon mode o multi-instance, copiar el patrón literal. Para single-instance, sirve igual como `apohara.instance.id` para correlacionar logs entre runs/restarts.

**Valor:** Evita una clase entera de bugs de "doble registro / identidad fantasma" cuando el usuario mude máquinas o el hostname drift.

---

## 3. Stampede control para recovery distribuida: in-flight + per-workspace coalesce window

**Qué:** Cuando un runtime es eliminado server-side, el HTTP heartbeat, el WS ack handler y el poller pueden detectarlo simultáneamente. Multica implementa una máquina de estados con triple guarda: `runtimeGoneInflight[runtimeID]` (drop concurrentes del mismo ID), `reregisterNextAttempt[workspaceID]` (coalesce window 30s), y `reregisterLastCompletedAt[workspaceID]` (catch same-wave stragglers). En fallo extiende el next-attempt por `reregisterFailureBackoff=60s` SIN stampear lastCompletedAt (failures don't cover anything).

**Dónde:** `server/internal/daemon/daemon.go:238-394` (`handleRuntimeGone`, `tryClaimRegisterSlot`, `recordRegisterCompletion`)

**Por qué inspira:** Apohara hoy maneja un solo proceso, pero cuando agent-hooks, scheduler, y verification-mesh corran sobre Bun event loop, recoveries duplicadas son inevitables. El patrón "entryAt + dual-gate" es notable y testeable sin sleeps.

**Cómo traducir:** El scheduler de Apohara puede aplicar exactamente este patrón cuando el ledger detecte un agent "perdido" — múltiples checkers concurrentes deben converger en una sola recovery. Usar tres maps en el ledger SQLite: `recovery_inflight`, `recovery_next_attempt`, `recovery_last_completed`.

**Valor:** Convierte un bug latente ("retry storms cuando algo falla") en código deterministicamente testeable, con un patrón reusable.

---

## 4. WebSocket hub con dedupe IDs + per-runtime authentication scoping

**Qué:** El hub WS (`server/internal/daemonws/hub.go`) mantiene `byRuntime: map[string]map[*client]bool`. Cada cliente tiene un buffer dedupe de 128 event IDs (ring buffer con `seenList` + `seenIDs`). Cuando llega un wakeup, el hub verifica `markSeen(eventID)`, hace `select { case c.send <- data: default: slow=append }` — los slow clients son evictados sin bloquear el path crítico. Los heartbeats validan que `runtimeID ∈ identity.RuntimeIDs` (rejection de heartbeats fuera de scope).

**Dónde:** `server/internal/daemonws/hub.go` (449 líneas, ver `markSeen`, `notifyFrame`, `handleHeartbeatFrame`)

**Por qué inspira:** Apohara va a tener un componente de eventing similar (agent-hooks loopback, dashboard real-time). El patrón "dedupe per-connection + non-blocking send + slow eviction" es producción-listo y mejor que la mayoría de implementaciones home-grown.

**Cómo traducir:** Cuando Apohara construya el bridge real-time del dashboard ("Smart Attention"), implementar exactamente este shape: ring dedupe + drop-on-slow + scope validation por conexión. Bun/Hono tiene primitivos similares (`ServerWebSocket`).

**Valor:** Evita los dos modos de falla canónicos de pub/sub: replays infinitos (sin dedupe) y back-pressure que tumba el hub (sin eviction).

---

## 5. Empty-claim cache con versioning anti-stale (Redis pattern)

**Qué:** Cuando un runtime hace claim y no hay tareas, el verdict "no queued task" se cachea en Redis con TTL 3min. Pero el cache está tagged con un per-runtime monotonic version counter. Cada enqueue hace `INCR version` ANTES del WS wakeup. El claim lee version BEFORE el SELECT y la pasa a MarkEmpty; en readers posteriores, `cachedVersion != currentVersion` invalida el verdict.

**Dónde:** `server/internal/service/empty_claim_cache.go` (197 líneas, completo)

**Por qué inspira:** Cierra perfectamente el race que cualquier cache idle-pruning sufre. La doctrina "tag with the version observed BEFORE the read, validate at read time" es general — sirve para cualquier cache que pueda quedar stale por escrituras concurrentes.

**Cómo traducir:** Apohara tiene caches similares (resultados de verification-mesh, indexer responses). Aplicar el patrón "version-tagged cache entry + bump-on-write" en el ledger SQLite (`bump_version` + `cache_entry(key, value, version)`). Empezar con la mesh: cuando un verifier "no encuentra ediciones nuevas" en un branch, cachear con version.

**Valor:** Reduce queries redundantes a la mesh/ledger sin riesgo de stale verdicts.

---

## 6. Protocol shape: envelope `{type, payload}` con eventos versionados por dominio

**Qué:** Multica define un único `Message{Type, Payload json.RawMessage}` y un catálogo gigante (124 líneas) de event types organizados por dominio: `issue:created`, `task:queued`, `inbox:new`, `daemon:heartbeat`, `pull_request:linked`, etc. Cada payload tiene su struct propia (`TaskDispatchPayload`, `DaemonHeartbeatAckPayload` con campos `omitempty` para forward-compat).

**Dónde:** `server/pkg/protocol/messages.go` + `server/pkg/protocol/events.go`

**Por qué inspira:** Apohara va a necesitar definir su propio protocol para agent-hooks + dashboard real-time. La rigor "type:domain:verb + payload typed + forward-compat via omitempty" es exactamente la disciplina que evita parsing hell.

**Cómo traducir:** Crear `apohara/protocol/{events.ts, messages.ts}` con TypeScript discriminated unions. Cada evento: `{type: 'task:dispatch', payload: TaskDispatchPayload}`. Reusar las categorías de Multica directamente: `task:`, `agent:`, `inbox:`, `chat:`, `daemon:`. Versioning por adición de campos opcionales, no por nuevos tipos.

**Valor:** Es el lenguaje que Apohara va a hablar consigo mismo a través de su sistema distribuido. Lo definís bien una vez o lo pagás eternamente.

---

## 7. Pattern de protección contra agent "session poisoning"

**Qué:** Cuando un agente completa con un output que es un known fallback ("I reached the iteration limit", "Put your final update inside the content string"), o cuando la LLM API devolvió 400 invalid_request, o cuando Codex reportó semantic inactivity timeout, Multica marca `failure_reason ∈ {iteration_limit, agent_fallback_message, api_invalid_request, codex_semantic_inactivity}`. El SQL `GetLastTaskSession` excluye estos para que el next task no resume la conversación "envenenada". Hay un `poisonedOutputMaxLen=320` para evitar falsos positivos cuando un código revisor cita los strings.

**Dónde:** `server/internal/daemon/poisoned.go`

**Por qué inspira:** Apohara con resume-mode (Claude sessions, Codex sessions, OpenCode sessions) va a tener este mismo problema. La taxonomía "output-side poison vs error-side poison vs timeout-side poison" + el cap de longitud son ideas listas.

**Cómo traducir:** El consolidator de Apohara debería tener una capa "is this session resumable?" antes de armar el resume command. Implementar `classifyPoisonedOutput`, `classifyPoisonedError`, `classifyResumeUnsafeTimeout` y persistirlos en el ledger junto al `session_id`. El scheduler los lee al decidir si resume vs fresh.

**Valor:** Sin esto, una tarea fallida con output venenoso se reproduce N veces hasta que el usuario interviene manualmente. Es un fix de calidad-de-vida enorme con poco código.

---

## 8. Workspace GC con tres modos (full task / orphan / artifact-only)

**Qué:** El daemon escanea `~/multica_workspaces` y reclama disco en tres modos: (1) Full task cleanup cuando issue `done/cancelled` + idle > `MULTICA_GC_TTL=24h`. (2) Orphan cleanup para dirs sin `.gc_meta.json` > 72h. (3) Artifact-only cleanup para issues abiertos > 12h: borra solo `node_modules`, `.next`, `.turbo` (patterns configurables, basename-only para evitar `../../foo`), preserva `source`, `.git`, `output/`, `logs/`, `.gc_meta.json`.

**Dónde:** `CLI_AND_DAEMON.md:186-193` + `server/internal/daemon/gc.go`

**Por qué inspira:** El sidecar `apohara-sandbox` va a generar mucha basura (worktrees, builds, caches). El modelo de 3-tier GC permite "preserve work-in-progress, reclaim derivative outputs" sin perder el contexto del agente.

**Cómo traducir:** El sandbox de Apohara debe escribir un `.apohara_gc_meta.json` por worktree (issue_id, last_active, agent_id) y tener un GC daemon con los mismos tres modos. Pattern basename-only es crucial — no permitir `/` ni `\` en patterns para evitar path traversal.

**Valor:** Sin GC explícito, los worktrees acumulan GBs por semana. Con esto, el usuario nunca toca disco.

---

## 9. Two-transport heartbeat: WS preferred + HTTP fallback con freshness window

**Qué:** El daemon manda heartbeats por WebSocket (`daemon:heartbeat`) con `runtime_id` + `supports_batch_import`. El server responde `daemon:heartbeat_ack` que puede incluir `runtime_gone=true`, `pending_update`, `pending_model_list`, `pending_local_skills`, `pending_local_skill_imports`. El daemon registra cada ack en `wsHBLastAck[runtimeID] = time.Now()`. El HTTP heartbeat loop usa `wsHeartbeatRecentlyAcked(runtimeID)` con freshness window de `2 * HeartbeatInterval` (30s) para **skip** el HTTP heartbeat cuando WS está sano. En WS disconnect, `clearWSHeartbeatAcks` re-habilita HTTP en el siguiente tick.

**Dónde:** `server/internal/daemon/daemon.go:526-570`, `server/pkg/protocol/messages.go:114-176`

**Por qué inspira:** Patrón "dual-transport con freshness gating" es el grial de "websocket cuando funciona, polling cuando no, sin duplicar trabajo". Hub WS también devuelve `runtime_gone` como ack en lugar de cerrar conexión — la conexión sobrevive eventos de scope.

**Cómo traducir:** Si Apohara expone agent-hooks HTTP loopback + dashboard WS, copiar el patrón: WS para low-latency, HTTP polling como fallback, con freshness window de 2×interval para skip duplicación. La estructura "ack puede carry pending actions" deduplica eventos típicos.

**Valor:** Resiliente a flaky networks sin doble carga server-side.

---

## 10. Profile system: múltiples daemons aislados por backend en una misma máquina

**Qué:** Profiles separan "config + token + daemon state + health port + workspace root" por nombre. Cada profile vive en `~/.multica/profiles/<name>/`. El `healthPortForProfile` deriva puerto via `DEFAULT_HEALTH_PORT + 1 + (hash(name) % 1000)` — colision-resistant determinístico. Permite "production daemon + staging daemon simultáneos en la misma laptop".

**Dónde:** `CLI_AND_DAEMON.md:253-268`, `apps/desktop/src/main/daemon-manager.ts:57-78` (la lógica Go y TS están explícitamente sincronizadas via comentario)

**Por qué inspira:** Apohara dev/prod/cliente-A/cliente-B es un caso real. Profile-as-isolation con health port determinístico evita conflictos sin asignar puertos a mano.

**Cómo traducir:** Apohara CLI puede tener `--profile <name>` que mapea a `~/.apohara/profiles/<name>/{config, ledger.sqlite, logs/}`. Hash determinístico para cualquier puerto efímero (API local, dashboard local).

**Valor:** Habilita workflows multi-cliente sin "uno o el otro a la vez".

---

## 11. Sidecar CLI bundling para Electron desktop (binary auto-resolve cascade)

**Qué:** El desktop app (`apps/desktop`) bundlea el CLI Go nativo como sidecar. El `bundle-cli.mjs` corre `go build` cross-platform durante el build de Electron y deposita el binary en `apps/desktop/resources/bin/multica`. En runtime, `resolveCliBinary` busca en cascada: (1) cached, (2) bundled (preferido — siempre lockstep con el código del repo), (3) managed (descargado a `userData`), (4) auto-install from GitHub releases, (5) `multica` en PATH. Manejo de `app.asar.unpacked` via `electron-builder asarUnpack`. Codesign ad-hoc en macOS. Version mismatch entre running daemon y bundled CLI dispara restart pero **deferred** si `active_task_count > 0`.

**Dónde:** `apps/desktop/scripts/bundle-cli.mjs` (169 líneas, completo) + `apps/desktop/src/main/daemon-manager.ts:301-495`

**Por qué inspira:** Apohara Tauri v2 va a tener exactamente este problema: cómo entregar las dependencias Rust crates + Bun + el TypeScript orchestrator en un solo dmg/msi/AppImage. La cascade "bundled → managed → auto-install → PATH" + "defer restart until active tasks drain" es producción real.

**Cómo traducir:** Tauri sidecar (`tauri.conf.json > tauri.bundle.externalBin`) puede bundle `apohara-server` binary. Implementar la misma cascade de resolución + check de version mismatch con deferred restart. El script bundle-cli.mjs es portable a `pnpm tauri:bundle-server`.

**Valor:** "Drag-to-install" experience real. Sin esto, Apohara desktop tiene un onboarding "instala Bun, instala Rust, ahora corré ese script". Game over.

---

## 12. Pattern de mention expansion: bare `MUL-117` → `[MUL-117](mention://issue/<uuid>)`

**Qué:** El server escanea markdown y reemplaza identificadores como `MUL-117` por mention links, respetando:
- skip dentro de fenced code blocks (` ``` `)
- skip dentro de inline code (`` `MUL-117` ``)
- skip si ya está dentro de link markdown
- right-to-left replacement para preservar offsets
- prefix lookup desde workspace settings (cada workspace tiene su `issue_prefix`)

**Dónde:** `server/internal/mention/expand.go` (197 líneas, completo)

**Por qué inspira:** El SPEC.md parser de Apohara y los comments de tracker workflows ya usan IDs (tarea SHA-256 prefix). Tener auto-expansion de `APO-abc1234` → link clickeable enriquece toda la documentación generada por agentes.

**Cómo traducir:** Apohara puede tener un mention expander para sus IDs (issue/plan/branch/task). El patrón "regex + skip regions + RTL replace" es directamente portable. Para SPEC.md, expandir refs como `[REQ-12]` → link al requirement con contexto desnormalizado.

**Valor:** UX micro pero acumulativo. Cada comment generado por agente queda navegable.

---

## 13. Issue active-duplicate prevention con Postgres advisory lock

**Qué:** Antes de crear un issue, el server obtiene un Postgres advisory lock con key derivada de `(workspace_id, project_id, parent_issue_id, normalize(title))`. Bajo el lock, busca un issue activo con título normalizado (lowercase + whitespace collapse) idéntico. Si existe, devuelve `ActiveDuplicateError` con el `identifier` (e.g. `MUL-123`) del duplicado y un hint accionable ("Set allow_duplicate=true or use --allow-duplicate").

**Dónde:** `server/internal/issueguard/duplicate.go` (87 líneas, completo)

**Por qué inspira:** El decomposer + autopilots de Apohara van a producir tareas duplicadas inevitablemente (mismo prompt, dos triggers, etc.). El patrón "advisory lock + normalized title + opt-out flag" evita el churn de duplicates con código minimal.

**Cómo traducir:** Aunque Apohara use SQLite (no Postgres advisory locks), puede emularlo con `BEGIN IMMEDIATE` + select-where-normalized-title antes del insert. Decomposer y scheduler aplican esto al crear tasks; `--allow-duplicate` como escape hatch. Normalización es exactamente la misma: `strings.ToLower(strings.Join(strings.Fields(title), " "))`.

**Valor:** Convierte "race entre triggers" en error explícito con remediation clara en lugar de comments duplicados.

---

## 14. Backend handler UUID parsing convention (defensive against silent zero-UUID)

**Qué:** En `CLAUDE.md` líneas correspondientes a "Backend Handler UUID Parsing Convention" se documenta una regla que nació de un bug específico (#1661, "DELETE returning 204 mientras SQL matched zero rows"). Tres reglas: (1) Path params humanos (e.g. `MUL-123`) MUST pasar por loader como `loadIssueForUser` que devuelve `entity.ID`; nunca usar el raw URL string en queries de escritura. (2) Pure-UUID inputs validados con `parseUUIDOrBadRequest(w, s, fieldName)` que escribe 400 inline. (3) Trusted UUID round-trips (sqlc → sqlc) usan `parseUUID` que panickea — un panic acá significa que un input no validado pasó la frontera, así que `chi.Recoverer` lo convierte en 500 sin tumbar el proceso.

**Dónde:** `CLAUDE.md` (full convention documented) + practicado en `server/internal/handler/daemon.go`

**Por qué inspira:** Apohara va a tener este mismo problema cuando el ledger SHA-256 acepte IDs cortos vs largos (e.g. `task abc1234` vs full hash). La distinción "boundary input vs trusted roundtrip vs human-friendly handle" merece ser convención explícita.

**Cómo traducir:** Tres helpers en `apohara/ids.ts`: `parseTaskIdOrError(input)` (boundary; throws 400-like), `resolveTaskHandle(input)` (path param, accepts prefix/short/full), `assertTaskIdInternal(input)` (trusted; throws on internal violation). Documentarlo en `CLAUDE.md` con la regla "donde vino este ID — entrada del usuario, path param, o roundtrip interno?".

**Valor:** Bug class entera (silent zero/empty matches) eliminada por convención.

---

## Hallazgos secundarios (mención rápida)

**15. CLI_INSTALL.md como prompt para AI agents** — Multica entrega un doc explícitamente diseñado para Claude/Codex lo lea y ejecute step-by-step. Apohara puede tener `APOHARA_INSTALL.md` que el propio Apohara instale en repos para que agentes externos sepan cómo registrarse.
**Dónde:** `/home/thelinconx/Documentos/Apohara_Ultimate/_reference/multica/CLI_INSTALL.md`

**16. Issue metadata como typed KV map con bar alto para writes** — Per-issue metadata es un KV map (max 50 keys, 8KB blob) que documentación explícitamente desincentiva como bookkeeping (`The bar for writing is high`). Apohara plan documents pueden ganar este shape vs JSONB libre.
**Dónde:** `CLI_AND_DAEMON.md:455-479`

**17. Workspace settings versioning + repo allowlist hash** — `reposVersion := sha256(sorted_urls)` permite que el daemon skip refresh cuando el hash no cambió. Apohara ledger puede tener `state_version` por workspace/branch para skip re-evaluations.
**Dónde:** `server/internal/handler/daemon.go:200-211`

**18. Client-side secret redaction como safety net** — Aunque el server redacta, el view layer tiene `redactSecrets` con 11 patterns (AWS keys, GitHub tokens, JWT, bearer, connection strings). Defense in depth. Apohara dashboard que renderice agent output debe tener esta capa cliente-side.
**Dónde:** `packages/views/common/task-transcript/redact.ts`

---

## Recomendación de priorización

**Implementar pronto en Apohara v1.0/v1.1:**
- #1 + #11 (arquitectura daemon-client + sidecar bundling) — habilitan distribución real
- #6 (protocol envelope versionado) — sin esto, agent-hooks queda con shape ad-hoc
- #13 (duplicate prevention) — el decomposer lo va a necesitar inmediatamente
- #7 (poisoned session classification) — barato y elimina retry storms
- #14 (UUID/ID parsing convention) — documentar antes de que crezca el handler surface

**Para v1.2/v1.3 cuando aparezca el desktop/multi-instance:**
- #2 (UUID identity + legacy migration)
- #3 (stampede control)
- #4 (WS hub con dedupe)
- #5 (empty-claim cache versioning)
- #9 (dual-transport heartbeat)
- #10 (profile system)

**Quality-of-life para cuando haya tracción de usuarios:**
- #8 (GC tier system) — sandbox necesita esto
- #12 (mention expansion)
- #15/#16/#17/#18 (afinamientos)