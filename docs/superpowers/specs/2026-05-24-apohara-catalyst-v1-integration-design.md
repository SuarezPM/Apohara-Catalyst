# Apohara Catalyst v1.0 — Personal Integration Design (Sprint 23)

**Goal**: Convertir el bake-off Dioxus actual (solo monta `HeroBanner`) en una app v1.0 lanzable desde el escritorio Arch del usuario, integrada end-to-end con los 8 backend crates Rust-native que ya existen post-Phase 1-3, sin scope de distribución pública.

**Scope locked**:
- Personal v1.0 (Arch only, `cargo install --path`) — no CI matrix, no cross-platform builds, no AUR/Homebrew/Scoop.
- Full ROADMAP visión UI: 3-pane (ObjectivePane | SwarmCanvas | CodeDiff) + KanbanBoard alterna + CommandPalette (Cmd+K) + PermissionDialog + Toast + Statusline + TerminalPane drawer.
- Las 8 `tauri_bridge.rs` vestigiales se renombran `api.rs` + se borra el `#[cfg(feature='tauri')]` wrapper + se elimina `tauri = optional` dep. Dioxus components llaman directo via `use_future`.

**Source state**: branch `feat/apohara-catalyst` HEAD `62e328c` (Phase 4 G4.A+G4.B prep done). 156 commits acumulados desde Phase 1 G1.A.3.

---

## 1. Arquitectura

### 1.1 Layout shell (Layout-first + slot composition)

3-pane CSS grid + 3 overlays raíz. Composable: cualquier slot puede swap content sin tocar el shell.

```
┌──────────────────────────────────────────────────────────────────────┐
│ TopBar: HeroBanner(compact) + ProviderRoster + ViewToggle           │
├──────────────┬────────────────────────────────┬──────────────────────┤
│              │                                │                      │
│ ObjectivePane│ CenterPane (swap via signal)   │ CodeDiffPane         │
│  (textarea + │  ┌──────────────────────────┐  │  (diff w/ Accept/    │
│   Run button │  │ SwarmCanvas DAG          │  │   Reject; empty      │
│   + SPEC     │  │   OR                     │  │   state when none)   │
│   loader)    │  │ KanbanBoard 4 lanes      │  │                      │
│              │  │   OR                     │  │                      │
│              │  │ TaskBoard list           │  │                      │
│              │  └──────────────────────────┘  │                      │
│              │  TerminalPane drawer per task  │                      │
├──────────────┴────────────────────────────────┴──────────────────────┤
│ Statusline: active provider · token totals · ledger pos · clock     │
└──────────────────────────────────────────────────────────────────────┘
  Overlays raíz: CommandPalette(Cmd+K) · ToastContainer · PermissionDialog
```

Files:
- `crates/apohara-desktop-dioxus/src/app.rs` — replace; mounts MainLayout + overlays
- `crates/apohara-desktop-dioxus/src/layout/{mod,main_layout,top_bar,left_pane,center_pane,right_pane,bottom_bar}.rs` — NEW
- `crates/apohara-desktop-dioxus/assets/brand.css` — append `.apohara-grid` rules

### 1.2 State signals

| Signal | Tipo | Owner write | Readers | Status |
|---|---|---|---|---|
| `TASKS` | `HashMap<String,DagTask>` | dispatch_loop | KanbanBoard, SwarmCanvas, TaskBoard | exists (G2.C.1) |
| `ROSTER` | `Vec<ProviderEntry>` | startup probe + reconciler | ProviderRoster | exists (G2.C.1) |
| `PERMISSIONS` | `VecDeque<PermissionRequest>` | dispatch_loop | PermissionDialog | exists (G2.C.1) |
| `VIEW_MODE` | `ViewMode` (Swarm/Kanban/List) | ViewToggle | CenterPane | exists (G2.C.1) |
| `SSE_EVENTS` | `VecDeque<EventLog>` | dispatch_loop | TerminalPane | exists (G2.C.1) |
| `SELECTED_TASK` | `Option<String>` | center components click | CodeDiffPane, TerminalPane | NEW |
| `OBJECTIVE_INPUT` | `String` | ObjectivePane textarea (controlled) | ObjectivePane | NEW |
| `RUNNING_STATUS` | `RunStatus` (Idle/Dispatching/Verifying) | dispatch_loop | Statusline, HeroBanner compact | NEW |
| `TOAST_QUEUE` | `VecDeque<Toast>` | any coroutine | ToastContainer + toast_reaper | NEW |
| `CODE_DIFF` | `Option<Diff>` | dispatch_loop best result | CodeDiffPane | NEW (subsumed por `Toast` legacy? confirm — NEW dedicated) |

