# Plan: Apohara Catalyst v1.0 — Personal Integration (Sprint 23)

> **Spec (SSoT):** `docs/superpowers/specs/2026-05-24-apohara-catalyst-v1-integration-design.md`
> **Branch:** `feat/apohara-catalyst` (continúa, no se crea rama nueva)
> **Cierre →** `v1.0.0-rc.5` "Integrated personal Arch desktop"

---

## Goal

Convertir el bake-off Dioxus actual (solo monta `HeroBanner`) en una app v1.0 lanzable desde
el escritorio Arch de Pablo, integrada end-to-end con los 8 backend crates Rust-native
post-Phase 1-3. Sin scope de distribución pública (Arch only, `cargo install --path`).

## Architecture (resumen — detalle en spec §1)

- **Layout shell:** CSS grid 3-pane (`grid-template-areas: "top top top" "left center right" "bottom bottom bottom"`) + 3 overlays raíz (CommandPalette / ToastContainer / PermissionDialog). Slot composition: cada slot swap sin tocar el shell.
- **State:** 5 `GlobalSignal` nuevos (`SELECTED_TASK`, `OBJECTIVE_INPUT`, `RUNNING_STATUS`, `TOAST_QUEUE`, `CODE_DIFF`) suman a los 6 existentes (G2.C.1).
- **Coroutines:** 5 effect-owners (`dispatch_loop`, `permission_arbitrator`, `reconciler_tick`, `toast_reaper`, `git_apply_handler`).
- **Backend API:** las 8 `tauri_bridge.rs` → `api.rs` (sin Tauri, sin IPC); Dioxus llama directo via `use_future`.

## Tech stack

Rust 1.95 · Dioxus 0.7 (`dioxus_desktop`) · tokio · `dioxus_ssr::render_element` para tests de componentes · `git apply` (std `Command`) para CodeDiff Accept.

---

## Convenciones de ejecución (aplican a TODAS las tasks)

- **Atómica:** cada `- [ ]` es 2-5 min, un archivo/concern, verificable sola por un agente sin este contexto.
- **TDD donde aplica:** componente/función con lógica → failing test primero (patrón `dioxus_ssr::render_element(rsx!{...})` para componentes; `#[tokio::test]` para async backend). Shells/CSS/scripts → `cargo build` o smoke.
- **Commit por task:** conventional commit `tipo(scope): descripción (W<id>)`. Un commit por task. NUNCA `git add -A`, NUNCA `--amend`, NUNCA `--no-verify`.
- **Hard rules vigentes:** NUNCA `git push`, NUNCA commit a `main`, NUNCA emojis en código, NUNCA OAuth providers. Código/comments en inglés.
- **Verify obligatorio** antes de marcar `[x]`: correr el comando `verify:` de la task y confirmar verde.
- **Paralelización (subagent-driven):** cada Wave indica grupos paralelos. RALPH AFK las corre secuencial en el orden listado (el orden ya respeta dependencias). Max 4 subagents Opus 4.7 por wave (Pablo workflow rule).

---

## Shapes nuevos (fijados — el implementer NO los re-diseña)

