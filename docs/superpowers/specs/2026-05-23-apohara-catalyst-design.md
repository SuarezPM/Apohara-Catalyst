> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

# Apohara Catalyst — Design Spec

> **Fecha:** 2026-05-23
> **Branch destino:** `feat/apohara-catalyst` (deriva de `feat/apohara-ultimate` post-Sprint-7)
> **Relación con spec previo** (`docs/superpowers/specs/2026-05-22-apohara-ultimate-design.md`):
> este spec NO reemplaza al anterior; lo **extiende** con el rebrand a Apohara Catalyst,
> el cleanup pass de los gaps identificados, sqlite-vec swap, y el UI rebrand pixel-art
> alineado al brand board verified de `ecosystem/{probant,consilium}/`.
> **Predecesor**: tag local `v1.0.0` en SHA `bad17158` sobre `feat/apohara-ultimate` (NO push).
> **Estado de partida**: 1240 tests pass / 0 fail / 213 files / 13s. 198 commits subagent-driven
> distribuidos en Sprints 4-7. TypeScript: 3 errores pre-existing documentados.
> **Out of scope**: #6 demo video tooling + #7 perf benchmarks vs orca/vibe-kanban
> (deferred a post-launch); light theme (v1.1); mascot generative AI assets (post-launch);
> 10 features del "Important tier" (v1.1).

---

## Tabla de contenidos