Files: `crates/apohara-desktop-dioxus/src/state/{selected_task,objective_input,running_status,toast_queue,code_diff}.rs` + register in `state/mod.rs`.

### 1.3 Coroutines (long-running effect owners)

| Coroutine | Behavior |
|---|---|
| `dispatch_loop` | Triggered on Run click. For each provider in ROSTER: pre-flight `safety::bash_compound::split_compound` → if compound enqueue PERMISSIONS + await arbitrator → spawn via `dispatch::api::CliDriver::dispatch_streaming` (new API) → pipe stdout via mpsc channel → push EventLog rows into SSE_EVENTS → on exit run `verification::quality_gates::run_all_gates` → best diff → CODE_DIFF → TASKS status updated |
| `permission_arbitrator` | Infinite loop pops PERMISSIONS head, opens dialog (internal signal), awaits user choice, calls `safety::permission_service::check`, returns decision via oneshot back to caller |
| `reconciler_tick` | Every 30s `dispatch::reconciler::run_reconciler_passes`; affected tasks → TOAST_QUEUE notification |
| `toast_reaper` | Every 5s sweep TOAST_QUEUE removing expired entries |
| `git_apply_handler` | On Accept in CodeDiffPane → `git apply` against working tree + success Toast; on failure → error Toast |

Files: `crates/apohara-desktop-dioxus/src/coroutines/{mod,dispatch_loop,permission_arbitrator,reconciler_tick,toast_reaper,git_apply_handler}.rs` — NEW.

### 1.4 Component → slot mapping

| Component | Slot | Behavior |
|---|---|---|
| HeroBanner | TopBar (compact mode when RUNNING_STATUS != Idle) | logo + tagline |
| ProviderRoster | TopBar | reads ROSTER; empty-state explica install providers |
| ViewToggle | TopBar | writes VIEW_MODE |
| ObjectivePane | LeftPane | controlled textarea bound OBJECTIVE_INPUT; Run dispara dispatch_loop; "Load SPEC" calls `spec::api::parse_plan_document` + `decomposer::api::decompose_spec` |
| SwarmCanvas | CenterPane (VIEW_MODE=Swarm) | reads TASKS; click → SELECTED_TASK |
| KanbanBoard | CenterPane (VIEW_MODE=Kanban) | reads TASKS; dnd llama `dispatch::api::state::run_transition` |
| TaskBoard | CenterPane (VIEW_MODE=List) | reads TASKS plain list |
| TerminalPane | CenterPane drawer (collapsible) | filtra SSE_EVENTS por SELECTED_TASK |
| CodeDiffPane | RightPane | reads CODE_DIFF; empty state when None; Accept dispara git_apply_handler |
| Statusline | BottomBar | reads ROSTER + RUNNING_STATUS + polls `token_accounting::api::current_totals()` |
| CommandPalette | Overlay | Cmd+K global key listener; 4 commands (Run / Load SPEC / Switch View / Clear) |
| PermissionDialog | Overlay | mounts when PERMISSIONS non-empty; Once/Session/Always buttons |
| ToastDialog | Overlay | renders TOAST_QUEUE |
| AgentStateDot | inside Kanban cards + Swarm nodes | color por DagTask.status |
| RunningBorder | inside active cards | animate when RunPhase=Running |
| PixelCanvas | TopBar mascot slot | decorativo, placeholder PNG |
| Button/Input/Card/Badge/Tooltip/Resizable | composición interna | primitives ubicuas |

### 1.5 Backend API surface

Las 8 crates exponen funciones puras async como `api.rs` (rename de `tauri_bridge.rs`). No Tauri, no IPC. Llamadas directas desde Dioxus components via `use_future`.

