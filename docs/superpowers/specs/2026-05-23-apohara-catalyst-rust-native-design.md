> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

# Apohara Catalyst — Pure Rust Native Rewrite Design Spec

> **Fecha:** 2026-05-23
> **Branch destino:** `feat/apohara-catalyst` (continúa desde Sprint 10 cierre `ded3b4a`)
> **Relación con specs previos**:
> - Reemplaza la trayectoria `2026-05-23-apohara-catalyst-design.md` (rebrand Catalyst con TS UI + Rust core)
> - Reemplaza el spec implícito de la integración ContextForge × Catalyst (originalmente planeada como 2 sprints densos Rust port + 2-tier cache + Z3 verification-mesh)
> - Subsume y expande el plan vigente: ahora es **rewrite completo a 100% Rust source**, no integración aditiva
> **Estado de partida**: 1370 tests pass / 0 fail / 247 files TS. Cargo workspace verde. 23 Rust crates existentes + ~43k LOC TypeScript. Sprint 11 launch operacional parado esperando sign-off (será reemplazado por Phase 4 S25 al final de esta trayectoria).
> **Out of scope**: light theme (v1.1); mascot generative AI assets (post-launch); 10 features "Important tier" del UI mining (v1.1); Apple notarization si no hay Apple Dev account; Windows code signing si no hay cert.

---

## Tabla de contenidos