```rust
// crates/apohara-token-accounting/src/api.rs  (W1.B.2)
pub struct ProviderTotals { pub provider_id: String, pub tokens_in: u64, pub tokens_out: u64, pub cost_usd: f64 }
pub struct TokenTotals { pub total_in: u64, pub total_out: u64, pub total_cost_usd: f64, pub per_provider: Vec<ProviderTotals> }
pub fn current_totals() -> TokenTotals;  // agrega TokenCounter::total_for_provider sobre el active roster

// crates/apohara-dispatch/src/api.rs  (W1.B.1)
pub struct ActiveProvider { pub id: String, pub binary_path: String, pub available: bool }
pub fn list_active_providers() -> Vec<ActiveProvider>;  // probe `which {claude,codex,opencode}`; sin dep de UI

// crates/apohara-dispatch/src/cli_driver.rs  (W1.C.1)
// on_line: callback por cada línea de stdout; canal interno tokio::mpsc bounded(1024), try_send drop-oldest en full (R2)
pub async fn dispatch_streaming(req: DispatchRequest, on_line: impl FnMut(String) + Send + 'static) -> Result<DispatchOutcome, CliDriverError>;

// crates/apohara-desktop-dioxus/src/state/running_status.rs  (W2.1)
pub enum RunStatus { #[default] Idle, Dispatching, Verifying }

// crates/apohara-desktop-dioxus/src/state/code_diff.rs  (W2.5)
pub struct Diff { pub unified: String, pub files_changed: Vec<String>, pub provider_winner: String }

// crates/apohara-desktop-dioxus/src/state/toast_queue.rs  (W2.4)
pub enum ToastLevel { Info, Success, Warning, Error }
pub struct Toast { pub id: String, pub level: ToastLevel, pub message: String, pub created_at: std::time::Instant, pub ttl_ms: u64 }
```

> **ProviderEntry** (UI) vive en `state/roster.rs` (G2.C.1). El startup probe (W3.A.2) mapea `ActiveProvider` → `ProviderEntry`; el implementer lee `roster.rs` para el shape destino. Esto evita dep circular dispatch→UI.

---

## Wave 1 — Backend prep · 3 grupos paralelos

> **Paralelizable:** Grupo A (W1.A.dispatch primero, luego W1.A.{resto} ‖) · Grupo B (W1.B.1 tras W1.A.dispatch · W1.B.2 ‖ libre) · Grupo C (W1.C.1 ‖ libre · W1.C.2 tras W1.B).
> **Dependencia clave:** `W1.A.dispatch` debe ir ANTES de `W1.B.1` (api.rs debe existir para añadirle `list_active_providers`).

### Grupo A — Strip Tauri (8 crates, patrón idéntico)

Patrón por crate (confirmado contra `apohara-dispatch/src/tauri_bridge.rs`): (1) `git mv src/tauri_bridge.rs src/api.rs`; (2) en `api.rs` borrar SOLO el bloque `#[cfg(feature = "tauri")] #[tauri::command] pub async fn <wrapper>(...) { <inner>(...).await }` — mantener `is_enabled` + `*_inner` + `#[cfg(test)] mod tests`; (3) en `Cargo.toml` borrar la línea `tauri = { version = "2", optional = true }` y el bloque `[features]`; (4) en `src/lib.rs` cambiar `pub mod tauri_bridge;` → `pub mod api;` (y cualquier `pub use tauri_bridge::*` → `pub use api::*`).

- [x] W1.A.1: Strip Tauri en `crates/apohara-dispatch` (rename tauri_bridge.rs→api.rs, borrar wrapper `rust_dispatch`, borrar dep+features, lib.rs `pub mod api`) — verify: `cargo build -p apohara-dispatch && cargo test -p apohara-dispatch`
- [x] W1.A.2: Strip Tauri en `crates/apohara-verification` (mismo patrón) — verify: `cargo build -p apohara-verification && cargo test -p apohara-verification`
- [x] W1.A.3: Strip Tauri en `crates/apohara-safety` (mismo patrón) — verify: `cargo build -p apohara-safety && cargo test -p apohara-safety`
- [x] W1.A.4: Strip Tauri en `crates/apohara-spec` (mismo patrón) — verify: `cargo build -p apohara-spec && cargo test -p apohara-spec`
- [x] W1.A.5: Strip Tauri en `crates/apohara-mcp` (mismo patrón) — verify: `cargo build -p apohara-mcp && cargo test -p apohara-mcp`
- [x] W1.A.6: Strip Tauri en `crates/apohara-hooks` (mismo patrón) — verify: `cargo build -p apohara-hooks && cargo test -p apohara-hooks`
- [x] W1.A.7: Strip Tauri en `crates/apohara-decomposer` (mismo patrón) — verify: `cargo build -p apohara-decomposer && cargo test -p apohara-decomposer`
- [x] W1.A.8: Strip Tauri en `crates/apohara-projector` (mismo patrón) — verify: `cargo build -p apohara-projector && cargo test -p apohara-projector`