| Crate | API expuesta | Caller en Dioxus |
|---|---|---|
| apohara-dispatch | `CliDriver::dispatch_streaming(req, on_line) -> Result` (NEW), `reconciler::run_reconciler_passes`, `list_active_providers() -> Vec<ProviderEntry>` (NEW), `state::run_transition` | dispatch_loop, reconciler_tick, startup probe, KanbanBoard dnd |
| apohara-verification | `quality_gates::run_all_gates` | dispatch_loop post-exit |
| apohara-safety | `permission_service::check`, `bash_compound::split_compound` | permission_arbitrator, dispatch_loop pre-spawn |
| apohara-spec | `parse_plan_document`, `PlanStatusCache::get_fast` | ObjectivePane Load SPEC |
| apohara-decomposer | `decompose_spec` | tras Load SPEC popula TASKS |
| apohara-projector | `project_to_ui_cards`, `diff_patch` | KanbanBoard render + diff streaming |
| apohara-token-accounting | `current_totals() -> TokenTotals` (NEW) | Statusline poll |
| apohara-hooks, apohara-mcp, apohara-prompt-cache, apohara-context-primitives | (DEFERRED v1.1) | — |

---

## 2. Sprint 23 — 5 waves, ~4-5 días

### Wave 1 — Backend prep (3 paralelos, 1 día)

| Impl | Scope | Files |
|---|---|---|
| 1.A Strip Tauri | 8 crates: delete `#[cfg(feature='tauri')] #[tauri::command]` wrappers + `tauri = optional` dep + `[features]` block. Rename `tauri_bridge.rs` → `api.rs`. Update `pub use`. | `crates/apohara-{dispatch,verification,safety,spec,mcp,hooks,decomposer,projector}/{Cargo.toml,src/lib.rs,src/api.rs}` |
| 1.B APIs faltantes | `apohara_dispatch::api::list_active_providers() -> Vec<ProviderEntry>` (probe `which claude`, `which codex`, `which opencode`). `apohara_token_accounting::api::current_totals() -> TokenTotals`. | `crates/apohara-{dispatch,token-accounting}/src/api.rs` + tests |
| 1.C Streaming + TUI seam | `CliDriver::dispatch_streaming(req, on_line) -> Result` pipea stdout línea a línea via `tokio::mpsc::channel<String>(1024)`. Fix `apohara-tui/src/data.rs` para usar 1.B. | `crates/apohara-tui/src/data.rs`, `crates/apohara-dispatch/src/cli_driver.rs` |

Gate Wave 1: `cargo test --workspace` ≥1078/0 (post-strip), `cargo clippy --workspace -- -D warnings` clean.

### Wave 2 — Layout shell + state additions (1 implementer, 1 día)

| Task | Files |
|---|---|
| 5 nuevos signals | `src/state/{selected_task,objective_input,running_status,toast_queue,code_diff}.rs` + register in `state/mod.rs` |
| Layout shell | `src/layout/{mod,main_layout,top_bar,left_pane,center_pane,right_pane,bottom_bar}.rs` |
| CSS grid + responsive | `assets/brand.css` apéndice: `.apohara-grid` con `grid-template-areas: "top top top" "left center right" "bottom bottom bottom"` |
| Replace `src/app.rs` | mount `MainLayout` + 3 overlays (`CommandPalette`, `ToastContainer`, `PermissionDialog`) |

Smoke Wave 2: app launches, ves shell vacío (3 zones placeholder) + brand CSS aplicada.

### Wave 3 — Component wiring slots (4 paralelos, 1 día)

| Impl | Scope |
|---|---|
| 3.A TopBar + LeftPane | HeroBanner compact bound RUNNING_STATUS; ProviderRoster reads ROSTER; ViewToggle writes VIEW_MODE; ObjectivePane textarea bound OBJECTIVE_INPUT, Run button → coroutine signal |
| 3.B CenterPane swap | match VIEW_MODE → SwarmCanvas\|KanbanBoard\|TaskBoard; click handlers escriben SELECTED_TASK; KanbanBoard dnd → `dispatch::api::state::run_transition` |
| 3.C RightPane + TerminalPane drawer | CodeDiffPane reads CODE_DIFF (empty state when None); Accept → git_apply_handler signal; TerminalPane drawer (collapsible) filtra SSE_EVENTS por SELECTED_TASK |
| 3.D Overlays + BottomBar | CommandPalette global Cmd+K (via `dioxus_desktop::WindowEvent`, not HTML onkeydown) + 4 comandos; ToastContainer reads TOAST_QUEUE; PermissionDialog mounts when PERMISSIONS no vacío; Statusline polls token totals cada 1s |

