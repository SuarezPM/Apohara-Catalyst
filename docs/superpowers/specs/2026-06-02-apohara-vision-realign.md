# Deep Interview Spec: Apohara — Realineación a la Visión Colaborativa (BYOC)

## Metadata
- **Interview ID:** apohara-vision-realign-20260601
- **Rounds:** 16 (+ Round 0 topología) · 2 sesiones (1-jun `13bcbadb` pausada R2 → 2-jun reanudada y completada)
- **Final Ambiguity Score:** 12.9%
- **Type:** brownfield
- **Generated:** 2026-06-02
- **Threshold:** 0.20 (source: default)
- **Initial Context Summarized:** no
- **Challenge agents:** Contrarian (R4), Simplifier (R6)
- **Status:** PASSED (refinado — 7 detalles abiertos cerrados en R9–R16)

## Clarity Breakdown
| Dimensión | Score | Peso | Ponderado |
|-----------|-------|------|-----------|
| Goal Clarity | 0.94 | 0.35 | 0.329 |
| Constraint Clarity | 0.82 | 0.25 | 0.205 |
| Success Criteria | 0.78 | 0.25 | 0.195 |
| Context Clarity | 0.95 | 0.15 | 0.143 |
| **Total Clarity** | | | **0.871** |
| **Ambigüedad** | | | **0.129** |

## Topología (5 componentes confirmados en Round 0)
| Componente | Estado | Descripción | Cobertura |
|-----------|--------|-------------|-----------|
| 1. Visión & misión | active | Qué ES Apohara (orquestador colaborativo BYOC) | R1: modelo mesh |
| 2. Planner socrático | active | Prompt crudo → PLAN MAESTRO vía entrevista dirigida por Apohara | R2, R9: Apohara lógica propia + consenso opt-in |
| 3. Orquestación colaborativa | active | Reparto equitativo + mesh cross-CLI | R3/R4/R5/R11/R13: híbrido configurable + Agent Teams + MCP-bus + autodetect + push/poll |
| 4. Integración + Review | active | Ensamblar el trabajo del enjambre + gate humano | R7, R12, R16: integrador incremental + dashboard + permisos blade×fase |
| 5. UI/UX | active | Ventana de bienvenida, modos Vibecoding/IDE | R8, R14: un motor dos densidades + modo guiado opt-in |

## Goal
Realinear Apohara Catalyst desde el posicionamiento heredado del rebrand ("bake-off competitivo / diff ganador") hacia su **visión colaborativa real**: un **orquestador local-first multi-CLI** que introduce el concepto **BYOC ("Bring Your Own CLI")** — Apohara es un servidor donde cada CLI de agente (Claude Code, Codex, OpenCode, … 1 o N) es un **blade intercambiable**. Apohara, con **lógica propia** (estilo Hermes), recibe un objetivo crudo, lo convierte vía **entrevista socrática + prompt engineering** en un **PLAN MAESTRO** (DAG), y lo **reparte equitativamente** entre todos los blades disponibles, que trabajan **en partes distintas, en paralelo, comunicándose y compartiendo contexto** (mesh coordinado en vivo), para integrarse y revisarse end-to-end.

**Slogan:** *"No routing, no fallback, only power."*

**Problema que resuelve:** el dev con varias suscripciones/CLIs las usa **de a una, idle el resto** (Claude diseña → idle; OpenCode codea → idle; Gemini debuggea → idle). Apohara las usa **todas juntas, equitativamente** = máxima paralelización.

## Decisiones lockeadas
**Visión / arquitectura (R1–R8):**
- **R1 — Modelo:** equipo coordinado **EN VIVO (mesh)**; comparten contexto y resuelven conflictos en tiempo real. NO bake-off.
- **R2 — Concepto central:** BYOC; Apohara dirige la fase socrática; flujo end-to-end planning→review; modo **CONSENSO** opcional (acuerdan el PLAN, no la ejecución); dos modos UI; sub-modo guiado.
- **R3 — Reparto:** **híbrido configurable** (default afinidad + balanceo, nadie idle; configurable por proyecto). DAG = unidad de fairness.
- **R4 — Mesh factible (contrarian):** patrón **Claude Agent Teams** (Shared Task List + Mailbox + claim file-lock + deps). Diferencial: Agent Teams es homogéneo (solo Claude); Apohara lo porta a roster **heterogéneo**.
- **R5 — Transporte:** **híbrido MCP-bus + hub-traductor**. Apohara = MCP switchboard: **física estrella, lógica mesh**. Lingua franca = **MCP**. Comprime contexto compartido con Context Forge.
- **R6 — Scope/estrategia:** alcance **completo** + **bootstrapping/dogfooding** (uso personal, Apohara se auto-mejora).
- **R7 — Integración/review:** **blade integrador dedicado** consolida **incrementalmente** por nodo del DAG + review **continuo** del humano (sin big-bang).
- **R8 — UI:** **un motor, dos densidades**. IDE Mode (denso) primero; Vibecoding Mode = piel chat encima, después.