### Grupo B — APIs faltantes

- [x] W1.B.1: En `crates/apohara-dispatch/src/api.rs` añadir `ActiveProvider` + `list_active_providers()` que probea `which claude|codex|opencode` (usar `std::process::Command::new("which")` o `PATH` lookup). Añadir `#[tokio::test]`/`#[test]` que assert: 3 entries con ids esperados, `available` refleja presencia real (no panic si falta el binario). — verify: `cargo test -p apohara-dispatch api::`
- [x] W1.B.2: Crear `crates/apohara-token-accounting/src/api.rs` con `ProviderTotals` + `TokenTotals` + `current_totals()` (agrega `TokenCounter::total_for_provider` sobre `["claude-code-cli","codex-cli","opencode-go"]`). Registrar `pub mod api;` en `src/lib.rs`. Test: contador vacío → totals en cero, 3 `per_provider` rows. — verify: `cargo test -p apohara-token-accounting`

### Grupo C — Streaming + TUI seam

- [x] W1.C.1: En `crates/apohara-dispatch/src/cli_driver.rs` añadir `dispatch_streaming(req, on_line)` — spawnea el CLI vía el path sanitizado existente, lee stdout línea-a-línea por `tokio::mpsc::channel::<String>(1024)`, invoca `on_line` por cada línea, `try_send` drop-oldest + `tracing::warn` en canal lleno (R2). Reusa `sanitizeEnv`-equivalente (`build_sanitized_env`) y `runSerialized`/queue per-binary (incident: per-binary lock). Test `#[tokio::test]` con `/bin/echo` (NO `bash -c`, incident PTY): assert on_line recibió la línea. — verify: `cargo test -p apohara-dispatch cli_driver`
- [x] W1.C.2: Re-wire `crates/apohara-tui/src/data.rs`: `active_agents()` lee de `apohara_dispatch::api::list_active_providers()`; `cost_rows()` lee de `apohara_token_accounting::api::current_totals().per_provider`. Borrar el `TODO(catalyst-tracker)` del module doc. Mantener verdes los 3 tests existentes (ajustar asserts si el shape cambió). — verify: `cargo test -p apohara-tui`

### Gate Wave 1

- [x] W1.GATE: Workspace verde post-strip — verify: `cargo test --workspace` (≥1078 passed / 0 failed) `&&` `cargo clippy --workspace --all-targets -- -D warnings`

---

## Wave 2 — Layout shell + state · 1 implementer (secuencial)

> **Dependencia:** toda la Wave 2 va DESPUÉS de W1.GATE. Tasks internas en orden (signals → shell → CSS → app.rs → smoke).

### 2.1 — Nuevos signals (patrón `state/tasks.rs`: `pub static X: GlobalSignal<T> = Signal::global(...)` + helpers + tipos locales)

- [x] W2.1: Crear `src/state/selected_task.rs` con `SELECTED_TASK: GlobalSignal<Option<String>>` + `select(id)`/`clear()`/`selected()` helpers. Registrar `pub mod selected_task;` en `state/mod.rs`. Test SSR/unit del set/clear en `state_test.rs`. — verify: `cargo test -p apohara-desktop-dioxus state`
- [x] W2.2: Crear `src/state/objective_input.rs` con `OBJECTIVE_INPUT: GlobalSignal<String>` + `set(s)`/`get()`. Registrar en `state/mod.rs`. Test. — verify: `cargo test -p apohara-desktop-dioxus state`
- [x] W2.3: Crear `src/state/running_status.rs` con `enum RunStatus { Idle, Dispatching, Verifying }` (Default=Idle) + `RUNNING_STATUS: GlobalSignal<RunStatus>` + setters. Registrar. Test. — verify: `cargo test -p apohara-desktop-dioxus state`
- [x] W2.4: Crear `src/state/toast_queue.rs` con `ToastLevel` + `Toast` (shape fijado arriba) + `TOAST_QUEUE: GlobalSignal<VecDeque<Toast>>` + `push(toast)`/`remove(id)`/`sweep_expired()`. Registrar. Test push+sweep. — verify: `cargo test -p apohara-desktop-dioxus state`
- [x] W2.5: Crear `src/state/code_diff.rs` con `Diff { unified, files_changed, provider_winner }` + `CODE_DIFF: GlobalSignal<Option<Diff>>` + `set(diff)`/`clear()`. Registrar. Test. — verify: `cargo test -p apohara-desktop-dioxus state`