Gate Wave 3: app launches, 19 components visibles (vacíos pero renderizados), ViewToggle swap funciona en vivo.

### Wave 4 — Coroutines + git apply (1 implementer, 1 día)

Implementar las 5 coroutines + git_apply_handler en `src/coroutines/`. dispatch_loop es la más compleja: pre-flight permission + spawn streaming + verification + best diff selection.

Smoke happy path Wave 4: type "hello world rust" → Run → ves 3 dots animando (3 providers) → 3 streams en TerminalPane drawers → diff aparece en CodeDiffPane.

### Wave 5 — Install + desktop entry + smoke (0.5 días)

- `scripts/install-arch.sh` → `cargo install --path crates/apohara-desktop-dioxus`
- `packaging/desktop/apohara-catalyst.desktop` → KDE/GNOME launcher entry
- `packaging/desktop/apohara-catalyst.png` (placeholder icon)
- README.md update con "Quick start Arch" section
- Manual smoke documented en `docs/superpowers/post-launch-smoke.md`

### Closure criteria Sprint 23

- `cargo test --workspace` ≥1078/0 (no regressions)
- `cargo clippy --workspace -- -D warnings` clean
- `cargo run -p apohara-desktop-dioxus` lanza ventana con 19 components visibles
- Happy path manual: type intent → Run → 3 CLIs dispatched → diff visible → Accept aplica
- `cargo install --path crates/apohara-desktop-dioxus` + entry `.desktop` → lanzable desde menú Arch

---

## 3. Riesgos + mitigación

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|---|
| R1 | Dioxus 0.7 GlobalSignal race entre coroutine writes + UI reads | Media | Medio (flicker, stale data) | `Signal::write_silent()` batched updates; tests con `tokio::time::sleep` para verificar consistency |
| R2 | `dispatch_streaming` mpsc backpressure si prompts gigantes | Media | Bajo (drop oldest line) | channel bounded 1024; on full `try_send` drop + warn log |
| R3 | Git worktree isolation no wired en dispatch_loop (crate `apohara-worktree` existe sin uso) | Alta | Alto (CLIs pisan workspace) | Wave 4 wire `apohara_worktree::WorktreeManager::checkout_for_task` antes de cada spawn; cleanup en exit |
| R4 | Permission gate timing — bash compound debe parsearse PRE-spawn | Baja | Alto (escape de scope) | dispatch_loop pre-flight: si tool-use detectado, parse `safety::bash_compound::split_compound`, abre dialog si compound > 1 leg |
| R5 | Cmd+K global key handler conflicto con webview shortcuts | Media | Bajo (no se abre cmd palette) | Bind via `dioxus_desktop::WindowEvent`, no `onkeydown` HTML |
| R6 | `cargo install` no crea symlink — Arch users esperan binary en PATH | Alta | Bajo (ergonomía) | `install-arch.sh` hace symlink explícito `~/.local/bin/`, avisa de PATH |
| R7 | Provider CLIs no instalados → ROSTER vacío | Alta | Medio (UX confusa) | Wave 3.A muestra empty-state explícita en ProviderRoster + comando "Install providers" en CommandPalette con docs |
| R8 | Parallel-write races en `components/mod.rs` durante Wave 3 (4 paralelos) | Alta | Bajo (merge noise) | Wave 2 pre-registra `pub mod layout;` + Wave 3 implementers solo añaden sus exports, no modifican slots ajenos |

---

## 4. OUT-OF-SCOPE explícito (no scope creep)

**Cross-platform / distribution** (per scope Q1):
- macOS / Windows builds
- Homebrew tap / Scoop manifest / AUR publish
- release.yml CI matrix run
- sha256 placeholders fill
- Apple notarization
- npm-style installer

**Features ROADMAP v1.1+**:
- `apohara-hooks` wire (hook events durante dispatch)
- `apohara-mcp` server bootstrap local (5 internal servers)
- `apohara-prompt-cache` HOT/WARM activation (cache flag stays OFF)
- `apohara-context-primitives` queueing admission gate
- Real chief mascot artwork (PixelCanvas placeholder hasta v1.1)
- Smart router (cost/latency-aware dispatch)
- Reactions / remote workers
- Cmd palette beyond 4 base commands
- Settings page
- Demo video tooling + comparative benchmarks
- ContextForge HTTP integration (GPU path)
- Apohara `auto` self-improvement loop (v0.2 stretch)