- [§1 Visión + scope](#1-visión--scope)
- [§2 Architecture changes](#2-architecture-changes)
- [§3 Brand system](#3-brand-system)
- [§4 Sprint structure](#4-sprint-structure)
- [§5 Testing strategy](#5-testing-strategy)
- [§6 Rollback strategy](#6-rollback-strategy)
- [§7 Out of scope](#7-out-of-scope)
- [§8 Decisiones tomadas durante el brainstorming](#8-decisiones-tomadas-durante-el-brainstorming)
- [§9 Apéndices](#9-apéndices)

---

## §1 Visión + scope

**Apohara Catalyst** es el rebrand y polish final de Apohara Ultimate v1.0.0 hacia un release público listo para "repo of the day". El producto sigue siendo el mismo orquestador multi-AI local-first construido en Sprints 4-7 (24 crates Rust + 3 CLI providers + Coordinator + state machines + verification mesh + feature flags defense-in-depth) pero con tres ejes de cambio:

1. **Identity rebrand a "Apohara Catalyst"** — naming inspirado en el componente químico que acelera reacciones sin consumirse + métrica TTFT (Time To First Token) de LLMs. Dispatch paralelo a 3 providers reduce TTFT efectivo sin consumir tokens propios del orchestrator. Posicionamiento en el ecosystem: **PROBANT** (cross-AI code verifier) + **CONSILIUM** (agent governance OS) + **CATALYST** (multi-AI orchestrator).

2. **UI pixel-art rebrand AHORA** — adoptar el brand board verified de `ecosystem/{probant,consilium}/` (electric lime `#25B13F` + dark `#2A2D3A` + bone `#EDEFF0` + ink `#0E1010` + sparing crimson `#B8262A`; Press Start 2P + JetBrains Mono + Inter; square corners + 1px ink outlines; 16-bit pixel-art aesthetic). Robar las top 5 features no-brainer de los 10 reference repos auditados (`docs/reference-mining/ui-ux-deep-mining.md`) re-estilizadas al brand.

3. **Cleanup pass** — wiring de los ~18-20 standalone primitives entregados como build-then-integrate durante Sprints 5-6, fix de los 3 errores TS pre-existing, eliminación del legacy v1 dead code (30 fails en `src/`), implementación de §0.33 crash reports local-first, y SKILL.md para Apohara como Claude Code skill (reverse-orchestration viral mechanic).

### Estado de partida

- Branch: `feat/apohara-ultimate` con tag local `v1.0.0` en SHA `bad17158` (NO push)
- Suite: 1240 pass / 0 fail / 213 files / 13s
- TypeScript: 3 errores pre-existing (`McpServer.ts:67×2`, `watcher.ts:53`)
- 24 crates Rust workspace + 3 CLI providers activos (Claude Code, Codex, OpenCode) + 7 nuevos crates Sprint 6 (daemon, client, transport, ws-hub, ssh-server, remote-worker, reaction-engine)
- ~18-20 standalone primitives sin wiring identificados (build-then-integrate pattern)

### Estado final esperado

- Branch: `feat/apohara-catalyst` (deriva de `feat/apohara-ultimate`)
- Tag final: `v1.0.0` sobre Catalyst rebrand (re-tag tras validación rc.N)
- npm package: `@apohara/catalyst` (scoped)
- Repo: `apohara/catalyst` en GitHub (renombrado desde `apohara-v1-impl`)
- Suite: ~1300 pass / 0 fail
- TypeScript: 0 errors (los 3 pre-existing fixed en Sprint 7.5)
- UI rebrand completo aplicado a TaskBoard, VerificationTimeline, PermissionDialog, Statusline, empty states
- Apohara skill instalable en Claude Code via `apohara skills install claude`

### Métricas de éxito

1. Suite **>1290 pass / 0 fail** cross-platform CI (5 OS × 2 Node)
2. `npx -y @apohara/catalyst` instala y arranca desde máquina limpia en <60s
3. Run end-to-end visible en kanban pixel-art rebrand: prompt → 3 CLIs orquestados → verificación → commit MCP
4. `apohara doctor` green en Linux + macOS + Windows
5. Workflows automáticos (desktop-release.yml + npm-publish.yml) producen 6 binaries + 6 sha256 sidecars + npm publish con `--provenance`
6. SKILL.md instalado en `~/.claude/skills/apohara/` reverse-orchestration funcionando (user invoca `claude`, Claude descubre apohara via skill, dispatcha tasks)

### Lo que NO se cambia (identidad preservada)

- Local-first (instalable en máquina del usuario, no cloud)
- Tauri 2 (no Electron)
- bun:sqlite + Rust SQLx (no PostgreSQL)
- Single-user-per-machine (no multi-tenant)
- CLI wrappers ONLY (no OAuth flows para providers; TOS de Claude Code + simplicidad)
- Sin PostHog telemetry default-on (install-id anónimo opt-in via §0.33)
- 33 disciplinas §0 (sanitizeEnv, atomic writes, ts-rs SSoT, JSONC preservation, etc.)
- Feature flags defense-in-depth: APOHARA_DAEMON_MODE + APOHARA_REMOTE_WORKERS + APOHARA_SMART_ROUTER + APOHARA_REACTIONS + /yolo TRIPLE OFF (env + UI + per-workspace allowlist non-empty)

---

## §2 Architecture changes

**Sprint 7.5-11 son cambios mayoritariamente aditivos sobre la base de Sprints 4-7**. Ningún crate nuevo. Refactor concentrado en `src/core/*` wiring + `packages/desktop/*` rebrand.

### Modify (existentes con cambios)

| Path | Cambio | Sprint |
|---|---|---|
| `src/core/providers/BaseAgentProvider.ts` | Wire `buildSystemPrompt` (G5.A.3 standalone) al spawn path | 7.5 |
| `src/core/projector/` | Wire `projectToUiCards` + `projectToSearchRows` (G5.F.1) al TaskBoard + indexer | 7.5 |
| `src/core/projector/json-patch-stream.ts` | Wire `diffPatch`/`applyPatch` al SSE dispatcher | 7.5 |
| `packages/desktop/src/preview-proxy.ts` | Wire `createPreviewProxy` al dev server | 7.5 |
| `src/core/dispatch/reconciler.ts` | Reemplazar `runReconcilerTick` legacy por `runReconcilerPasses` (G5.B.2) | 7.5 |
| `crates/apohara-coordinator/` | Wire `auto_spawn` (G6.D.5) + `BlockedReason` classifier (G5.B.3) | 7.5 |
| `crates/apohara-hooks-server/` | Wire `CompactReinjector` + `additionalContext` composer + `learnings-dump` + `context-warnings` (G5.C) | 7.5 |
| `src/providers/cli-driver.ts` | Wire `composeWorktreeEnv` (G5.C.4) al spawn path | 7.5 |
| `src/core/safety/` | Wire `auto-approval` + `guardrail-flags` + `line-framed` + `tracker-adapter` (G5.G) a permissions + protocols | 7.5 |
| `crates/apohara-pathsafety/` | Wire `canonicalize_recursive` + `DanglingSymlink` Rust extras (G5.G.3) al sandbox path enforcement | 7.5 |
| `src/core/mcp/base/McpServer.ts:67` | Fix 2 TS errors `string \| undefined` / `number \| undefined` narrowing | 7.5 |
| `src/core/spec/watcher.ts:32` (línea actualizada a `:53` por G5.G.2) | Fix `onlyFiles` property — retirar (chokidar 5 lo ignora en runtime) | 7.5 |
| `crates/apohara-indexer/` | **REEMPLAZAR** Nomic BERT model + `tokio-rayon` con `sqlite-vec` extension. Drop OOM hazard, drop `APOHARA_MOCK_EMBEDDINGS`, drop §10 R1 rule | 8 |
| `Cargo.toml` workspace | Drop exclude de `apohara-indexer` (ya no es OOM hazard) | 8 |
| `npx-cli/package.json` | Rename a `@apohara/catalyst` (scoped) | 8 |
| `README.md` | Pain→relief actualizado con Catalyst tagline + DOI link | 8 |
| `CHANGELOG.md` | Entry "v1.0.0 ships as Apohara Catalyst, member of Apohara family" | 8 |
| `.github/workflows/{desktop-release,npm-publish}.yml` | Package name `@apohara/catalyst`, paths references actualizados | 8 |
| `packages/desktop/tailwind.config.js` | Agregar `apohara.{lime,dark,bone,ink,red,bg-{void,mid,raised}}` color tokens | 9 |
| `packages/desktop/src/index.css` | Agregar Press Start 2P + JetBrains Mono + Inter font imports + utility classes | 9 |
| `packages/desktop/src/components/*` | Re-estilizar todos los componentes existentes (TaskBoard, VerificationTimeline, PermissionDialog, Statusline) al brand | 9 |
| `packages/desktop/src/components/AgentStateDot.tsx` (NEW) | Robado de orca, 7 estados con palette Catalyst | 9 |
| `packages/desktop/src/components/PixelCanvas.tsx` (NEW) | Robado de chorus+orca, 7 sprite slots, SVG placeholder mascot | 9 |
| `packages/desktop/src/components/ConfirmationDialogProvider.tsx` (NEW) | Robado de orca, queue-based universal | 9 |
| `packages/desktop/package.json` | Agregar `@hello-pangea/dnd` + `sonner` + `cmdk` + `react-resizable-panels` deps | 9 |

### Create (nuevos sin precedente)

| Path | Responsabilidad | Sprint |
|---|---|---|
| `src/core/crash-reports/{installId,jsonl,redactor}.ts` | §0.33 crash reports local-first (install-id UUID + JSONL append + UI button "Send to Apohara") | 7.5 |
| `~/.claude/skills/apohara/SKILL.md` (instalable) | Reverse-orchestration mechanic — user invoca claude, Claude descubre apohara via skill | 7.5 |
| `packages/desktop/src/assets/sprites/` | SVG placeholder sprites del Native American chief (4 estados base: idle, working, celebrate, error) | 9 |
| `RELEASE_NOTES_v1.0.0.md` (refinado de existing) | Catalyst-aware draft + DOI link + ecosystem positioning | 10 |

### Delete (legacy v1 dead code + obsolete)

| Path | Razón |
|---|---|
| `src/agent-router.ts` + tests | Legacy v1, sin consumer post-Stage-11 (30 fails en suite) |
| `src/capability-manifest.ts` + tests | Idem |
| `src/config/validation.ts` + tests | Idem |
| `src/subagent-manager.ts` + tests | Idem |
| `src/providers/router.ts` (legacy router) + tests | Idem |
| Nomic BERT model artifacts en `crates/apohara-indexer/models/` | Reemplazado por sqlite-vec (Sprint 8) |
| `APOHARA_MOCK_EMBEDDINGS=1` references en CI + scripts | Workaround ya no necesario |
| `OOM hazard §10 R1` rule en `CLAUDE.md` | Ya no aplica post sqlite-vec swap |
| `.github/workflows/release.yml` (verificar si quedó residuo) | Sprint 7 G7.A.4 ya lo borró |

### Intact (identity preservada — no se toca)

- 24 crates Rust workspace (incluyendo los 7 de Sprint 6)
- 3 CLI providers activos
- Tauri 2 frontend
- 33 disciplinas §0
- Feature flags OFF default
- `feat/apohara-ultimate` branch + tag `v1.0.0` local (preservadas como referencia)

---

## §3 Brand system

Brand verified de `ecosystem/{probant,consilium}/scripts/brand-tokens-source.json` + `probant/docs/brand/{asset-prompts,typography-roadmap}.md`. Las decisiones son **directas lecturas del codebase de probant/consilium**, no invenciones.

### Color palette (Tailwind tokens)

```js
// packages/desktop/tailwind.config.js
theme: {
  extend: {
    colors: {
      apohara: {
        lime:  '#25B13F',   // electric lime — primary accent (success, active, brand)
        dark:  '#2A2D3A',   // blue-charcoal — secondary background, borders
        bone:  '#EDEFF0',   // bone-white — primary text, highlights
        ink:   '#0E1010',   // neutral black — outlines, deep shadows
        red:   '#B8262A',   // crimson — destructive, error (sparing — Aegis variant only)
        bg: {
          void:   '#0D0F18', // deepest background (root canvas)
          mid:    '#1E2130', // mid-layer cards, panels
          raised: '#222640', // raised elements (modals, dropdowns)
        }
      }
    }
  }
}
```

### Typography

```css
/* packages/desktop/src/index.css */
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&family=JetBrains+Mono:wght@400;500;700&family=Inter:wght@400;500;600&display=swap');

@layer base {
  :root {
    --font-display: 'Press Start 2P', monospace;  /* titles, brand */
    --font-mono:    'JetBrains Mono', monospace;  /* code, kanban cards, UI labels */
    --font-body:    'Inter', sans-serif;          /* long-form text (troubleshooting, docs) */
  }

  body {
    font-family: var(--font-mono);
    background: theme('colors.apohara.bg.void');
    color: theme('colors.apohara.bone');
  }

  h1, h2, h3, .brand {
    font-family: var(--font-display);
    color: theme('colors.apohara.lime');
    letter-spacing: 2px;
  }
}
```

**Aspiracional post-launch** (per `probant/docs/brand/typography-roadmap.md`): custom **Apohara Pixel Sans** font generado con BitFontMaker2 (~1d) o BMFont+FontForge (~3-5d). Stand-in actual: Press Start 2P (gets 80% of pixel-sans aesthetic).

### Component primitives (shadcn/ui base re-skinned)

| Patrón | Aplicación |
|---|---|
| Square corners | Drop `rounded-*` Tailwind — usar `rounded-none` o omitir |
| 1px ink outlines | `border border-apohara-ink` en cards, badges, dialogs |
| 3px lime top-border | `border-t-[3px] border-t-apohara-lime` en kanban columns |
| Sharp pixel edges | NO gradients, NO blur, NO anti-aliasing en gráficos |
| Sonner toasts | Top-right, dark theme `theme="dark"`, lime accent for success |
| cmdk command palette | Cmd+K trigger, mod+number shortcuts inline |
| Resizable panels | `react-resizable-panels` con 1px hover-band drag handle |
| TooltipProvider | 400ms delay (cross-repo standard) |

### Top 5 features no-brainer steal (re-estilizadas)

**1. AgentStateDot** (de `reference/orca/src/renderer/src/components/AgentStateDot.tsx`)

7 estados con semantic colors en palette Catalyst:
```ts
type AgentState = 'idle' | 'working' | 'done' | 'blocked' | 'waiting' | 'interrupted' | 'permission';
// idle → dark (#2A2D3A), working → yellow #F5C518 (animate pulse), done → lime (#25B13F),
// blocked → red (#B8262A), waiting → blue #007BFC, interrupted → red 50% opacity,
// permission → yellow border lime
```
Primitiva reusable en kanban cards, statusline, terminal headers. `React.memo` + size variant `sm | md`.

**2. PixelCanvas + Pet sprite system** (de `reference/chorus/src/components/pixel-canvas.tsx` + `reference/orca/src/renderer/src/components/status-bar/PetStatusSegment.tsx`)

Canvas 256×256 escala 3×, 7 slots con estados `empty | idle | typing | celebrate | looking`. Y-sort z-order, state machine per-slot con `frameTicks`. **Sprites del Native American chief mascot** (SVG placeholders por ahora — 4 estados base: idle, working, celebrate, error). Vive en empty states, statusline footer, dialogs.

**3. Kanban @hello-pangea/dnd + KanbanCardContent** (de `reference/vibe-kanban/packages/ui/src/components/KanbanBoard.tsx`)

Library más estable que dnd-kit. `Draggable.isDragging` snapshot permite hover + selected + dragging states simultáneos. KanbanCardContent out-of-the-box con priorities, tags, PR badges, assignees. Mobile drag-handle dot. `ring-2 ring-apohara-lime ring-inset bg-apohara-lime/5` para selected.

**4. Animated running border** (de `reference/vibe-kanban/packages/web-core/src/app/styles/new/index.css:270-340`)

```css
@keyframes border-flash {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
.chat-box-running {
  position: relative;
}
.chat-box-running::before {
  content: '';
  position: absolute; inset: 0;
  padding: 2px;
  background: linear-gradient(90deg, transparent, theme('colors.apohara.lime'), transparent);
  background-size: 200% 100%;
  animation: border-flash 2s linear infinite;
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor; mask-composite: exclude;
}
```
Aplica a cards en columna "Running" + chat-box durante agent stream. Mejor que spinner clásico.

**5. ConfirmationDialogProvider queue-based** (de `reference/orca/src/renderer/src/components/confirmation-dialog.tsx`)

Provider con cola de requests, returns `Promise<boolean>`:
```ts
const confirm = useConfirmation();
const ok = await confirm({
  title: 'Force Re-Run?',
  description: 'Task already completed. Re-running overwrites existing commit.',
  confirmVariant: 'destructive' // | 'default'
});
```
Reemplaza props drilling para permission dialogs (G5.D.2) y `/yolo` confirm.

### Mascot

Native American chief 3/4 profile facing left (per `probant/docs/brand/asset-prompts.md`):
- Feathered war headdress: electric lime (#25B13F) feather tips + bone-white (#EDEFF0) feather shafts
- Single thin crimson red (#B8262A) band en headdress middle (Aegis variant only)
- Face bone-white con warm tan undertones
- 1px neutral-black outlines, sharp pixel edges, 16-bit aesthetic
- NO gradients, NO blur, NO anti-aliasing

**v1.0**: SVG placeholder simple por ahora (`packages/desktop/src/assets/sprites/{idle,working,celebrate,error}.svg`).
**Post-launch**: asset real generado con nano-banana / Veo3 / Stable Diffusion fine-tune (prompts ready en `probant/docs/brand/asset-prompts.md`).

---

## §4 Sprint structure

5 sprints en approach C **híbrido** (paralelismo donde safe, secuencial donde hay deps). **~16 días total** con 4 implementers Opus + reviewers combinados por wave (mismo patrón Sprints 4-7).

### Sprint 7.5 — Cleanup pass (3-4 días)

**Objetivo**: cerrar los gaps reales antes del rebrand. Wiring + dead code removal + crash reports + SKILL.md.

| Tarea | Implementer | Files |
|---|---|---|
| Wire 18-20 standalone primitives | 1 (lista en §2 Modify) | varios `src/core/*` + `crates/*` |
| Fix 3 TS errors pre-existing | 2 | `McpServer.ts:67`, `watcher.ts:53` |
| BORRAR legacy v1 dead code (30 fails) | 3 | 5 archivos en `src/` + tests |
| §0.33 crash reports local-first | 4 | `src/core/crash-reports/{installId,jsonl,redactor}.ts` + UI button |
| SKILL.md para Apohara como Claude Code skill | 4 (paraleliza con crash reports) | `~/.claude/skills/apohara/SKILL.md` + `apohara skills install claude` test |

**Cierre**: suite gateada verde, 0 TS errors, suite tests ~1210 (delta -50 legacy + +20 wiring).

### Sprint 8 — sqlite-vec swap + rebrand Catalyst (2-3 días, paraleliza tail de 7.5)

**Objetivo**: eliminar OOM hazard + identity rebrand.

| Tarea | Implementer | Files |
|---|---|---|
| Replace Nomic BERT con sqlite-vec extension en `apohara-indexer` | 1 | `crates/apohara-indexer/*` + Cargo.toml dep |
| Drop `APOHARA_MOCK_EMBEDDINGS` workaround en CI + scripts | 1 (continuación) | `.github/workflows/*` + `scripts/dev-setup.sh` |
| Drop §10 R1 OOM rule en CLAUDE.md | 1 | `CLAUDE.md` + `apohara-v1-impl/AGENTS.md` |
| Drop cargo build workspace exclude de apohara-indexer | 1 | `Cargo.toml` workspace |
| Rebrand: create branch `feat/apohara-catalyst` desde `feat/apohara-ultimate` | 2 | (git ops) |
| npm package rename `apohara` → `@apohara/catalyst` | 2 | `npx-cli/package.json` + workflows + README |
| Tagline + DOI link en README | 2 | `README.md` |
| CHANGELOG entry "v1.0.0 ships as Apohara Catalyst" | 2 | `CHANGELOG.md` |
| SKILL.md actualizado con Catalyst naming | 2 | `~/.claude/skills/apohara/SKILL.md` |
| Renombrar repo `apohara-v1-impl` → `apohara/catalyst` en GitHub | Pablo | GitHub UI (Settings → Rename) |

**Cierre**: branch + npm + repo + docs alineados al nombre Catalyst. Suite tests ~1225 (delta +15).

### Sprint 9 — UI pixel-art rebrand (5-7 días, 2 implementers paralelos)

**Objetivo**: aplicar brand board + robar top 5 features + cross-repo patterns + re-estilizar componentes existentes.

**Setup (día 1)**:
| Tarea | Files |
|---|---|
| Tailwind config con `apohara.{lime,dark,bone,ink,red,bg.*}` tokens | `packages/desktop/tailwind.config.js` |
| Fonts Press Start 2P + JetBrains Mono + Inter | `packages/desktop/src/index.css` |
| Drop `rounded-*` Tailwind usage; agregar 1px ink outlines en cards | global re-estilo |
| Install shadcn/ui CLI + base components | `packages/desktop/components.json` |
| Install deps: `@hello-pangea/dnd`, `sonner`, `cmdk`, `react-resizable-panels` | `packages/desktop/package.json` |

**Top 5 features steal (días 2-4, 2 implementers paralelos)**:

Implementer A:
- `AgentStateDot.tsx` (G7.UI.1) — 7 estados, primitiva reusable
- `PixelCanvas.tsx` + sprites SVG placeholder (G7.UI.2) — 7 slots + mascot states
- `ConfirmationDialogProvider.tsx` (G7.UI.5) — queue-based, replace existing PermissionDialog

Implementer B:
- Kanban refactor con `@hello-pangea/dnd` (G7.UI.3) — `KanbanBoard.tsx` + `KanbanCardContent.tsx`
- Animated running border (G7.UI.4) — `chat-box-running` CSS keyframes
- Wire `AgentStateDot` + `running border` en kanban cards

**Cross-repo patterns (días 5-6)**:
- Sonner toasts en App.tsx provider
- cmdk Cmd+K palette base con navigate-only actions inicial
- Resizable panels en TaskBoard ↔ Terminal split
- TooltipProvider 400ms en root

**Brand applied + empty states (día 7)**:
- Re-estilizar TaskBoard, VerificationTimeline (G2 Sprint 2), PermissionDialog (reemplazado), Statusline (G5.C.2)
- Mascot SVG en empty states: TaskBoard vacío, error pages, /yolo blocked

**Cierre**: suite gateada verde + visual smoke en browser (start dev server + screenshot manual). Suite tests ~1285 (+60 component tests).

### Sprint 10 — Pre-release validation (3-4 días)

**Objetivo**: validar pipeline real con tag rc.N antes del v1.0.0 final.

| Tarea | Esfuerzo |
|---|---:|
| Push branch `feat/apohara-catalyst` a remote (Pablo authorize) | (Pablo decide) |
| Push tag `v1.0.0-rc.1` (Pablo authorize) | (Pablo decide) |
| Verify `desktop-release.yml` dispara → 6 binaries (linux/darwin/win × x64/arm64) + 6 sha256 sidecars + Tauri bundles | 0.5d watch + fix |
| Verify `npm-publish.yml` dispara → `@apohara/catalyst@1.0.0-rc.1` publicado con `--provenance` | 0.3d |
| Verify `npm install -g @apohara/catalyst@1.0.0-rc.1` desde clean dir → arranca UI | 0.3d |
| Cross-platform smoke en Linux (current) + macOS (si acceso) + Windows (CI matrix verified) | 0.5d |
| Bug-fixing rondas hasta rc.N estable (rc.2, rc.3...) | 1-1.5d |
| Hero screenshot real (capture manual con UI rebrand-ed completo) | 0.2d |

**Cierre**: rc.N estable, todos workflows verde, npm install funciona. Suite tests ~1300 (+15 npx tarball E2E + cross-platform smoke).

### Sprint 11 — Catalyst launch (1 día)

**Objetivo**: tag final + launch decision.

| Tarea | Quién |
|---|---|
| Pablo authoriza push `v1.0.0` final (re-tag desde rc.N estable) | Pablo |
| Workflows automáticos: `desktop-release.yml` builds 6 binaries + `npm-publish.yml` publica `@apohara/catalyst@1.0.0` | (CI) |
| Verify GitHub Release tiene 6 binaries reales + sidecars + bundles | Claude |
| Verify `npm install -g @apohara/catalyst@1.0.0` install funcional cross-platform | Claude |
| Pablo decide cuándo postar drafts de `RELEASE_NOTES_v1.0.0.md` (Twitter, HN, Reddit, LinkedIn) | Pablo |
| Engram session memo final | Claude |

---

## §5 Testing strategy

### Suite gates (mantenidos)

```bash
bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/ tests/cli/
```

**OOM-safe Rust testing** (per CLAUDE.md): `cargo test -p <crate> --lib` per-crate. Sprint 8 elimina la regla §10 R1 (Nomic BERT 400MB) — post-swap, `cargo test --workspace` debería ser viable (con sqlite-vec footprint <10MB).

### Tests target por sprint

| Sprint | Start | Δ esperado | End target | Notas |
|---|---:|---:|---:|---|
| 7.5 Cleanup | 1240 | -50 (legacy) / +20 (wiring + crash reports + SKILL.md tests) | ~1210 | Net delta -30 |
| 8 sqlite-vec + rebrand | ~1210 | +15 | ~1225 | sqlite-vec coverage + naming verifications + skill install smoke |
| 9 UI pixel-art | ~1225 | +60 | ~1285 | Component tests (AgentStateDot, PixelCanvas, Kanban, ConfirmationDialog) + integration |
| 10 Pre-release | ~1285 | +15 | ~1300 | npx tarball E2E + cross-platform smoke validation |
| 11 Launch | ~1300 | 0 | ~1300 | No tests added; verifications post-tag |

### Quality gates per sprint

- `bunx tsc --noEmit` → 0 errors target (post-Sprint-7.5 fix los 3 pre-existing)
- `cargo clippy -p <crate> --all-targets -- -D warnings` clean en crates touched
- CI matrix 5 OS × 2 Node verde (configurado en Sprint 6 W3.8)
- Sprint 10 adicional: `bun test tests/benchmarks/` smoke + bundle size guard

### Component testing UI (Sprint 9 nuevo)

| Component | Tests target |
|---|---:|
| `AgentStateDot.test.tsx` | 7 (uno por estado) + 2 (size variants) |
| `PixelCanvas.test.tsx` | 5 (canvas init, slot states, sprite loading, frame ticks, empty state) |
| `KanbanBoard.test.tsx` | 8 (render, drag start/end, drop columns, selected ring, mobile handle, empty col, multi-card) |
| `ConfirmationDialogProvider.test.tsx` | 5 (queue 1 dialog, queue 2 dialogs, destructive variant, dismiss returns false, await resolves) |
| `chat-box-running.test.tsx` | 3 (idle state, running state with border, stops on done) |
| Visual regression (optional Playwright) | 4 screenshots (TaskBoard, VerificationTimeline, PermissionDialog, Empty state) |

### Hook regression suite

- Existing 1240 tests deben mantenerse verde post cada sprint
- Wiring de primitives no debe romper tests pre-existing del primitive
- UI rebrand no debe romper tests de comportamiento (solo visual change)

---

## §6 Rollback strategy

### Branch isolation

```
feat/apohara-ultimate  ← tag v1.0.0 local (preservado, no push)
    │
    └── feat/apohara-catalyst  ← Sprints 7.5-11 commiteados aquí
            │
            ├── tag v1.0.0-rc.1
            ├── tag v1.0.0-rc.2
            └── tag v1.0.0 (final, post-validation)
```

- Si Sprint X falla: `git reset --hard HEAD~N` en `feat/apohara-catalyst` sin tocar `ultimate`
- Si rc.N tiene bugs: tag rc.N+1, no re-tag rc.N (immutable releases)
- Tag v1.0.0 final solo cuando rc.N estable

### Feature flags (defense in depth, OFF default mantenidos)

| Flag | Default | Sprint origen |
|---|---|---|
| `APOHARA_DAEMON_MODE=1` | OFF (monolithic shim) | 6 G6.A |
| `APOHARA_REMOTE_WORKERS=1` | OFF | 6 G6.C |
| `APOHARA_SMART_ROUTER=1` | OFF | 6 G6.D |
| `APOHARA_REACTIONS=1` | OFF | 6 G6.D |
| `/yolo` TRIPLE OFF | OFF (env + UI toggle + per-workspace allowlist non-empty) | 6 G6.E |

### Migration safety

- **npm package rename**: existing `apohara` users sin upgrade automático. README + CHANGELOG documentan transición. Considerar `apohara` deprecated package pointing to `@apohara/catalyst` post-launch (low priority — `apohara` no fue publicada al npm registry público en Sprints 4-7).
- **sqlite-vec swap**: read-only swap, no data migration needed. Re-index on first run after upgrade. No state corruption posible.
- **UI rebrand**: cero state change, solo visual. `localStorage` keys mantienen para session/preferences (status filter, theme preference).
- **Legacy v1 dead code delete**: si reaparece use case (unlikely), recoverable via `git log --follow` + restore en commit individual.
- **Repo rename GitHub**: `apohara-v1-impl` → `apohara/catalyst`. GitHub redirige old URLs automáticamente. Clones existing necesitan `git remote set-url`.

### Push safety (preservado, NO negociable)

- **NUNCA** `git push` sin autorización explícita de Pablo
- **NUNCA** `git push --tags` sin autorización explícita
- **NUNCA** postar drafts de `RELEASE_NOTES_v1.0.0.md` sin OK
- Pablo decides timing de tag `v1.0.0` final + workflow trigger
- Pablo decides timing del repo rename en GitHub Settings

---

## §7 Out of scope (deferred)

**Excluded explicitly por decisión durante el brainstorming** — quedan para post-launch o v1.1.

| Item | Razón | Cuándo |
|---|---|---|
| **#6 Demo video tooling** | Captura screen + post-process ffmpeg + upload requiere setup específico (OBS, wf-recorder, kooha) + hero screenshot real estable | Post-launch o cuando UI rebrand esté estable |
| **#7 Performance benchmarks vs orca/vibe-kanban** | Instalar competitors + medir decompose/dispatch/Run end-to-end requiere sample size razonable y máquinas no comprometidas | Post-launch con telemetría real |
| **Light theme** | Brand es dark-first. `#25B13F` sobre bone-white no pasa AA contrast — requiere palette light variant. ~1-2 días tunear | v1.1 |
| **Mascot generative AI assets** | Asset-prompts ready en `probant/docs/brand/`. Nano-banana / Veo3 / Stable Diffusion fine-tune ~3-5 días para quality consistente | Post-launch |
| **Cliente-daemon split production validation** | G6.A daemon shippeado OFF default; nunca probado con multiple clients real | Post-launch con early adopters opt-in |
| **SSH workers production validation** | G6.C SSH OFF default; nunca probado con worker remoto real | Post-launch con early adopters opt-in |
| **Smart Router telemetría real** | G6.D classifier OFF default; P/R 0.98 en smoke pero sin tracking producción | Post-launch con opt-in telemetry |
| **Reaction Engine production validation** | G6.D state machine OFF default; tests E2E pero sin issue/PR real | Post-launch con github-bridge users |
| **Important tier features (10)** | QuickOpen Cmd+K fuzzy, Onboarding 5-step, Permission Dock, ContextUsageGauge, ChatTodoList, Dashboard agent row, Status bar segments, NavigationGutter, MonacoDiffApprovalBar, ChatBox dropzone | v1.1 |
| **Custom Apohara Pixel Sans font** | Stand-in Press Start 2P es 80% del look. Custom font ~1-5d con BitFontMaker2 o BMFont+FontForge | v1.1+ |
| **Apohara skills marketplace** | Templates curados en `github.com/apohara/templates` como repo collection. Sin marketplace business model | v1.1 (curation post-launch) |
| **`apohara-sdk` npm package** | TS SDK para que users escriban sus propios providers/protocols/actions | v1.1+ |

---

## §8 Decisiones tomadas durante el brainstorming

(2026-05-23, sesión post-Sprint-7-close con Pablo en modo conversación)

1. **Top 5 features steal**: APROBADOS los 5 (AgentStateDot, PixelCanvas+sprites, Kanban dnd, animated running border, ConfirmationDialog queue) + cross-repo patterns (shadcn/ui + Sonner + cmdk + Resizable + Tooltip).

2. **Branch strategy**: nueva `feat/apohara-catalyst` deriva de `feat/apohara-ultimate` post-Sprint-7 (preserva tag v1.0.0 local de ultimate).

3. **npm naming**: `@apohara/catalyst` scoped (ecosystem cohesion con probant + consilium).

4. **Legacy v1 dead code**: **BORRAR** los 30 fails (~3000 LOC menos, suite limpia). Reversible via git history.

5. **Theme**: dark-only v1.0 + light v1.1 (brand alignment estricto).

6. **Mascot timing**: SVG placeholder ahora + asset generative AI post-launch.

7. **Repo name**: renombrar a `apohara/catalyst` en GitHub (alineado con apohara.dev/catalyst + ecosystem).

8. **Sequencing**: approach C **híbrido** (paralelismo donde safe, secuencial donde hay deps). ~16 días total con 4 implementers paralelos por wave.

9. **Out of scope**: confirmado #6 demo + #7 perf + light theme + mascot real + important tier (10 features v1.1).

---

## §9 Apéndices

### A. Glosario

- **Catalyst** — naming inspirado en componente químico que acelera reacciones sin consumirse + métrica TTFT (Time To First Token) de LLMs. Posicionamiento: orchestrator que reduce TTFT efectivo via dispatch paralelo a 3 providers sin consumir tokens propios.
- **Apohara family** — ecosystem de productos: PROBANT (cross-AI code verifier) + CONSILIUM (agent governance OS regulated industries) + CATALYST (multi-AI orchestrator local-first).
- **Brand board** — palette + tipografía + mascot + style rules verified en `ecosystem/{probant,consilium}/scripts/brand-tokens-source.json` + `probant/docs/brand/{asset-prompts,typography-roadmap}.md`.
- **No-brainer steal** — feature UI/UX de un reference repo cuya value/complexity ratio es alto y mecánica es claramente robable sin lock-in arquitectónico. Top 5 identificadas para v1.0.
- **Important tier** — 10 features cross-repo que son "should steal" pero no v1.0 (defer v1.1).
- **Sprint 7.5** — naming para indicar "cleanup pass" post-Sprint-7 + pre-Sprint-8. Half-sprint en effort, full sprint en discipline.

### B. Decisiones bloqueantes resueltas vs pending

Resueltas en este brainstorming (Pablo confirmado):
- ✅ 6 decisiones de pantalla 3 (branch, npm, cleanup, theme, mascot, repo)
- ✅ Approach C híbrido sequencing
- ✅ Top 5 features + cross-repo patterns
- ✅ Out of scope #6 + #7 + 4 más

Pending (Pablo decide en runtime):
- ⏳ Push timing para `feat/apohara-catalyst` y tags rc.N / v1.0.0
- ⏳ Repo rename en GitHub Settings (manual UI op)
- ⏳ Cuándo postar drafts de RELEASE_NOTES (Twitter, HN, Reddit, LinkedIn)
- ⏳ Validation post-launch con early adopters opt-in (feature flags daemon/SSH/Router/Reactions)

### C. Trazabilidad

- **Brand tokens**: `ecosystem/consilium/scripts/brand-tokens-source.json` (8 colores verified)
- **Typography**: `ecosystem/probant/docs/brand/typography-roadmap.md`
- **Mascot prompts**: `ecosystem/probant/docs/brand/asset-prompts.md` (ready for nano-banana/Veo3)
- **UI/UX mining**: `docs/reference-mining/ui-ux-deep-mining.md` (325 LOC, ~75 features de 10 repos)
- **Spec previo (Ultimate)**: `docs/superpowers/specs/2026-05-22-apohara-ultimate-design.md` (841 LOC)
- **Spec previo plan**: `docs/superpowers/plans/2026-05-22-apohara-ultimate-sprint-{4,5,6,7}.md`
- **Engram memos**: Sprint 4 cerrado · Sprint 5 cerrado · Sprint 6 cerrado · Ultimate v1.0.0 READY · Catalyst rebrand context

### D. Riesgos conocidos + mitigaciones

| Riesgo | Mitigación |
|---|---|
| sqlite-vec extension no disponible cross-platform (Windows ARM, Linux ARM) | Verificar en Sprint 8 antes de borrar Nomic. Fallback: mantener flag para usar Nomic en arquitecturas no soportadas |
| UI rebrand rompe tests existentes por DOM structure change | Cobertura existing testea comportamiento (clicks, state) no selectores CSS específicos. Refactor incremental con test re-runs continuos |
| GitHub repo rename rompe clones existing | GitHub redirige `git fetch` automáticamente. Pablo + Claude actualizan clones locales con `git remote set-url`. CI workflows con URL hardcoded actualizan en mismo commit |
| Apohara skill SKILL.md format cambia en Claude Code futuro | Versionar SKILL.md con frontmatter `version: 1`. Doctor verifica versión y warna si stale |
| Tag v1.0.0-rc.1 dispara workflows pero falla un binary cross-compile | rc.N pattern permite re-rolling sin afectar v1.0.0 final. Workflows fix iterativos |
| Hero screenshot capture en macOS/Windows requiere acceso a esas máquinas | Linux capture is enough para v1.0 launch. macOS/Windows screenshots como "coming soon" en README |

### E. Próximos pasos post-spec

1. **Step 7 (spec self-review)**: Claude pasa este spec por placeholder scan + internal consistency check + ambiguity check. Fix inline.
2. **Step 8 (user reviews spec)**: Pablo lee el archivo y aprueba o pide cambios.
3. **Step 9 (transition to writing-plans)**: si Pablo aprueba, Claude invoca skill `superpowers:writing-plans` para producir el plan de implementación per-sprint con pasos TDD bite-sized.

### F. Mantenimiento del spec

Spec es **fuente de verdad** del scope Apohara Catalyst. Si durante ejecución de Sprints 7.5-11 algo cambia, el cambio se documenta en:

1. PR/commit que lo causa
2. Update a este spec en sub-sección "Decisiones tomadas durante ejecución" (a crear cuando aplique)
3. Engram memory entry con `mem_save` (tipo `decision`)

NUNCA dejar drift entre spec y código sin documentar.

---

*Fin del spec Apohara Catalyst.*