### 2.2 — Layout shell (7 files como shells con `grid-area`, sin lógica)

- [x] W2.6: Crear `src/layout/{mod,main_layout,top_bar,left_pane,center_pane,right_pane,bottom_bar}.rs`. Cada uno un `#[component]` que renderiza un `div` con la `grid-area` correcta y un placeholder text. `main_layout.rs` compone los 6 dentro de `div.apohara-grid`. `mod.rs` re-exporta. Registrar `pub mod layout;` en `src/lib.rs`. SSR test de `MainLayout` (render no-panic + contiene las 6 zonas). — verify: `cargo test -p apohara-desktop-dioxus layout`

### 2.3 — CSS grid + app.rs

- [x] W2.7: Append a `assets/brand.css` el bloque `.apohara-grid { display:grid; grid-template-areas:"top top top" "left center right" "bottom bottom bottom"; grid-template-rows:auto 1fr auto; grid-template-columns: 280px 1fr 360px; height:100vh; }` + reglas `.apohara-grid > .top/.left/.center/.right/.bottom { grid-area: ...; }`. — verify: `cargo build -p apohara-desktop-dioxus`
- [x] W2.8: Replace `src/app.rs`: montar `style{BRAND_CSS}` + `layout::MainLayout {}` + los 3 overlays (`CommandPalette`, `ToastContainer`, `PermissionDialog`) como mounts (placeholders por ahora, se cablean en W3.D). SSR test del `App` (no-panic, contiene `apohara-grid`). — verify: `cargo test -p apohara-desktop-dioxus app`
- [x] W2.SMOKE: App levanta con shell vacío (3 zonas placeholder) + brand CSS aplicada. — verify (manual): `cargo run -p apohara-desktop-dioxus` → ventana muestra grid 3-pane vacío

---

## Wave 3 — Component wiring slots · 4 grupos paralelos

> **Dependencia:** toda la Wave 3 va DESPUÉS de W2.SMOKE. Los 4 grupos (3.A/3.B/3.C/3.D) son independientes en archivos (cada uno toca sus componentes + su slot). R8: NINGÚN grupo modifica el slot de otro; `layout/*` ya está pre-creado en W2, los implementers solo cablean el contenido de su pane.

### Grupo 3.A — TopBar + LeftPane

- [x] W3.A.1: Cablear `HeroBanner` en `top_bar.rs` modo compact (props derivados de `RUNNING_STATUS != Idle`). SSR test: compact cuando Dispatching. — verify: `cargo test -p apohara-desktop-dioxus`
- [x] W3.A.2: Cablear `ProviderRoster` (components/layout/provider_roster.rs) leyendo `ROSTER`; startup probe `use_future` que llama `list_active_providers()` y mapea `ActiveProvider`→`ProviderEntry` (lee shape en `state/roster.rs`). Empty-state: card "No providers found on PATH" + Button "How to install" que dispara CommandPalette. SSR test: roster vacío → empty-state visible. — verify: `cargo test -p apohara-desktop-dioxus`
- [x] W3.A.3: Cablear `ViewToggle` en `top_bar.rs` escribiendo `VIEW_MODE`. SSR test: click escribe el signal. — verify: `cargo test -p apohara-desktop-dioxus`
- [x] W3.A.4: Cablear `ObjectivePane` (left_pane.rs): textarea controlada bound a `OBJECTIVE_INPUT`; Run button setea `RUNNING_STATUS=Dispatching` + dispara coroutine signal (placeholder hasta W4); "Load SPEC" llama `spec::api::parse_plan_document` + `decomposer::api::decompose_spec`. SSR test: typing actualiza OBJECTIVE_INPUT. — verify: `cargo test -p apohara-desktop-dioxus`