**Detalles refinados (R9, R11–R16):**
- **R9 — Planner:** **configurable** — default Apohara con **lógica propia** (motor socrático nativo, cero tokens de blades); **modo consenso opt-in** (Apohara reparte el borrador del plan a los blades, refinan/acuerdan) para objetivos críticos.
- **R11 — Roster:** **autodetección en PATH** — Apohara escanea, detecta los CLIs de agente instalados y los ofrece como blades disponibles (BYOC puro; requiere discovery + adapters per-CLI sobre `apohara-mcp-bridge`).
- **R12 — Métricas:** **dashboard de utilización + calidad** en vivo — utilización por blade (anti-idle medido y visible), wall-clock vs estimación secuencial, quality gates verdes, % diffs aceptados sin rework (reusa `apohara-token-accounting`).
- **R13 — Entrega de mensajes:** **híbrido push por hooks + poll de respaldo** — Apohara inyecta en los hooks del blade (`apohara-hooks-server`, PreToolUse/Stop) y el blade puede `check_inbox` por MCP; el poll evita mensajes varados (alineado al past-incident del `CLAUDE.md`).
- **R14 — Modo guiado:** **híbrido opt-in que NO frena el flujo** — mientras el enjambre trabaja, Apohara narra en paralelo (reusa `apohara-event-humanizer`), hace preguntas tipo tutor, y permite explicación on-demand; todo activable por el usuario (máximo control).
- **R15/16 — Memoria persistente:** **reusar `apohara-episodic` (runs) + `apohara-indexer` (búsqueda de código, reduce tokens) + persistir el contexto compartido del mesh** (decisiones/artefactos/handoffs de blades) en sqlite para continuidad cross-sesión.
- **R16 — Permisos:** **por blade + por fase** — cada blade tiene su nivel (read-only/write/admin); los permisos varían por fase: PLAN = read-only (≈ plan-approval de Agent Teams), EJECUCIÓN = write en su worktree, REVIEW/merge = requiere humano. Sobre el `PermissionRequest` existente; referencia chorus 5×3.

## Constraints
- **CLI-wrappers-only, cero OAuth** (regla dura: TOS). Apohara nunca paga tokens propios.
- **Lingua franca = MCP.** Un blade participa si habla MCP. **Roster = autodetección en PATH** (los 3 activos actuales + cualquiera instalado que hable MCP; legacy detrás de `APOHARA_LEGACY_PROVIDERS=1`).
- **Local-first**, sin ejecución remota/cloud.
- **Mesh en filesystem + MCP**, no inyección a mitad de loop (los blades son cajas negras). Entrega de mensajes = push-hooks + poll-respaldo.
- **Permisos por blade × fase**; humano requerido para review/merge.
- **Agent Teams nativo = referencia de patrón**, no dependencia (experimental, split-panes no anda en Ghostty → in-process).
- **Context Forge:** solo **compresión LLMLingua-2 (−44%, CPU)** + **dedup LSH/FAISS**; KV-cache sharing NO aplica a CLIs externos. "rkt"/"lean-ctx" NO existen. Memoria persistente = construir sobre episodic + indexer + sqlite del mesh.
- **Humano siempre puede meter mano** (gate + intervención en vivo).

## Non-Goals
- **NO es `apohara auto`** (stretch viejo en `docs/PROJECT.md`: loop CLI autónomo que "ships PR by itself" sin supervisión). El enjambre **propone**, el humano **decide**. — *el malentendido a evitar.*
- **NO bake-off** (N modelos sobre la *misma* tarea). El consenso se usa **solo en la fase de PLAN**.
- **NO para vender/producción el día 0.** Uso personal y dogfooding primero.
- **NO routing ni fallback** entre modelos (es el slogan).

## Acceptance Criteria
- [ ] **Dogfooding test (criterio maestro):** abrir Apohara → apuntar a un clone/branch del propio repo `apohara-catalyst` → "seguí el roadmap / mejorá este código" → el enjambre de ≥2 blades heterogéneos produce mejoras reales **integradas y verdes**, que Pablo **revisa y acepta**.
- [ ] Un objetivo crudo → entrevista socrática **con lógica propia de Apohara** → **PLAN MAESTRO (DAG)** con dependencias. Modo consenso opt-in funciona.
- [ ] **Autodetección en PATH**: Apohara descubre los CLIs instalados y los lista como blades disponibles.
- [ ] ≥2 blades heterogéneos **claman** tareas vía MCP **sin doble-asignación** (file-locking) y **se comunican** vía mailbox (push-hooks + poll).
- [ ] El reparto respeta el DAG (paralelo, **nadie idle**).
- [ ] El **blade integrador** consolida incrementalmente cada nodo; el humano ve en vivo e interviene.
- [ ] **Dashboard** muestra utilización por blade + wall-clock + gates + aceptación.
- [ ] **Permisos por blade × fase** aplicados (plan read-only / exec write / review humano).
- [ ] IDE Mode operativo antes que Vibecoding. **Modo guiado** opt-in narra/pregunta sin frenar el flujo.
- [ ] **Memoria persistente**: episodic + indexer + contexto del mesh persistido (continuidad cross-sesión).
- [ ] Context Forge integrado como compresión del contexto compartido.