**UI polish deferred**:
- Drag-and-drop reorder en TaskBoard List view
- Multi-task simultaneous diffs (uno a la vez via SELECTED_TASK)
- Diff syntax highlight beyond syntect default
- Mobile / responsive layout
- Light theme (solo dark inicial)
- Keyboard shortcuts beyond Cmd+K
- Real-time SwarmCanvas pan/zoom

**Code cleanup deferred**:
- `crates/*/bindings/*.ts` (ts-rs artifacts sin consumer, harmless)
- `crates/apohara-indexer/tests/fixtures/*.ts` (test data, no tocar)
- apohara-tui ratatui binary (separate binary, no obstruye)

**Validation deferred**:
- Stress test 100 dispatches concurrentes
- Memory leak validation con valgrind
- Long-running stability test 24h+

---

## 5. Acceptance criteria final Sprint 23

✅ Usuario en Arch ejecuta `apohara-catalyst` desde launcher KDE/Plasma
✅ Type "implementa X" → click Run → ve 3 providers dispatched en TerminalPane drawers
✅ Diff aparece en CodeDiffPane → click Accept → diff aplicado al working tree
✅ Cmd+K abre command palette con 4 acciones (Run / Load SPEC / Switch View / Clear)
✅ Switch View Kanban/Swarm/List funciona en vivo
✅ Statusline muestra token totals + active provider
✅ PermissionDialog se abre cuando bash compound detectado
✅ Reconciler tick cada 30s muestra Toast si stalled tasks
✅ `cargo install --path crates/apohara-desktop-dioxus` + `.desktop` entry → lanzable desde menú

---

## 6. Files inventory

**NEW** (Sprint 23):
- `crates/apohara-desktop-dioxus/src/layout/{mod,main_layout,top_bar,left_pane,center_pane,right_pane,bottom_bar}.rs`
- `crates/apohara-desktop-dioxus/src/coroutines/{mod,dispatch_loop,permission_arbitrator,reconciler_tick,toast_reaper,git_apply_handler}.rs`
- `crates/apohara-desktop-dioxus/src/state/{selected_task,objective_input,running_status,toast_queue,code_diff}.rs`
- `crates/apohara-dispatch/src/api.rs` (renamed from `tauri_bridge.rs`, also adds `dispatch_streaming` + `list_active_providers`)
- `crates/apohara-token-accounting/src/api.rs` (NEW with `current_totals`)
- `crates/apohara-{verification,safety,spec,mcp,hooks,decomposer,projector}/src/api.rs` (renamed)
- `scripts/install-arch.sh`
- `packaging/desktop/apohara-catalyst.desktop`
- `packaging/desktop/apohara-catalyst.png` (placeholder)
- `docs/superpowers/post-launch-smoke.md`

**MODIFIED**:
- `crates/apohara-desktop-dioxus/src/app.rs` — replace, mount MainLayout + overlays
- `crates/apohara-desktop-dioxus/src/lib.rs` — register layout + coroutines + new state modules
- `crates/apohara-desktop-dioxus/src/state/mod.rs` — register 5 new signals
- `crates/apohara-desktop-dioxus/src/components/mod.rs` — possibly tweak re-exports
- `crates/apohara-desktop-dioxus/assets/brand.css` — append `.apohara-grid` rules
- `crates/apohara-desktop-dioxus/Cargo.toml` — add `apohara-{8 crates}` path deps (sin `features = ["tauri"]`)
- `crates/apohara-{8 crates}/Cargo.toml` — drop `tauri` optional dep + `[features]` block
- `crates/apohara-{8 crates}/src/lib.rs` — update `pub use` to point at `api` module
- `crates/apohara-tui/src/data.rs` — wire to new 1.B APIs
- `README.md` — add "Quick start Arch" section

**DELETED** (post Wave 1 strip):
- 8 archivos `crates/apohara-*/src/tauri_bridge.rs` (renamed → `api.rs`, así técnicamente git rename)

---

## 7. Versioning

Sprint 23 cierre → `v1.0.0-rc.5` "Integrated personal Arch desktop" (defensible: ventana lanzable + 19 components live + happy path end-to-end + install ergonómico). Cross-platform + publish gates siguen GATED para Pablo per Phase 4 G4.C.

---

*Fin del design Sprint 23 personal integration. Plan implementacional via `superpowers:writing-plans` next.*