### Grupo 3.B — CenterPane swap

- [x] W3.B.1: En `center_pane.rs` `match VIEW_MODE` → render `SwarmCanvas | KanbanBoard | TaskBoard`. SSR test: cada ViewMode monta el componente correcto. — verify: `cargo test -p apohara-desktop-dioxus`
- [x] W3.B.2: `SwarmCanvas` (components/hard/swarm_canvas.rs): nodos leen `TASKS`; click en nodo → `SELECTED_TASK`. SSR test: click setea SELECTED_TASK. — verify: `cargo test -p apohara-desktop-dioxus`
- [x] W3.B.3: `KanbanBoard` (components/composition/kanban_board.rs): lanes leen `TASKS`; dnd entre lanes llama `dispatch::api::state::run_transition`. SSR test: render 4 lanes con tasks agrupadas por status. — verify: `cargo test -p apohara-desktop-dioxus`
- [x] W3.B.4: `TaskBoard` (components/layout/task_board.rs): lista plana leyendo `TASKS`; click row → `SELECTED_TASK`. SSR test. — verify: `cargo test -p apohara-desktop-dioxus`

### Grupo 3.C — RightPane + TerminalPane drawer

- [ ] W3.C.1: `CodeDiffPane` (components/hard/code_diff_pane.rs) en `right_pane.rs`: lee `CODE_DIFF`; empty-state cuando `None` ("No diff yet — run a goal"); cuando `Some`, render unified diff + files_changed + provider_winner badge. SSR test: None→empty, Some→diff. — verify: `cargo test -p apohara-desktop-dioxus`
- [ ] W3.C.2: En `CodeDiffPane` botones Accept/Reject: Accept dispara `git_apply_handler` (coroutine signal, placeholder hasta W4); Reject → `CODE_DIFF.clear()`. SSR test: Reject limpia el signal. — verify: `cargo test -p apohara-desktop-dioxus`
- [ ] W3.C.3: `TerminalPane` (components/hard/terminal_pane.rs) como drawer en `center_pane.rs` bottom edge: collapsible (header click toggle, default closed), filtra `SSE_EVENTS` por `SELECTED_TASK`. SSR test: filtrado por task seleccionada. — verify: `cargo test -p apohara-desktop-dioxus`

### Grupo 3.D — Overlays + BottomBar

- [ ] W3.D.1: `CommandPalette` (components/polish/command_palette.rs): listener global Cmd+K via `dioxus_desktop` WindowEvent (NO `onkeydown` HTML — R5); 4 comandos (Run / Load SPEC / Switch View / Clear) + comando "Install providers" (linka docs). SSR test: render de los 5 comandos. — verify: `cargo test -p apohara-desktop-dioxus`
- [ ] W3.D.2: `ToastContainer` (envuelve components/dialogs/toast_dialog.rs + polish/toast.rs): renderiza `TOAST_QUEUE`. SSR test: 2 toasts → 2 nodos. — verify: `cargo test -p apohara-desktop-dioxus`
- [ ] W3.D.3: `PermissionDialog` (components/dialogs/permission_dialog.rs): monta cuando `PERMISSIONS` no vacío; botones Once/Session/Always. SSR test: permiso encolado → dialog visible. — verify: `cargo test -p apohara-desktop-dioxus`
- [ ] W3.D.4: `Statusline` (components/composition/statusline.rs) en `bottom_bar.rs`: `use_future` poll cada 1s de `token_accounting::api::current_totals()`; muestra active provider + token totals + clock. SSR test: render con totals mock. — verify: `cargo test -p apohara-desktop-dioxus`

### Gate Wave 3

- [ ] W3.GATE: App levanta, 19 components visibles (vacíos pero renderizados), ViewToggle swap funciona en vivo. — verify: `cargo test -p apohara-desktop-dioxus` `&&` (manual) `cargo run -p apohara-desktop-dioxus`