## Assumptions Exposed & Resolved
| Asunción | Challenge | Resolución |
|----------|-----------|------------|
| "Colaboran en tiempo real" | Contrarian R4: los CLIs son cajas negras | Factible vía patrón Agent Teams (estado fs + mailbox + claim) |
| "Equitativo" es obvio | R3 | Híbrido configurable (afinidad + balanceo) |
| Transporte custom complejo | R5 | MCP lingua franca; Apohara switchboard (estrella física / mesh lógico) |
| Hay que simplificar el scope | Simplifier R6 | NO; bootstrapping reduce el costo (el enjambre se construye a sí mismo) |
| El producto es autónomo | R6 | NO; humano siempre supervisa (anti `apohara auto`) |
| El planner gasta tokens de un CLI | R9 | NO por default: lógica propia; consenso opt-in |
| Roster fijo de 3 | R11 | Autodetección en PATH (BYOC puro) |

## Technical Context (brownfield)
**Crates existentes que ya implementan la capa de transporte/mesh:**
- `apohara-mcp` + `apohara-mcp-bridge` — bus MCP + traducción de dialectos Claude/Codex/OpenCode (extensible para autodetect).
- `apohara-hooks-server` (axum loopback) — push de mensajes a blades en vivo.
- `apohara-coordinator` — resolución de conflictos del mesh. `apohara-attention` (HOT/WARM/COOL/IDLE) — atención por bandas (anti-ruido del mailbox).
- `apohara-worktree` — aislamiento por blade. `apohara-verification` — quality gates por nodo. `apohara-token-accounting` — base del dashboard.
- `apohara-episodic` — memoria de runs cross-sesión. `apohara-indexer` (tree-sitter + sqlite-vec + blake3) — búsqueda de código in-process.
- `apohara-event-humanizer` — eventos → labels humanos (base del modo guiado).
- Desktop Dioxus: `CodeDiffPane` + `TaskBoard` ya existen; `PermissionRequest` (allow once/session/always/deny) vivo.

**A construir (lo genuinamente nuevo):** Shared Task List (DAG) + Mailbox semántico + wiring vivo al desktop + el blade integrador + modo consenso + autodetect/discovery de blades + dashboard de utilización + Vibecoding skin + modo guiado + persistencia del contexto del mesh + permisos blade×fase.

**Referencias (`~/Documentos/Apohara_Ultimate/reference/`):** chorus (Task DAG + AI-propone/humano-verifica + permisos 5×3), symphony (scheduler claim/priority/concurrency), culture/AgentIRC (bus mesh + atención), multica (squads), claude-octopus (consenso — solo plan), orca (IDE Mode + worktree), nimbalyst (Vibecoding visual), vibe-kanban (review inline). `~/apohara-framework` (chasis Rust). Context Forge `SuarezPM/Apohara_Context_Forge` v6.1.0. Patrón Agent Teams: https://code.claude.com/docs/en/agent-teams.

## Ontología (Key Entities — convergida)
| Entidad | Tipo | Rol |
|---------|------|-----|
| Blade (CLI) | core | Unidad intercambiable autodetectada; habla MCP |
| Apohara-Lead | core | Orquestador hub/switchboard con lógica propia |
| Plan Maestro (DAG) | core | Objetivo descompuesto con dependencias |
| Shared Task List | core | Lista de tareas que los blades claman (file-lock) |
| Mailbox | core | Comunicación async del mesh (push-hooks + poll) |
| Reparto equitativo | core | Política híbrida configurable |
| Blade Integrador | supporting | Consolida incrementalmente por nodo |
| Dashboard | supporting | Utilización + calidad (anti-idle visible) |
| Permiso (blade×fase) | supporting | read-only/write/admin por fase |
| Memoria del mesh | supporting | Contexto compartido persistido |
| Context Forge | external | Compresión/dedup de contexto |
| MCP | external | Lingua franca del bus |

## Interview Transcript (resumen)
<details><summary>16 rounds, 2 sesiones, 2 challenge agents</summary>

- **R0** Topología: 5 componentes (Pablo subió UI/UX a activa).
- **R1** (sesión 1, pausó): mesh coordinado en vivo.
- **R2** BYOC + flujo + 2 modos + consenso + guiado.
- **R3** reparto híbrido configurable.
- **R4** (contrarian) mesh vía Agent Teams; Pablo aportó la doc.
- **R5** transporte MCP-bus + hub.
- **R6** (simplifier) no simplificar + bootstrapping/dogfooding.
- **R7** integrador incremental + review continuo.
- **R8** un motor, dos densidades (IDE primero).
- **R9** planner configurable (lógica propia + consenso opt-in).
- **R10** soft-limit: Pablo eligió cerrar los 6 detalles restantes.
- **R11** roster = autodetección PATH.
- **R12** métricas = dashboard utilización + calidad.
- **R13** entrega = push-hooks + poll-respaldo.
- **R14** modo guiado = híbrido opt-in (narra + pregunta + on-demand), no frena el flujo.
- **R15/16** memoria = episodic + indexer + ctx del mesh.
- **R16** permisos = por blade × fase.
</details>