- [§0 Decisiones tomadas durante brainstorming](#0-decisiones-tomadas-durante-brainstorming)
- [§1 Architecture (Rust-native)](#1-architecture-rust-native)
- [§2 Crate organization](#2-crate-organization)
- [§3 Dioxus UI strategy](#3-dioxus-ui-strategy)
- [§4 Sprint structure (Phase 1-4)](#4-sprint-structure-phase-1-4)
- [§5 Testing + migration + distribution + risks](#5-testing--migration--distribution--risks)
- [§6 Acknowledgments](#6-acknowledgments)

---

## §0 Decisiones tomadas durante brainstorming

Resumen de las decisiones que estructuran este spec:

| # | Pregunta | Decisión Pablo | Resuelve |
|---|---|---|---|
| 1 | Cómo integrar ContextForge en Catalyst | Rust port (crates dedicados, no PyO3 ni sidecar) | Risk #5 coupling |
| 2 | Cache backend para 2-tier | Hybrid 2-tier (HOT DashMap + WARM SQLite WAL + async write-back + latency budget guardrail) | Risk #2 latency |
| 3 | Semantic equivalence strategy | 3 layers: L1 cache key scoping, L2 confidence threshold, L3 opt-in flag + telemetry | Risk #3 cross-provider mismatch |
| 4 | Z3 SMT proof scope | Direct port `z3_inv15_proof.py` → Rust + apply al verification-mesh + rename compound-bash INV-15 → INV-bash-scope | Risk #4 Z3 complexity |
| 5 | Timing relativo a launch | 2 sprints densos (~13d) — **superseded por decisión 6 abajo** | — |
| 6 | Scope final del proyecto | **AGGRESSIVE NATIVE — Full Rust source including UI (Dioxus)**. Sprint 9 React rebrand se rehace. ETA pasa de 3 weeks a ~14 weeks. | Foundational pivot |
| 7 | UI framework | **Dioxus** (React-like rsx! macro + signals + CSS preservation), no Slint | UI rewrite path |

---

## §1 Architecture (Rust-native)

### Visión

Apohara Catalyst v1.0.0 ships como **single static Rust binary** (per platform), instalable via `cargo install apohara` o package managers nativos (AUR, Homebrew, Scoop, GitHub Releases). El usuario NO instala Node, Bun, Python, o cualquier runtime. Cero TypeScript en el source. Cero JS en el cliente excepto el que Dioxus genere para el WebView render (que es transparente al usuario).

### Capas

```
┌─────────────────────────────────────────────────────────────────────────┐
│                APOHARA CATALYST — 100% RUST SOURCE                      │
│            single static binary · cargo install apohara                 │
└─────────────────────────────────────────────────────────────────────────┘

LAYER 5 — Binary entry points
  apohara          (CLI, clap-rs + tokio)
  apohara-desktop  (Tauri 2 + Dioxus UI)
  apohara-tui      (ratatui terminal UI)

LAYER 4 — Orchestration
  apohara-dispatch · apohara-decomposer · apohara-projector

LAYER 3 — Services
  apohara-verification · apohara-mcp · apohara-hooks · apohara-spec

LAYER 2 — Safety + cache
  apohara-safety · apohara-prompt-cache · apohara-context-primitives

LAYER 1 — Foundation (existing 23 crates)
  apohara-{types, pathsafety, sandbox, secrets, audit, coordinator,
           indexer, token-accounting, hooks-server, mcp-bridge,
           attention, anti-thrash, worktree, notifications, persistence,
           ssh-server, remote-worker, daemon, client, transport,
           ws-hub, reaction-engine, event-humanizer}
```

### Boundary rules

Permanece sin tocar:
- Las 23 Rust crates existentes (sandbox/coordinator/indexer/etc.) — ya son Rust.
- Tauri 2 shell (es Rust).
- Sprint 9 brand tokens (palette + fonts + CSS) — se re-aplican a Dioxus vía CSS.
- 33 §0 disciplines documentadas en CLAUDE.md.
- Past incidents en CLAUDE.md.
- Spec docs, plans, runbooks generados en Sprints 7.5-10.

Se reescribe:
- `src/core/*` (~30k LOC TS) → 7 nuevos crates Rust (Phase 1).
- `src/commands/` + `src/cli.ts` → `apohara` binary clap-rs (Phase 1 close).
- `src/providers/cli-driver.ts` → `apohara-dispatch` crate.
- React components Sprint 9 → Dioxus rsx! components (Phase 2).
- `packages/desktop/src/server.ts` (Bun.serve) → axum integration OR eliminar (Tauri handles).
- `packages/tui` (Ink) → ratatui (Phase 3).
- `npx-cli` wrapper → cargo install instructions (Phase 3-4).
- 1370 bun:test → cargo test + insta snapshots (migrated crate-by-crate en Phase 1-2).

### 3 problemas duros (componentes UI complejos)

1. **Terminal embed** (xterm.js → alacritty_terminal crate + custom Dioxus renderer): alacritty está bien factored como library, port es achievable. Risk medio. Si bloquea: feature deferred a v1.1 con honest documentation.
2. **Code editor** (monaco-editor → syntect + custom widget): feature reduction aceptada — sin IntelliSense, sí syntax highlighting + diff view. Suficiente para code review. Risk bajo.
3. **DAG visualization** (@xyflow/react → custom SVG/canvas + petgraph layout): más simple que terminal. Risk bajo.

### 5 principios de diseño

1. **ZERO TS RUNTIME**: el binary distribuido es Rust-only. No requiere Node/Bun en cliente. `cargo install apohara` works.
2. **PHASE GATES**: cada Phase produce un milestone shippable. Si Phase 2 atrasa, podés ship con UI react legacy (degraded). Cada Phase tiene su propio cierre.
3. **PRESERVE CONCEPTS**: Sprint 9 brand tokens + Sprint 8 sqlite-vec + 33 §0 disciplines + INV-bash-scope se preservan. Solo cambia el lenguaje del implementación.
4. **INCREMENTAL CUTOVER**: Phase 1 produce crates Rust. La TS sigue funcionando mientras tanto via feature flags. Cutover progresivo, no big-bang.
5. **ACCEPT TRADEOFFS**: monaco-editor → syntect es feature reduction. Aceptamos UX hit por purist Rust. Documentar honest en RELEASE_NOTES.

---

## §2 Crate organization

### 11 crates nuevos (~51k Rust LOC desde ~43k TS)

| Sprint | Crate | Absorbe (TS modules) | LOC est. | Depende de |
|---|---|---|---|---|
| S12 | `apohara-dispatch` | cli-driver.ts + dispatch/{reconciler,state,executor,continuation,retry-semantics,teammate-idle,careful-mode} | ~8k | coordinator, sandbox, secrets, token-accounting |
| S13 | `apohara-verification` | verification/{mesh,JCR,qualityGates}/* | ~5k | types, audit |
| S13 | `apohara-safety` | safety/{permissions, bashCompoundAnalyzer, settingsHierarchy, durablePrompt, runnerPolicy, permissionService, permissionGuard, auto-approval}/* | ~6k | pathsafety, secrets, audit |
| S13 | `apohara-spec` | spec/{watcher, planDocuments, planStatusCache}/* | ~3k | notify-rs, types |
| S14 | `apohara-mcp` | mcp/{bootstrap, canonicalSchema, mcpInjection, base, servers/{ledger,runs,indexer,settings}}/* | ~7k | rmcp, types, mcp-bridge |
| S14 | `apohara-hooks` | hooks/{compact-reinjection, additionalContext, learnings-dump, context-warnings, agent-hooks installer, events bridge}/* | ~4k | hooks-server (existing axum) |
| S14 | `apohara-decomposer` | decomposer/* | ~3k | types, spec |
| S14 | `apohara-projector` | projector/{transcript-transformer, json-patch-stream}/* | ~3k | types |
| S15 | `apohara` (binary) | commands/* + cli.ts + cli/* | ~5k | clap-rs + ALL above |
| S21 | `apohara-context-primitives` | NEW (port mecánico desde ContextForge Python) | ~4k | blake3, fastembed-rs |
| S21 | `apohara-prompt-cache` | NEW (HOT DashMap + WARM SQLite + key scoping) | ~3k | rusqlite, context-primitives |

Total nuevos: **~51k Rust LOC**. Rust más compacto que TS (factor ~0.85×) — coincide con estimación 43k TS → 51k Rust por la verbosity de structs/enums + match exhaustiveness.

### Dependency graph layered

Layering rules: una crate solo puede depender de crates en layers inferiores. Esto previene cycles + facilita testing aislado. Layer 5 (binaries) son los únicos consumers; no son consumidos por nadie.

### Migration strategy incremental

Phase 1 NO requiere borrar el código TS de golpe. Pattern:

1. **Crate por crate**: implementar Rust crate + tests + bench. Mientras tanto el TS sigue funcionando.
2. **Cutover via feature flag**: `APOHARA_RUST_DISPATCH=1` activa el Rust crate via Tauri command. Default OFF en Sprint 12. CI prueba con flag ON.
3. **Default flip en Phase 1 cierre (S15)**: cuando los 7 crates Phase 1 están green, flip default a Rust. TS pasa a fallback (legacy marker).
4. **Delete TS en Phase 2 (S19)**: una vez UI port a Dioxus está done, single commit `chore: delete legacy TS source post-Rust-native cutover` que borra `src/` + `packages/desktop/src/` (excluding Tauri config) + `packages/tui/` + `npx-cli/`. Cero TS source post-S19.

Durante Phase 1 hay double maintenance tax (Rust nuevo + TS legacy del mismo módulo). Es **finito** — ~4 sprints. Después se borra el TS.

---

## §3 Dioxus UI strategy

### Mental model preserved

Dioxus es React-like:
- `rsx!` macro reemplaza JSX
- `signals` reemplazan jotai atoms (read/write API similar)
- `use_coroutine` reemplaza React hooks para async ops
- `tauri-sys invoke` reemplaza `@tauri-apps/api` invoke

La translation es mecánica (1-a-1) para 8 de 14 components Sprint 9.

### Component mapping (Sprint 9 → Dioxus)

| React Component | Dioxus Plan | Effort |
|---|---|---|
| HeroBanner.tsx | Direct rsx! port — preserves CSS | Fácil |
| AgentStateDot.tsx | Direct port | Fácil |
| KanbanBoard.tsx (@hello-pangea/dnd) | Custom dnd con HTML5 Drag API + signals | Media |
| RunningBorder.tsx | CSS keyframes transfer directo | Fácil |
| ConfirmationDialogProvider (Radix) | Native Dioxus dialog primitive + queue state | Media |
| PixelCanvas.tsx | HTML5 canvas via Dioxus refs + JS interop ad hoc | Media |
| CommandPalette.tsx (cmdk) | Custom rsx! + dioxus-document keybind + fuzzy-matcher crate | Media |
| Sonner toasts | dioxus-toast crate o custom (~50 LOC) | Fácil |
| TooltipProvider (Radix) | Custom impl con hover state + delay (~80 LOC) | Fácil |
| react-resizable-panels | Custom impl con mouse events + signals (~120 LOC) | Media |
| Button/Input/Card primitives | Direct port. Sin forwardRef (Dioxus refs son distintos) | Fácil |
| TerminalPane.tsx (xterm.js) | alacritty_terminal crate + custom Dioxus renderer | **Duro** |
| CodeDiffPane.tsx (monaco) | syntect + custom diff widget (feature reduction) | **Duro** |
| SwarmCanvas.tsx (@xyflow) | Custom SVG render + petgraph para layout | **Duro** |

### State management (jotai → Dioxus signals)

Pattern:
```rust
// Replaces: import { atom } from "jotai"; export const tasksAtom = atom<Record<string, Task>>({});
use dioxus::prelude::*;
use std::collections::HashMap;

pub static TASKS: GlobalSignal<HashMap<String, Task>> = Signal::global(HashMap::new);

pub fn upsert_task(task: Task) {
    let mut tasks = TASKS.write();
    tasks.insert(task.id.clone(), task);
}
```

Consumer:
```rust
let tasks = TASKS.read();  // read-only access
button { onclick: move |_| upsert_task(my_task.clone()) }
```

### Tauri 2 IPC pattern

Dioxus UI ↔ Rust core crates via Tauri commands:

```rust
// Rust side
#[tauri::command]
async fn dispatch_run(prompt: String, role: AgentRole) -> Result<RunId> {
    apohara_dispatch::run(prompt, role).await
}

// Dioxus side
let dispatch_run = use_coroutine(|mut rx: UnboundedReceiver<String>| async move {
    while let Some(prompt) = rx.next().await {
        let result = invoke::<RunId>("dispatch_run", json!({ "prompt": prompt, "role": "coder" })).await;
    }
});
```

Mismo pattern que React + Tauri actual, solo cambia el client lang.

---

## §4 Sprint structure (Phase 1-4)

### Phase 1 — Core ports (S12-S15, ~20d)

| Sprint | Scope | Días | Gate cierre |
|---|---|---|---|
| S12 | `apohara-dispatch` — port cli-driver + dispatch/{reconciler,state,executor,4 gates}. Feature flag `APOHARA_RUST_DISPATCH=1` default OFF | ~5d | cargo test verde + bench vs TS shows ≥1.5× |
| S13 | `apohara-verification` + `apohara-safety` + `apohara-spec` — 3 crates en paralelo | ~6d | cargo test verde + INV-bash-scope rust-port pass + spec watcher hot reload |
| S14 | `apohara-mcp` + `apohara-hooks` + `apohara-decomposer` + `apohara-projector` — 4 crates en paralelo | ~6d | rmcp servers funcionando + hooks bridge end-to-end + decomposer paridad |
| S15 | `apohara` CLI binary (clap-rs). Default flip: features ON. TS legacy marker | ~3d | `apohara doctor` runs from Rust binary + paridad con TS legacy |

**Phase 1 milestone**: *"Rust core is the default. TS is the fallback."* Releasable as **v1.0.0-rc.2** "Rust core + React UI" — defensible standalone.

### Phase 2 — UI rewrite (S16-S19, ~25d)

| Sprint | Scope | Días | Gate cierre |
|---|---|---|---|
| S16 | Dioxus bake-off + project setup. Hot reload pipeline. Mockup con 1 component. Decision gate: pivot a Slint si blockers serios | ~5d | Dioxus desktop shell boot + 1 brand component live + hot reload <500ms |
| S17 | Wave A — brand components Sprint 9 (HeroBanner, AgentStateDot, TaskBoard, KanbanBoard, PixelCanvas, RunningBorder, Button/Input/Card primitives) | ~7d | Visual smoke parity con React side-by-side |
| S18 | Wave B — polish components Sprint 9 (ConfirmationDialogProvider, CommandPalette, Sonner toasts, TooltipProvider, resizable panels equiv, ViewToggle, Statusline, ObjectivePane) | ~8d | Toda UI funciona en Dioxus + cmd+K + dialogs + toasts + resize |
| S19 | Hard components (TerminalPane → alacritty, CodeDiffPane → syntect, SwarmCanvas → petgraph). Jotai → signals cutover. Delete React + Bun + Tailwind libs (Tailwind sigue en Dioxus via CSS) | ~5d | Cero TS source en repo + UI completa Dioxus + Tauri build verde |

**Phase 2 milestone**: *"Zero TypeScript in the repo."* Releasable as **v1.0.0-rc.3** "100% Rust source" — branding factually true.

### Phase 3 — TUI + ContextForge + Z3 (S20-S22, ~15d)

| Sprint | Scope | Días | Gate cierre |
|---|---|---|---|
| S20 | TUI ratatui (Dashboard, AgentList, CostTable, config wizard). Remove npx-cli (replace con cargo install instructions) | ~5d | apohara-tui binary runs, parity con TS Ink TUI |
| S21 | `apohara-context-primitives` + `apohara-prompt-cache` (port mecánico ContextForge primitivas → Rust). 2-tier cache + L1/L2/L3 safety + telemetry | ~6d | Cache hit ratio bench + token savings + risk #2/#3 mitigations green |
| S22 | Z3 INV-15 port + verification-mesh wiring. Rename compound-bash INV-15 → INV-bash-scope. CI regenera proof | ~4d | Z3 SMT proof regenera en CI + verification-mesh enforces INV-15 + paper citable |

**Phase 3 milestone**: ContextForge integrated + paper citable. Releasable as **v1.0.0-rc.4** "Rust + ContextForge + Z3" — full vision.

### Phase 4 — Distribution + launch (S23-S25, ~10d)

| Sprint | Scope | Días | Gate cierre |
|---|---|---|---|
| S23 | Cross-platform binary builds + signing (GitHub Actions matrix: x86_64 + aarch64 Linux + macOS Apple Silicon + Windows MSVC). Apple notarization opcional. Windows code signing opcional | ~4d | 3 OS binaries built en CI matrix, uploaded como artifacts |
| S24 | Distribution: cargo publish (crates.io), AUR upload, Homebrew formula, Scoop, GitHub Releases con binaries. README badges | ~3d | `cargo install apohara` works + AUR + Homebrew committed + GitHub Release |
| S25 | Launch operacional. Sign-off form. PR feat/apohara-catalyst → main. Tag v1.0.0. cargo publish. Public announcements | ~3d | v1.0.0 live en cargo + AUR + Homebrew + GitHub Releases simultáneo |

**Phase 4 milestone**: **v1.0.0 final** — public launch en todos los channels.

### Timeline total

```
NOW                                                              LAUNCH v1.0
 │                                                                   │
 ╞═════════════╤═════════════════╤═════════════════╤═════════════════╡
 │ Phase 1 ~20d│ Phase 2 ~25d    │ Phase 3 ~15d    │ Phase 4 ~10d    │
 │ Core ports  │ UI rewrite      │ TUI + CF + Z3   │ Distro + Launch │
 ╞═════════════╧═════════════════╧═════════════════╧═════════════════╡
                                                                    │
                                                       ~70 días = 14 weeks
                                                       ≈ 3.5 meses
                                                       ETA mid-September 2026
```

Subagent-driven autónomo Opus 4.7 con paralelización donde aplica (crate-por-crate disjoint, components-por-Wave).

---

## §5 Testing + migration + distribution + risks

### Testing strategy

| Current (bun:test) | Target (Rust) | Migration timing |
|---|---|---|
| Unit tests (1370 actual) | cargo test + insta | Crate-by-crate junto al código en Phase 1 |
| Integration tests | cargo test --test name | Cada crate tiene tests/ dir |
| UI snapshot tests | dioxus-test (component render assertions) | Reescribir en Phase 2 |
| Playwright e2e (9 specs) | tauri-driver + WebDriver | Port en Phase 4 pre-launch |
| Cargo workspace tests | cargo test --workspace | Sin cambio |

Gate por sprint: cada Rust crate cierra con `cargo test -p <crate>` verde + paridad funcional con TS equivalent (mismo input → mismo output). Property-based testing via `proptest` donde aplica (parsers, sanitizers).

### Migration cutover pattern

Feature flags por crate durante Phase 1:
```
APOHARA_RUST_DISPATCH=1       # S12 — apohara-dispatch
APOHARA_RUST_VERIFICATION=1   # S13
APOHARA_RUST_SAFETY=1         # S13
APOHARA_RUST_SPEC=1           # S13
APOHARA_RUST_MCP=1            # S14
APOHARA_RUST_HOOKS=1          # S14
APOHARA_RUST_DECOMPOSER=1     # S14
APOHARA_RUST_PROJECTOR=1      # S14
```

Default OFF durante sprint. CI prueba con flag ON. Cierre sprint → flip default ON. Cierre Phase 1 → todos default ON + TS legacy `@deprecated` marker.

TS delete timing: single commit en cierre de Phase 2 S19 que borra `src/` + `packages/desktop/src/` + `packages/tui/` + `npx-cli/`.

### Error handling

- **Library crates** usan `thiserror` para defined error types + context. Cada crate exporta `Error` + `Result<T>` alias.
- **Binary crates** (apohara, apohara-desktop, apohara-tui) usan `anyhow` para top-level error reporting (user-facing).
- **Tauri commands** serializan errors a JSON-friendly shape (`impl Serialize for Error`).
- **Crash reports §0.33** (Sprint 7.5 G7.5.D) migra a Rust crate `apohara-crash-reports` en S14.
- **Panics**: `panic::set_hook` en binaries para capturar y redirigir a crash reports.

### Distribution channels

| Channel | Comando user | Platform | Sprint |
|---|---|---|---|
| crates.io | `cargo install apohara` | Cualquier OS con Rust toolchain | S24 |
| AUR | `yay -S apohara-catalyst-bin` | Arch / CachyOS | S24 |
| Homebrew | `brew install apohara-catalyst` | macOS + Linux | S24 |
| Scoop | `scoop install apohara-catalyst` | Windows | S24 |
| GitHub Releases | Manual download + chmod +x | Cualquier OS | S23 |
| Docker | `docker run apohara/catalyst` | Container envs | Defer v1.1 |

Build pipeline (S23 GitHub Actions matrix):
- x86_64-unknown-linux-gnu (Ubuntu 22.04)
- aarch64-unknown-linux-gnu (Ubuntu 22.04 cross)
- x86_64-apple-darwin (macOS 14)
- aarch64-apple-darwin (macOS 14 native)
- x86_64-pc-windows-msvc (Windows 2022)

Apple notarization opcional si hay Apple Dev account. Windows code signing opcional si hay cert.

### Risk register

| Risk | Severity | Mitigation |
|---|---|---|
| Dioxus madurez (S16 bake-off blocker) | Medio | S16 decision gate → pivot a Slint si fail |
| alacritty_terminal integration en Dioxus | Medio | Investigation spike en S16 antes de commit a integration path; fallback "Terminal coming in v1.1" si bloquea |
| monaco → syntect feature loss | Bajo | Aceptado en §1; documentado en RELEASE_NOTES |
| 1370 tests migration tiempo | Medio | Crate-by-crate junto al código en Phase 1; no separate sprint |
| Cache lookup overhead | Bajo | Hybrid 2-tier (decision #2) + latency budget guardrail |
| Cross-provider cache mismatch | Bajo | 3 layers (decision #3); imposible por construcción |
| Z3 SMT proof complexity | Bajo | 209 LOC port + paper proof reusable; 3-4 días |
| Launch timeline atrasa | Alto | Phase gates = rollback insurance. Phase 2 cierre = rc.3 shippable |
| Pablo pivot mid-camino | Medio | Phase gates documentados; cada Phase cierre = shippable. Memory + mem_session_summary preservados |
| Apple notarization / Windows signing | Medio | Opcional en S23. Si no hay certs, ship sin signing + instructions |

### Phase gates como rollback insurance

| Phase cierre | Si pausamos aquí, ship as... |
|---|---|
| Phase 1 cierre (S15) | **v1.0.0-rc.2** "Rust core + React UI" — defensible |
| Phase 2 cierre (S19) | **v1.0.0-rc.3** "100% Rust source" — branding válido |
| Phase 3 cierre (S22) | **v1.0.0-rc.4** "Rust + ContextForge + Z3" — full vision |
| Phase 4 cierre (S25) | **v1.0.0 final** — public launch |

Cada Phase cierre es un release candidate viable. Si pivot mid-camino, no quedás con branch a medio rewrite — tenés un binario shippable.

---

## §6 Acknowledgments

This rewrite stands on the shoulders of:

- **Apohara ContextForge** (sister project, Pablo's authorship) — provides the formal foundations (INV-15 paper, JCR Safety Gate, SimHash anchor matching, Queueing Theory λ-critical model). Z3 SMT proof artifact reused via direct port.
- **Dioxus** team — React-like Rust UI framework that makes Phase 2 feasible. https://dioxuslabs.com/
- **Tauri 2** team — Rust desktop shell with WebView, IPC, packaging. https://tauri.app/
- **alacritty** team — extracted `alacritty_terminal` crate enables terminal-as-library.
- **ratatui** team — Rust TUI framework replacing Ink. https://ratatui.rs/
- **syntect, petgraph, blake3, sqlite-vec, fastembed-rs, z3-rs, clap, anyhow, thiserror, proptest, dashmap, rusqlite, tokio, axum, rmcp, notify-rs** — the Rust ecosystem.
- **The 10 reference repos audited** (orca, chorus, vibe-kanban, agentrail, claude-octopus, culture, multica, nimbalyst, opencode, symphony) — Sprint 9 features stolen + re-implemented Rust-native in Phase 2.
- **Subagent-driven development** workflow — Sprints 4-10 demonstrated this pattern's reliability autonomously. Phase 1-4 continues the pattern.

---

*Spec complete. Phase 1 arranca cuando Pablo apruebe writing-plans.*