---

## Wave 4 — Coroutines + git apply · 1 implementer (secuencial)

> **Dependencia:** DESPUÉS de W3.GATE. Crear `src/coroutines/{mod,...}.rs`, registrar `pub mod coroutines;` en `lib.rs`, montar los coroutine owners en `App` (W2.8 dejó los signals/placeholders listos).

- [ ] W4.1: Crear `src/coroutines/mod.rs` + montar `use_coroutine` para los 5 owners en `App` (handles guardados en signals para que los botones disparen). Smoke build. — verify: `cargo build -p apohara-desktop-dioxus`
- [ ] W4.2: `coroutines/permission_arbitrator.rs`: loop infinito pop `PERMISSIONS` head → abre dialog (signal interno) → await user choice → `safety::api::permission_service::check` → devuelve decisión por `oneshot`. Test del flujo decisión. — verify: `cargo test -p apohara-desktop-dioxus coroutines`
- [ ] W4.3: `coroutines/dispatch_loop.rs` PARTE 1 (spawn+stream): on Run, por cada provider en `ROSTER` → pre-flight `safety::api::bash_compound::split_compound` (si compound >1 leg → enqueue `PERMISSIONS` + await arbitrator, R4) → `apohara_worktree::WorktreeManager::checkout_for_task` ANTES del spawn (R3) → `dispatch::api::CliDriver::dispatch_streaming` → push `EventLog` rows en `SSE_EVENTS`; cleanup worktree en exit. Test con `/bin/echo` provider. — verify: `cargo test -p apohara-desktop-dioxus coroutines`
- [ ] W4.4: `coroutines/dispatch_loop.rs` PARTE 2 (verify+diff): on exit → `verification::api::quality_gates::run_all_gates` → best result → construir `Diff` → `CODE_DIFF.set` → `TASKS` status updated → `RUNNING_STATUS=Idle`. Test: outcome → CODE_DIFF poblado. — verify: `cargo test -p apohara-desktop-dioxus coroutines`
- [ ] W4.5: `coroutines/reconciler_tick.rs`: cada 30s `dispatch::api::reconciler::run_reconciler_passes`; tasks afectadas → `TOAST_QUEUE` notification. Test del tick (usar `tokio::time::pause`). — verify: `cargo test -p apohara-desktop-dioxus coroutines`
- [ ] W4.6: `coroutines/toast_reaper.rs`: cada 5s `TOAST_QUEUE.sweep_expired()` (basado en `created_at + ttl_ms`). Test: toast expirado se remueve. — verify: `cargo test -p apohara-desktop-dioxus coroutines`
- [ ] W4.7: `coroutines/git_apply_handler.rs`: on Accept → `git apply` (std `Command`) del `CODE_DIFF.unified` contra working tree → success `Toast`; on failure → error `Toast`. Test: diff inválido → error toast (sin tocar el repo real, usar tempdir). — verify: `cargo test -p apohara-desktop-dioxus coroutines`
- [ ] W4.SMOKE: Happy path — type "hello world rust" → Run → 3 dots animando (3 providers) → 3 streams en TerminalPane drawers → diff en CodeDiffPane. — verify (manual): `cargo run -p apohara-desktop-dioxus`

---

## Wave 5 — Install + desktop entry + smoke · 0.5 día

> **Dependencia:** DESPUÉS de W4.SMOKE.

- [ ] W5.1: Crear `scripts/install-arch.sh`: `cargo install --path crates/apohara-desktop-dioxus` + symlink explícito a `~/.local/bin/` + aviso de PATH (R6). `chmod +x`. — verify: `bash -n scripts/install-arch.sh` (syntax) `&&` `shellcheck scripts/install-arch.sh`
- [ ] W5.2: Crear `packaging/desktop/apohara-catalyst.desktop` (entry KDE/GNOME: Name, Exec=apohara-catalyst, Icon, Categories=Development;). — verify: `desktop-file-validate packaging/desktop/apohara-catalyst.desktop` (o `test -f` si la herramienta no está)
- [ ] W5.3: Añadir `packaging/desktop/apohara-catalyst.png` (placeholder icon 256x256). — verify: `test -f packaging/desktop/apohara-catalyst.png`
- [ ] W5.4: README.md: sección "Quick start (Arch)" con `bash scripts/install-arch.sh` + cómo lanzar desde menú KDE. — verify: `grep -q "Quick start" README.md`
- [ ] W5.5: Crear `docs/superpowers/post-launch-smoke.md` documentando el smoke manual (los 9 acceptance criteria del spec §5 como checklist). — verify: `test -f docs/superpowers/post-launch-smoke.md`

---

## Verificación final (Closure criteria Sprint 23 — spec §161)

- [ ] CLOSE.1: `cargo test --workspace` ≥1078 passed / 0 failed (no regressions) — verify: `cargo test --workspace`
- [ ] CLOSE.2: Clippy limpio — verify: `cargo clippy --workspace --all-targets -- -D warnings`
- [ ] CLOSE.3: Ventana con 19 components visibles — verify (manual): `cargo run -p apohara-desktop-dioxus`
- [ ] CLOSE.4: Happy path manual: type intent → Run → 3 CLIs dispatched → diff visible → Accept aplica al working tree — verify (manual): seguir `docs/superpowers/post-launch-smoke.md`
- [ ] CLOSE.5: Install ergonómico: `cargo install --path crates/apohara-desktop-dioxus` + `.desktop` entry lanzable desde menú KDE — verify (manual): instalar + lanzar desde Plasma
- [ ] CLOSE.6: Bump versión a `v1.0.0-rc.5` "Integrated personal Arch desktop" (workspace `Cargo.toml`). NO tag, NO push (gated para Pablo per Phase 4 G4.C). — verify: `grep -q "1.0.0-rc.5" Cargo.toml`

---

## Out-of-scope (NO scope creep — spec §4)

Cross-platform/distribution (macOS/Win, AUR/Homebrew/Scoop, release.yml CI, notarization), features v1.1+ (`apohara-hooks` wire, `apohara-mcp` bootstrap, `apohara-prompt-cache` activation, `apohara-context-primitives`, smart router, real mascot art, settings page, demo video, ContextForge GPU path), UI polish (dnd reorder, multi-diff, light theme, mobile), validation (stress/valgrind/24h). Ver spec §4 para la lista completa.

---

## Self-review (writing-plans skill)

- [x] Cada `- [ ]` es atómica y tiene comando de verificación — sí (57 tasks ejecutables: 52 con `verify:` auto-verificable + 5 `verify (manual):` smoke de ventana por naturaleza)
- [x] Sin ambigüedades ni placeholders — shapes nuevos fijados arriba; firmas de las 3 APIs nuevas explícitas; patrón de strip confirmado contra el código real
- [x] El orden refleja dependencias reales — W1.A.dispatch→W1.B.1; W1.GATE→W2→W2.SMOKE→W3→W3.GATE→W4→W4.SMOKE→W5; deps cross-grupo anotadas por wave
- [x] Cobertura del spec — §1 (arquitectura)→W2+W3+W4; §1.5 (APIs)→W1.B+W1.C; §2 (5 waves)→W1-W5; §3 riesgos R1-R8 mapeados a tasks (R2→W1.C.1, R3→W4.3, R4→W4.3, R5→W3.D.1, R6→W5.1, R7→W3.A.2, R8→W3 nota); §5 acceptance→CLOSE.1-6; §6 inventory→todas las tasks; §7 versioning→CLOSE.6

---

## Ejecución

Tras aprobar este plan → `superpowers:subagent-driven-development` (recomendado, max 4 paralelos por wave) **o** `apohara ralph start docs/superpowers/plans/2026-05-24-apohara-catalyst-v1-sprint-23.md` (AFK con gate `stop`).
Ejecutores: agente `implementer` (una task aislada) o `ralph` (plan entero AFK) — ver `subagent-dispatch`.
