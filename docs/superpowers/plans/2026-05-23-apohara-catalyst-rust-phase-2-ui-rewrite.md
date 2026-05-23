# Apohara Catalyst Rust-Native Phase 2 — UI Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reescribir 100% del UI React/TS Sprint 9 (~14 components + ~30 primitives) a Dioxus rsx! Rust-native. Migrar `packages/desktop/src/*` y `packages/tui/*` → Rust. Cierre Phase 2 borra todo TS source del repo (single commit). Tauri 2 shell se preserva (ya es Rust).

**Architecture:** 4 sprints. S16 es bake-off Dioxus (decision gate por si tenemos que pivotar a Slint). S17 Wave A: brand primitives + 4 components fáciles paralelizados. S18 Wave B: composition + signals state migration. S19 hard components (alacritty terminal, syntect viewer, custom DAG) + delete TS source. Branch destino: `feat/apohara-catalyst` (continúa desde Phase 1 cierre).

**Tech Stack:** Dioxus 0.5+ (rsx! + signals + GlobalSignal) + dioxus-desktop (Tauri integration) + Tauri 2 (preservado) + alacritty_terminal (terminal embed) + syntect (syntax highlighting) + petgraph (DAG layout) + fuzzy-matcher (cmd palette). Tests: dioxus-test (component renders) + cargo test. Visual smoke: tauri-driver + WebDriver donde aplica.

---

## Estructura Phase 2

### 4 grupos / 4 sprints

| Grupo | Sprint | Scope | Esfuerzo | Implementers |
|---|---|---|---:|---|
| **G2.A** | S16 | Dioxus bake-off + decision gate + 1 component live | 5d | 1 |
| **G2.B** | S17 | Wave A — brand primitives + 4 easy components | 7d | 4 paralelos |
| **G2.C** | S18 | Wave B — polish components + signals state cutover | 8d | 3 paralelos |
| **G2.D** | S19 | Hard components + delete TS source + Phase 2 cierre | 5d | 3 paralelos |

**Total**: ~25 días con paralelización donde paths son disjuntos.

---

## Setup (antes de Wave 1)

- [ ] **Setup 1: Verificar Phase 1 cierre verde**

```bash
git status
# Esperado: On branch feat/apohara-catalyst, Phase 1 cierre commiteado.
git log --oneline -3
# Esperado: último commit es "chore(sprint): Phase 1 Rust core ports COMPLETE".
```

Run: `cargo test --workspace 2>&1 | tail -5`
Expected: all green.

Run: `./target/release/apohara doctor`
Expected: exits 0 or 2 (warnings ok).

- [ ] **Setup 2: Crear tracking doc para Dioxus migration**

Create `docs/superpowers/rust-native/dioxus-migration.md`:

```markdown
# Apohara Dioxus UI Migration Tracker

## Status por component (Sprint 9 → Dioxus)

| Component | Effort | Sprint | Status |
|---|---|---|---|
| Button primitives | Fácil | S17 | TODO |
| Input/Card primitives | Fácil | S17 | TODO |
| HeroBanner | Fácil | S17 | TODO |
| AgentStateDot | Fácil | S17 | TODO |
| RunningBorder | Fácil | S17 | TODO |
| TaskBoard | Media | S17 | TODO |
| ProviderRoster | Media | S17 | TODO |
| PermissionDialog | Media | S17 | TODO |
| KanbanBoard (HTML5 dnd) | Media | S18 | TODO |
| CommandPalette (cmdk) | Media | S18 | TODO |
| Sonner toasts | Fácil | S18 | TODO |
| TooltipProvider | Fácil | S18 | TODO |
| Resizable panels | Media | S18 | TODO |
| ViewToggle | Fácil | S18 | TODO |
| Statusline | Fácil | S18 | TODO |
| ObjectivePane | Fácil | S18 | TODO |
| TerminalPane | Duro | S19 | TODO |
| CodeDiffPane | Duro | S19 | TODO |
| SwarmCanvas DAG | Duro | S19 | TODO |

## Jotai atoms → Dioxus signals migration

| Atom (TS) | Signal (Rust) | Sprint |
|---|---|---|
| tasksAtom | TASKS GlobalSignal | S18 |
| rosterAtom | ROSTER GlobalSignal | S18 |
| permissionsAtom | PERMISSIONS GlobalSignal | S18 |
| viewModeAtom | VIEW_MODE GlobalSignal | S18 |
| sseEventsAtom | SSE_EVENTS GlobalSignal | S18 |
```

```bash
git add docs/superpowers/rust-native/dioxus-migration.md
git commit -m "docs: Dioxus UI migration tracker (Phase 2 setup)"
```

---

## G2.A — Sprint 16 Dioxus bake-off (5d, 1 implementer)

**Outcome esperado**: `apohara-desktop-dioxus` crate (binary) boota con Tauri 2 + Dioxus rendering. 1 component brand (HeroBanner) live + hot reload <500ms. Decision gate al cierre: continuar con Dioxus o pivot a Slint.

### Task G2.A.1: Crear crate skeleton `apohara-desktop-dioxus`

**Files:**
- Create: `crates/apohara-desktop-dioxus/Cargo.toml`
- Create: `crates/apohara-desktop-dioxus/src/main.rs`
- Create: `crates/apohara-desktop-dioxus/Dioxus.toml`
- Modify: `Cargo.toml` (workspace.members)

- [ ] **Step 1: Crear Cargo.toml**

```toml
[package]
name = "apohara-desktop-dioxus"
version.workspace = true
edition.workspace = true

[dependencies]
dioxus = { version = "0.5", features = ["desktop"] }
dioxus-desktop = "0.5"
tauri = { version = "2", features = [] }
serde = { workspace = true }
serde_json = { workspace = true }
tokio = { workspace = true, features = ["full"] }
tracing = { workspace = true }
tracing-subscriber = { workspace = true }
anyhow = { workspace = true }
apohara-types = { path = "../apohara-types" }
apohara-dispatch = { path = "../apohara-dispatch" }

[build-dependencies]
tauri-build = { version = "2", features = [] }
```

- [ ] **Step 2: Crear Dioxus.toml**

```toml
[application]
name = "apohara-desktop-dioxus"
default_platform = "desktop"

[web.app]
title = "Apohara Catalyst"

[web.watcher]
reload_html = true
watch_path = ["src", "../../"]

[web.resource]
style = []
script = []
```

- [ ] **Step 3: Crear main.rs hello world**

```rust
//! Apohara Desktop (Dioxus rewrite, Phase 2 bake-off)

use dioxus::prelude::*;

fn main() {
    tracing_subscriber::fmt::init();
    dioxus::launch(App);
}

fn App() -> Element {
    rsx! {
        div { id: "apohara-app",
            style { include_str!("../assets/brand.css") }
            h1 { class: "press-start-2p", "Apohara Catalyst" }
            p { "Dioxus bake-off — Sprint 16" }
        }
    }
}
```

- [ ] **Step 4: Crear assets/brand.css con tokens Sprint 9**

```bash
mkdir -p crates/apohara-desktop-dioxus/assets
```

```css
/* assets/brand.css — Sprint 9 brand tokens */
:root {
  --lime: #25B13F;
  --ink: #0E1010;
  --bg: var(--ink);
  --fg: #E8E8E8;
}

body {
  background: var(--bg);
  color: var(--fg);
  font-family: 'Inter', sans-serif;
  margin: 0;
}

.press-start-2p {
  font-family: 'Press Start 2P', monospace;
  color: var(--lime);
}
```

- [ ] **Step 5: Agregar crate al workspace**

Editar `Cargo.toml` raíz, agregar `"crates/apohara-desktop-dioxus"` a `workspace.members`.

- [ ] **Step 6: Build + smoke test**

Run: `cargo build -p apohara-desktop-dioxus`
Expected: builds cleanly.

Run: `cargo run -p apohara-desktop-dioxus`
Expected: window opens showing "Apohara Catalyst" en lime over ink.

- [ ] **Step 7: Commit**

```bash
git add crates/apohara-desktop-dioxus/ Cargo.toml
git commit -m "feat(dioxus): apohara-desktop-dioxus crate skeleton with brand CSS (G2.A.1)

Hello-world Dioxus app boots con Sprint 9 brand tokens (lime/ink).
Tauri 2 shell preservado. Hot reload pendiente G2.A.3."
```

### Task G2.A.2: Tauri 2 integration + IPC bridge

**Files:**
- Create: `crates/apohara-desktop-dioxus/tauri.conf.json`
- Create: `crates/apohara-desktop-dioxus/src/commands.rs`
- Create: `crates/apohara-desktop-dioxus/tests/ipc_smoke.rs`
- Modify: `crates/apohara-desktop-dioxus/src/main.rs`

- [ ] **Step 1: Failing test for IPC bridge**

```rust
// tests/ipc_smoke.rs
use apohara_desktop_dioxus::commands::dispatch_run;

#[tokio::test]
async fn dispatch_run_returns_run_id() {
    let result = dispatch_run("test prompt".into(), "coder".into()).await;
    assert!(result.is_ok(), "dispatch_run should succeed: {result:?}");
    let run_id = result.unwrap();
    assert!(!run_id.is_empty(), "run_id no debe ser vacío");
}
```

- [ ] **Step 2: Verify test fails**

Run: `cargo test -p apohara-desktop-dioxus`
Expected: compile error `commands::dispatch_run` no existe.

- [ ] **Step 3: Implementar commands.rs**

```rust
//! Tauri commands exponen Rust crates al Dioxus UI.

use anyhow::Result;
use apohara_dispatch::DispatchRequest;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
pub struct RunId(pub String);

#[tauri::command]
pub async fn dispatch_run(prompt: String, role: String) -> Result<String, String> {
    let req = DispatchRequest {
        prompt,
        role: role.parse().map_err(|e: anyhow::Error| e.to_string())?,
    };
    apohara_dispatch::run(req)
        .await
        .map(|outcome| outcome.run_id)
        .map_err(|e| e.to_string())
}

// Wrapper exposable a test (sin tauri::command macro)
pub async fn dispatch_run_inner(prompt: String, role: String) -> anyhow::Result<String> {
    let req = DispatchRequest {
        prompt,
        role: role.parse()?,
    };
    let outcome = apohara_dispatch::run(req).await?;
    Ok(outcome.run_id)
}
```

- [ ] **Step 4: Wire commands en main.rs**

```rust
mod commands;

fn main() {
    tracing_subscriber::fmt::init();

    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![commands::dispatch_run])
        .setup(|app| {
            // Dioxus launch desde Tauri setup
            std::thread::spawn(|| {
                dioxus::launch(App);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 5: Re-run test pointing at inner**

Actualizar tests/ipc_smoke.rs:

```rust
use apohara_desktop_dioxus::commands::dispatch_run_inner;

#[tokio::test]
async fn dispatch_run_inner_returns_run_id() {
    let result = dispatch_run_inner("test prompt".into(), "coder".into()).await;
    assert!(result.is_ok(), "dispatch_run_inner should succeed: {result:?}");
    assert!(!result.unwrap().is_empty(), "run_id no debe ser vacío");
}
```

Run: `cargo test -p apohara-desktop-dioxus`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add crates/apohara-desktop-dioxus/src/commands.rs crates/apohara-desktop-dioxus/src/main.rs crates/apohara-desktop-dioxus/tests/ipc_smoke.rs crates/apohara-desktop-dioxus/tauri.conf.json
git commit -m "feat(dioxus): Tauri 2 IPC bridge with dispatch_run command (G2.A.2)

dispatch_run wraps apohara-dispatch::run para Dioxus UI calls.
Inner fn exposed for tests (sin tauri::command attr)."
```

### Task G2.A.3: Hot reload pipeline

**Files:**
- Modify: `crates/apohara-desktop-dioxus/Dioxus.toml`
- Create: `crates/apohara-desktop-dioxus/.cargo/config.toml`
- Create: `crates/apohara-desktop-dioxus/scripts/dev.sh`

- [ ] **Step 1: Configurar Dioxus.toml watcher**

Confirmar `[web.watcher]` already correct (Step 2 G2.A.1). Add:

```toml
[web.watcher]
reload_html = true
watch_path = ["src", "assets"]
index_on_404 = true
```

- [ ] **Step 2: Crear dev script**

```bash
#!/usr/bin/env bash
# scripts/dev.sh — Dioxus dev server con hot reload
set -euo pipefail

cd "$(dirname "$0")/.."
cargo install dioxus-cli --version 0.5 2>/dev/null || true
dx serve --platform desktop --hot-reload
```

```bash
chmod +x crates/apohara-desktop-dioxus/scripts/dev.sh
```

- [ ] **Step 3: Smoke test hot reload**

Run en una terminal: `cd crates/apohara-desktop-dioxus && ./scripts/dev.sh`
Expected: app boots. Editar src/main.rs (cambiar string), guardar, observar reload <500ms.

(Implementer documenta latency observada en commit message.)

- [ ] **Step 4: Commit**

```bash
git add crates/apohara-desktop-dioxus/Dioxus.toml crates/apohara-desktop-dioxus/scripts/dev.sh crates/apohara-desktop-dioxus/.cargo/config.toml
git commit -m "feat(dioxus): hot reload pipeline via dx serve (G2.A.3)

dev.sh boots dx serve --hot-reload. Observed latency <500ms en cambios src/.
Watch paths: src/ + assets/."
```

### Task G2.A.4: Port HeroBanner component (Sprint 9 brand showcase)

**Files:**
- Create: `crates/apohara-desktop-dioxus/src/components/mod.rs`
- Create: `crates/apohara-desktop-dioxus/src/components/hero_banner.rs`
- Create: `crates/apohara-desktop-dioxus/src/components/hero_banner_test.rs`
- Modify: `crates/apohara-desktop-dioxus/src/main.rs`
- Reference: `packages/desktop/src/components/HeroBanner.tsx`

- [ ] **Step 1: Read reference React component**

Implementer DEBE leer `packages/desktop/src/components/HeroBanner.tsx` completo antes de portar. Extract: props shape + CSS classes + JSX structure.

- [ ] **Step 2: Failing test**

```rust
// src/components/hero_banner_test.rs
#[cfg(test)]
mod tests {
    use crate::components::hero_banner::HeroBanner;
    use dioxus::prelude::*;
    use dioxus_ssr::render_lazy;

    #[test]
    fn hero_banner_renders_with_lime_color() {
        let html = render_lazy(rsx! { HeroBanner { title: "Apohara Catalyst" } });
        assert!(html.contains("Apohara Catalyst"), "title missing: {html}");
        assert!(html.contains("press-start-2p"), "brand font class missing");
        assert!(html.contains("--lime"), "lime token missing");
    }
}
```

(Add `dioxus-ssr = "0.5"` a dev-dependencies de Cargo.toml.)

- [ ] **Step 3: Verify test fails**

Run: `cargo test -p apohara-desktop-dioxus components::hero_banner`
Expected: compile error.

- [ ] **Step 4: Implementar HeroBanner**

```rust
//! HeroBanner — Sprint 9 brand showcase, ported a Dioxus rsx!.
//! Reference: packages/desktop/src/components/HeroBanner.tsx

use dioxus::prelude::*;

#[component]
pub fn HeroBanner(title: String) -> Element {
    rsx! {
        section { class: "hero-banner",
            h1 { class: "press-start-2p hero-title", "{title}" }
            div { class: "hero-running-border" }
        }
    }
}
```

Agregar a `src/components/mod.rs`:

```rust
pub mod hero_banner;
pub use hero_banner::HeroBanner;

#[cfg(test)]
mod hero_banner_test;
```

Append CSS a `assets/brand.css`:

```css
.hero-banner {
  padding: 24px;
  background: linear-gradient(180deg, var(--ink) 0%, color-mix(in srgb, var(--ink), var(--lime) 8%) 100%);
}

.hero-title {
  font-size: 32px;
  color: var(--lime);
  text-shadow: 0 0 8px color-mix(in srgb, var(--lime), transparent 60%);
}

.hero-running-border {
  height: 2px;
  background: var(--lime);
  animation: hero-running 3s linear infinite;
}

@keyframes hero-running {
  0% { transform: scaleX(0); transform-origin: left; }
  50% { transform: scaleX(1); transform-origin: left; }
  100% { transform: scaleX(0); transform-origin: right; }
}
```

Wire en main.rs App:

```rust
use crate::components::HeroBanner;

fn App() -> Element {
    rsx! {
        div { id: "apohara-app",
            style { include_str!("../assets/brand.css") }
            HeroBanner { title: "Apohara Catalyst" }
        }
    }
}
```

- [ ] **Step 5: Verify test passes**

Run: `cargo test -p apohara-desktop-dioxus components::hero_banner`
Expected: PASS.

- [ ] **Step 6: Visual smoke**

Run: `cargo run -p apohara-desktop-dioxus`
Expected: HeroBanner muestra "Apohara Catalyst" lime + running border animation.

- [ ] **Step 7: Commit**

```bash
git add crates/apohara-desktop-dioxus/src/components/ crates/apohara-desktop-dioxus/src/main.rs crates/apohara-desktop-dioxus/assets/brand.css crates/apohara-desktop-dioxus/Cargo.toml
git commit -m "feat(dioxus): HeroBanner component port from Sprint 9 React (G2.A.4)

Direct rsx! translation preserva CSS animations (running border keyframes).
SSR test verifica lime color + Press Start 2P class. Visual smoke parity con React baseline."
```

### Task G2.A.5: Performance baseline benchmark

**Files:**
- Create: `crates/apohara-desktop-dioxus/benches/render_bench.rs`
- Modify: `crates/apohara-desktop-dioxus/Cargo.toml`

- [ ] **Step 1: Bench render time HeroBanner**

```rust
// benches/render_bench.rs
use criterion::{criterion_group, criterion_main, Criterion};
use dioxus::prelude::*;
use dioxus_ssr::render_lazy;
use apohara_desktop_dioxus::components::HeroBanner;

fn bench_hero_banner_render(c: &mut Criterion) {
    c.bench_function("hero_banner_render", |b| {
        b.iter(|| {
            let _ = render_lazy(rsx! { HeroBanner { title: "Apohara".to_string() } });
        });
    });
}

criterion_group!(benches, bench_hero_banner_render);
criterion_main!(benches);
```

Add a Cargo.toml:

```toml
[dev-dependencies]
criterion = { version = "0.5", features = ["html_reports"] }

[[bench]]
name = "render_bench"
harness = false
```

- [ ] **Step 2: Run bench + record baseline**

Run: `cargo bench -p apohara-desktop-dioxus -- hero_banner_render`
Expected: < 1ms por render (target).

- [ ] **Step 3: Commit baseline**

```bash
git add crates/apohara-desktop-dioxus/benches/ crates/apohara-desktop-dioxus/Cargo.toml
git commit -m "bench(dioxus): HeroBanner render baseline via criterion (G2.A.5)

Baseline target <1ms. Implementer observado: [VALOR]ms.
Será reference para regression detection en Phases 3-4."
```

### Task G2.A.6: Bake-off decision document

**Files:**
- Create: `docs/superpowers/rust-native/dioxus-bake-off-decision.md`

- [ ] **Step 1: Documentar findings**

```markdown
# Dioxus Bake-Off Decision (Sprint 16 cierre, G2.A.6)

## Status quo post-S16

| Criterio | Resultado | Pass/Fail |
|---|---|---|
| Dioxus 0.5 builds clean en workspace | [SI/NO] | [P/F] |
| Tauri 2 IPC bridge funciona | [SI/NO] | [P/F] |
| Hot reload <500ms | [VALOR]ms | [P/F] |
| HeroBanner render parity con React | [SI/NO] | [P/F] |
| SSR test pasable | [SI/NO] | [P/F] |
| criterion bench <1ms | [VALOR]ms | [P/F] |
| dx serve estable sin crashes | [SI/NO] | [P/F] |

## Decision gate

- [ ] **GO con Dioxus** — todos criterios pasan, continuar Phase 2 con Dioxus para Sprints 17-19.
- [ ] **PIVOT a Slint** — >=2 criterios critical fallan. Re-spec a Slint, ajustar Phase 2 plan, +5d overhead.

Marcar UNO arriba. Si PIVOT, abrir issue + nuevo spec.
```

- [ ] **Step 2: Implementer marca decision basado en evidencia**

(Implementer ejecuta los pasos de G2.A.1-5 + completa la tabla arriba con números reales.)

- [ ] **Step 3: Commit decision**

```bash
git add docs/superpowers/rust-native/dioxus-bake-off-decision.md
git commit -m "docs: Dioxus bake-off decision gate documented (G2.A.6)

Decision: [GO/PIVOT]. Evidence en doc. Sprint 17 arranca con [Dioxus/Slint]."
```

### Task G2.A.7: Sprint 16 cierre commit

- [ ] **Step 1: Verificar todo verde**

Run: `cargo test --workspace 2>&1 | tail -5`
Expected: all green.

Run: `cargo build -p apohara-desktop-dioxus --release`
Expected: builds clean.

- [ ] **Step 2: Sprint 16 cierre empty commit**

```bash
git commit --allow-empty -m "chore(sprint): S16 Dioxus bake-off complete

Decision: GO con Dioxus. 1 component live (HeroBanner), hot reload working,
IPC bridge tested. Sprint 17 arranca con Wave A (brand primitives + 4 easy components)."
```

---

## G2.B — Sprint 17 Wave A (7d, 4 paralelos)

**Outcome esperado**: 4 implementers en paralelo (paths disjuntos por subdirectorio components/) portan brand primitives + 4 easy components. Cada implementer cierra su set con cargo test verde + visual smoke parity con React baseline.

**Paralelización scheme**: paths disjuntos por subdirectorio:
- **Implementer 1**: primitives (Button, Input, Card, Badge) → `src/components/primitives/`
- **Implementer 2**: brand (AgentStateDot, RunningBorder, PixelCanvas) → `src/components/brand/`
- **Implementer 3**: layout (TaskBoard MVP, ProviderRoster) → `src/components/layout/`
- **Implementer 4**: dialogs (PermissionDialog basic, ToastDialog stub) → `src/components/dialogs/`

Cada uno commits separados con paths inline (NUNCA `git add .`).

### Task G2.B.1: Implementer 1 — primitives

**Files:**
- Create: `crates/apohara-desktop-dioxus/src/components/primitives/{mod,button,input,card,badge}.rs`
- Create: `crates/apohara-desktop-dioxus/src/components/primitives/primitives_test.rs`
- Reference: `packages/desktop/src/components/ui/{button,input,card,badge}.tsx`

- [ ] **Step 1: Read each React primitive completo**

Implementer lee los 4 archivos `.tsx` antes de empezar.

- [ ] **Step 2: Failing test for Button**

```rust
// src/components/primitives/primitives_test.rs
#[cfg(test)]
mod button_tests {
    use crate::components::primitives::Button;
    use dioxus::prelude::*;
    use dioxus_ssr::render_lazy;

    #[test]
    fn button_renders_with_label_and_variant() {
        let html = render_lazy(rsx! {
            Button { variant: "primary", "Run" }
        });
        assert!(html.contains("Run"), "label missing: {html}");
        assert!(html.contains("btn-primary"), "variant class missing: {html}");
    }

    #[test]
    fn button_supports_disabled_state() {
        let html = render_lazy(rsx! {
            Button { variant: "primary", disabled: true, "Disabled" }
        });
        assert!(html.contains("disabled"), "disabled attribute missing");
    }
}
```

- [ ] **Step 3: Verify fails**

Run: `cargo test -p apohara-desktop-dioxus primitives`
Expected: compile error.

- [ ] **Step 4: Implementar Button**

```rust
// src/components/primitives/button.rs
use dioxus::prelude::*;

#[component]
pub fn Button(
    children: Element,
    variant: Option<String>,
    disabled: Option<bool>,
    onclick: Option<EventHandler<MouseEvent>>,
) -> Element {
    let variant = variant.unwrap_or_else(|| "default".into());
    let disabled = disabled.unwrap_or(false);

    rsx! {
        button {
            class: "btn btn-{variant}",
            disabled: disabled,
            onclick: move |evt| {
                if let Some(handler) = &onclick {
                    handler.call(evt);
                }
            },
            {children}
        }
    }
}
```

(Implementer escribe Input, Card, Badge siguiendo el mismo pattern.)

- [ ] **Step 5: CSS para primitives**

Append a `assets/brand.css`:

```css
.btn {
  padding: 8px 16px;
  border: 1px solid var(--lime);
  background: transparent;
  color: var(--lime);
  font-family: 'JetBrains Mono', monospace;
  cursor: pointer;
  transition: all 150ms;
}
.btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--lime), transparent 85%);
}
.btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.btn-primary { background: var(--lime); color: var(--ink); }

.card {
  background: color-mix(in srgb, var(--ink), white 4%);
  border: 1px solid color-mix(in srgb, var(--lime), transparent 80%);
  border-radius: 4px;
  padding: 16px;
}

.input {
  padding: 8px 12px;
  background: var(--ink);
  color: var(--fg);
  border: 1px solid color-mix(in srgb, var(--lime), transparent 70%);
  font-family: 'JetBrains Mono', monospace;
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  background: var(--lime);
  color: var(--ink);
  font-size: 10px;
  font-family: 'Press Start 2P', monospace;
}
```

- [ ] **Step 6: Verify tests pass**

Run: `cargo test -p apohara-desktop-dioxus primitives`
Expected: all pass.

- [ ] **Step 7: Commit Implementer 1**

```bash
git add crates/apohara-desktop-dioxus/src/components/primitives/ crates/apohara-desktop-dioxus/assets/brand.css
git commit -m "feat(dioxus): brand primitives (Button/Input/Card/Badge) ported (G2.B.1)

Wave A primitive #1. SSR tests verify variants + disabled state.
CSS preserva tokens Sprint 9 (lime/ink + Press Start 2P + JetBrains Mono)."
```

### Task G2.B.2: Implementer 2 — brand effects

**Files:**
- Create: `crates/apohara-desktop-dioxus/src/components/brand/{mod,agent_state_dot,running_border,pixel_canvas}.rs`
- Create: `crates/apohara-desktop-dioxus/src/components/brand/brand_test.rs`
- Reference: `packages/desktop/src/components/{AgentStateDot,RunningBorder,PixelCanvas}.tsx`

- [ ] **Step 1: Read references + failing test**

```rust
// src/components/brand/brand_test.rs
#[test]
fn agent_state_dot_shows_correct_color_by_state() {
    use crate::components::brand::AgentStateDot;
    use dioxus::prelude::*;
    use dioxus_ssr::render_lazy;

    let html_hot = render_lazy(rsx! { AgentStateDot { state: "hot" } });
    assert!(html_hot.contains("dot-hot"), "hot state class missing");

    let html_idle = render_lazy(rsx! { AgentStateDot { state: "idle" } });
    assert!(html_idle.contains("dot-idle"), "idle state class missing");
}
```

- [ ] **Step 2: Verify fails**

Run: `cargo test -p apohara-desktop-dioxus brand`
Expected: compile error.

- [ ] **Step 3: Implementar AgentStateDot**

```rust
// src/components/brand/agent_state_dot.rs
use dioxus::prelude::*;

#[component]
pub fn AgentStateDot(state: String) -> Element {
    rsx! {
        span { class: "agent-dot dot-{state}", title: "{state}", "" }
    }
}
```

(Implementar RunningBorder y PixelCanvas siguiendo el mismo pattern. PixelCanvas usa `<canvas>` element con dioxus refs + JS interop ad hoc para draw — implementer ve reference React + adapta.)

CSS adicional:

```css
.agent-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 6px;
}
.dot-hot { background: var(--lime); box-shadow: 0 0 6px var(--lime); animation: pulse 1.5s infinite; }
.dot-warm { background: color-mix(in srgb, var(--lime), white 30%); }
.dot-cool { background: color-mix(in srgb, var(--lime), transparent 50%); }
.dot-idle { background: color-mix(in srgb, var(--fg), transparent 60%); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
```

- [ ] **Step 4: Verify tests pass**

Run: `cargo test -p apohara-desktop-dioxus brand`
Expected: all pass.

- [ ] **Step 5: Commit Implementer 2**

```bash
git add crates/apohara-desktop-dioxus/src/components/brand/ crates/apohara-desktop-dioxus/assets/brand.css
git commit -m "feat(dioxus): brand effects (AgentStateDot/RunningBorder/PixelCanvas) (G2.B.2)

Wave A brand components. 4 states mapped (hot/warm/cool/idle) via CSS classes.
PixelCanvas via canvas + dioxus refs JS interop."
```

### Task G2.B.3: Implementer 3 — TaskBoard MVP + ProviderRoster

**Files:**
- Create: `crates/apohara-desktop-dioxus/src/components/layout/{mod,task_board,provider_roster}.rs`
- Create: `crates/apohara-desktop-dioxus/src/components/layout/layout_test.rs`
- Reference: `packages/desktop/src/components/{TaskBoard,ProviderRoster}.tsx`

- [ ] **Step 1: Failing test for TaskBoard**

```rust
// src/components/layout/layout_test.rs
#[cfg(test)]
mod task_board_tests {
    use crate::components::layout::TaskBoard;
    use apohara_types::{DagTask, TaskStatus};
    use dioxus::prelude::*;
    use dioxus_ssr::render_lazy;

    #[test]
    fn task_board_renders_4_status_columns() {
        let tasks = vec![];
        let html = render_lazy(rsx! { TaskBoard { tasks: tasks.clone() } });
        // 4 columns por defecto: pending, ready, in_verification, done
        assert!(html.contains("col-pending"), "pending column missing");
        assert!(html.contains("col-ready"), "ready column missing");
        assert!(html.contains("col-in-verification"), "in_verification column missing");
        assert!(html.contains("col-done"), "done column missing");
    }

    #[test]
    fn task_board_renders_task_in_correct_column() {
        let task = DagTask {
            id: "t1".into(),
            title: "Test task".into(),
            status: TaskStatus::Ready,
            ..Default::default()
        };
        let html = render_lazy(rsx! { TaskBoard { tasks: vec![task] } });
        assert!(html.contains("Test task"), "task title missing");
        assert!(html.contains("col-ready"), "ready column missing");
    }
}
```

- [ ] **Step 2: Verify fails**

Run: `cargo test -p apohara-desktop-dioxus layout`
Expected: compile error.

- [ ] **Step 3: Implementar TaskBoard**

```rust
// src/components/layout/task_board.rs
use apohara_types::{DagTask, TaskStatus};
use dioxus::prelude::*;

#[component]
pub fn TaskBoard(tasks: Vec<DagTask>) -> Element {
    let columns = [
        ("col-pending", TaskStatus::Pending, "Pending"),
        ("col-ready", TaskStatus::Ready, "Ready"),
        ("col-in-verification", TaskStatus::InVerification, "Verifying"),
        ("col-done", TaskStatus::Done, "Done"),
    ];

    rsx! {
        div { class: "task-board",
            for (class, status, label) in columns {
                div { class: "task-column {class}",
                    h3 { class: "press-start-2p", "{label}" }
                    for task in tasks.iter().filter(|t| t.status == status) {
                        TaskCard { task: task.clone() }
                    }
                }
            }
        }
    }
}

#[component]
fn TaskCard(task: DagTask) -> Element {
    rsx! {
        div { class: "card task-card",
            p { class: "task-title", "{task.title}" }
            small { class: "task-id", "#{task.id}" }
        }
    }
}
```

(Implementar ProviderRoster siguiendo el mismo pattern. Reference: `packages/desktop/src/components/ProviderRoster.tsx`.)

CSS adicional:

```css
.task-board {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  padding: 16px;
}
.task-column {
  background: color-mix(in srgb, var(--ink), white 2%);
  border: 1px solid color-mix(in srgb, var(--lime), transparent 90%);
  border-radius: 4px;
  padding: 12px;
  min-height: 200px;
}
.task-column h3 {
  font-size: 12px;
  margin: 0 0 12px 0;
  color: color-mix(in srgb, var(--lime), white 30%);
}
.task-card { margin-bottom: 8px; }
.task-title { margin: 0; }
.task-id { color: color-mix(in srgb, var(--fg), transparent 50%); }
```

- [ ] **Step 4: Verify tests pass**

Run: `cargo test -p apohara-desktop-dioxus layout`
Expected: all pass.

- [ ] **Step 5: Commit Implementer 3**

```bash
git add crates/apohara-desktop-dioxus/src/components/layout/ crates/apohara-desktop-dioxus/assets/brand.css
git commit -m "feat(dioxus): layout components TaskBoard MVP + ProviderRoster (G2.B.3)

Wave A composition. 4 status columns. Tasks filtered por status.
DnD pendiente Wave B (G2.C). ProviderRoster MVP sin trust presets edit
(coming G2.C)."
```

### Task G2.B.4: Implementer 4 — PermissionDialog + ToastDialog stub

**Files:**
- Create: `crates/apohara-desktop-dioxus/src/components/dialogs/{mod,permission_dialog,toast_dialog}.rs`
- Create: `crates/apohara-desktop-dioxus/src/components/dialogs/dialogs_test.rs`
- Reference: `packages/desktop/src/components/PermissionDialog.tsx`

- [ ] **Step 1: Failing test**

```rust
// src/components/dialogs/dialogs_test.rs
#[cfg(test)]
mod permission_dialog_tests {
    use crate::components::dialogs::PermissionDialog;
    use dioxus::prelude::*;
    use dioxus_ssr::render_lazy;

    #[test]
    fn permission_dialog_renders_with_command() {
        let html = render_lazy(rsx! {
            PermissionDialog {
                command: "rm -rf /tmp/test",
                runner_kind: "Bash",
                visible: true,
            }
        });
        assert!(html.contains("rm -rf /tmp/test"), "command missing: {html}");
        assert!(html.contains("Bash"), "runner kind missing");
        assert!(html.contains("Allow") && html.contains("Deny"), "actions missing");
    }
}
```

- [ ] **Step 2: Verify fails**

Run: `cargo test -p apohara-desktop-dioxus dialogs`
Expected: compile error.

- [ ] **Step 3: Implementar PermissionDialog**

```rust
// src/components/dialogs/permission_dialog.rs
use dioxus::prelude::*;

#[component]
pub fn PermissionDialog(
    command: String,
    runner_kind: String,
    visible: bool,
    on_allow: Option<EventHandler<()>>,
    on_deny: Option<EventHandler<()>>,
) -> Element {
    if !visible {
        return rsx! {};
    }

    rsx! {
        div { class: "dialog-backdrop",
            div { class: "card dialog permission-dialog",
                h3 { class: "press-start-2p", "Permission required" }
                p { class: "dialog-runner", "Runner: " span { class: "badge", "{runner_kind}" } }
                pre { class: "dialog-command", "{command}" }
                div { class: "dialog-actions",
                    button { class: "btn btn-primary",
                        onclick: move |_| { if let Some(h) = &on_allow { h.call(()); } },
                        "Allow"
                    }
                    button { class: "btn",
                        onclick: move |_| { if let Some(h) = &on_deny { h.call(()); } },
                        "Deny"
                    }
                }
            }
        }
    }
}
```

CSS adicional:

```css
.dialog-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.dialog {
  min-width: 400px;
  max-width: 600px;
}
.dialog-command {
  background: var(--ink);
  padding: 8px;
  font-family: 'JetBrains Mono', monospace;
  overflow-x: auto;
  border-radius: 2px;
}
.dialog-actions {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  margin-top: 16px;
}
```

- [ ] **Step 4: Verify tests pass**

Run: `cargo test -p apohara-desktop-dioxus dialogs`
Expected: pass.

- [ ] **Step 5: Commit Implementer 4**

```bash
git add crates/apohara-desktop-dioxus/src/components/dialogs/ crates/apohara-desktop-dioxus/assets/brand.css
git commit -m "feat(dioxus): PermissionDialog + ToastDialog stub (G2.B.4)

Wave A dialogs. PermissionDialog renders command + runner_kind + Allow/Deny.
ToastDialog stub para Wave B integration. Backdrop blocks input.
on_allow/on_deny handlers via EventHandler<()>."
```

### Task G2.B.5: Sprint 17 cierre commit

- [ ] **Step 1: Verify all green**

Run: `cargo test --workspace 2>&1 | tail -5`
Expected: all green.

- [ ] **Step 2: Sprint 17 cierre**

```bash
git commit --allow-empty -m "chore(sprint): S17 Wave A complete (4 implementers paralelos)

Brand primitives + brand effects + layout MVP + dialogs portados a Dioxus.
~12 components live. Sprint 18 (Wave B + signals migration) arranca."
```

---

## G2.C — Sprint 18 Wave B + signals state migration (8d, 3 paralelos)

**Outcome esperado**: 3 implementers paralelos completan polish components (cmd palette, toasts, tooltips, resizable panels) + migración completa jotai atoms → Dioxus GlobalSignal. Al cierre todos los state stores son Rust-native.

**Paralelización scheme**:
- **Implementer 1**: state migration → `src/state/{tasks,roster,permissions,view_mode,sse_events}.rs`
- **Implementer 2**: polish components → `src/components/polish/{command_palette,toast,tooltip,resizable}.rs`
- **Implementer 3**: kanban + DnD + ViewToggle + Statusline + ObjectivePane → `src/components/composition/`

### Task G2.C.1: State migration — Dioxus signals reemplazan jotai

**Files:**
- Create: `crates/apohara-desktop-dioxus/src/state/{mod,tasks,roster,permissions,view_mode,sse_events}.rs`
- Create: `crates/apohara-desktop-dioxus/src/state/state_test.rs`
- Reference: `packages/desktop/src/state/{tasksAtom,rosterAtom,permissionsAtom,viewModeAtom,sseEventsAtom}.ts`

- [ ] **Step 1: Failing test for TASKS signal**

```rust
// src/state/state_test.rs
#[cfg(test)]
mod tasks_tests {
    use crate::state::tasks::{TASKS, upsert_task, remove_task};
    use apohara_types::{DagTask, TaskStatus};

    #[test]
    fn upsert_task_inserts_new() {
        let task = DagTask {
            id: "t1".into(),
            title: "First".into(),
            status: TaskStatus::Pending,
            ..Default::default()
        };
        upsert_task(task);
        let tasks = TASKS.read();
        assert_eq!(tasks.get("t1").map(|t| t.title.clone()), Some("First".into()));
    }

    #[test]
    fn upsert_task_updates_existing() {
        let mut task = DagTask {
            id: "t2".into(),
            title: "v1".into(),
            ..Default::default()
        };
        upsert_task(task.clone());
        task.title = "v2".into();
        upsert_task(task);
        let tasks = TASKS.read();
        assert_eq!(tasks.get("t2").map(|t| t.title.clone()), Some("v2".into()));
    }

    #[test]
    fn remove_task_deletes() {
        upsert_task(DagTask { id: "t3".into(), ..Default::default() });
        remove_task("t3");
        let tasks = TASKS.read();
        assert!(tasks.get("t3").is_none());
    }
}
```

- [ ] **Step 2: Verify fails**

Run: `cargo test -p apohara-desktop-dioxus state`
Expected: compile error.

- [ ] **Step 3: Implementar TASKS signal**

```rust
// src/state/tasks.rs
//! Global tasks state — replaces packages/desktop/src/state/tasksAtom.ts
//! jotai pattern → Dioxus GlobalSignal pattern.

use apohara_types::DagTask;
use dioxus::prelude::*;
use std::collections::HashMap;

pub static TASKS: GlobalSignal<HashMap<String, DagTask>> = Signal::global(HashMap::new);

pub fn upsert_task(task: DagTask) {
    TASKS.write().insert(task.id.clone(), task);
}

pub fn remove_task(id: &str) {
    TASKS.write().remove(id);
}

pub fn all_tasks() -> Vec<DagTask> {
    TASKS.read().values().cloned().collect()
}
```

(Implementer escribe ROSTER, PERMISSIONS, VIEW_MODE, SSE_EVENTS siguiendo el mismo pattern.)

- [ ] **Step 4: Verify tests pass**

Run: `cargo test -p apohara-desktop-dioxus state`
Expected: all pass.

- [ ] **Step 5: Commit Implementer 1**

```bash
git add crates/apohara-desktop-dioxus/src/state/
git commit -m "feat(dioxus): jotai atoms → GlobalSignal state migration (G2.C.1)

5 atoms migrados: tasks/roster/permissions/view_mode/sse_events.
Pattern: GlobalSignal::global(default) + write()/read() helpers.
Tests verify upsert + remove operations. Components Wave A se
re-wire-án a estos signals en G2.C.4."
```

### Task G2.C.2: CommandPalette (cmd+K) port

**Files:**
- Create: `crates/apohara-desktop-dioxus/src/components/polish/{mod,command_palette}.rs`
- Create: `crates/apohara-desktop-dioxus/src/components/polish/command_palette_test.rs`
- Reference: `packages/desktop/src/components/CommandPalette.tsx`

- [ ] **Step 1: Failing test**

```rust
// src/components/polish/command_palette_test.rs
#[cfg(test)]
mod tests {
    use crate::components::polish::CommandPalette;
    use dioxus::prelude::*;
    use dioxus_ssr::render_lazy;

    #[test]
    fn cmd_palette_renders_filtered_results_when_query_matches() {
        let commands = vec![
            ("run.dispatch".to_string(), "Dispatch run".to_string()),
            ("doctor".to_string(), "Run doctor".to_string()),
        ];
        let html = render_lazy(rsx! {
            CommandPalette {
                commands: commands.clone(),
                query: "disp",
                visible: true,
            }
        });
        assert!(html.contains("Dispatch run"), "match missing");
        assert!(!html.contains("Run doctor"), "non-match shown");
    }

    #[test]
    fn cmd_palette_hidden_when_visible_false() {
        let html = render_lazy(rsx! {
            CommandPalette { commands: vec![], query: "", visible: false }
        });
        assert!(!html.contains("command-palette"), "palette visible: {html}");
    }
}
```

- [ ] **Step 2: Verify fails**

Run: `cargo test -p apohara-desktop-dioxus polish::command_palette`
Expected: compile error.

- [ ] **Step 3: Add fuzzy-matcher dep + implementar**

Cargo.toml:
```toml
fuzzy-matcher = "0.3"
```

```rust
// src/components/polish/command_palette.rs
use dioxus::prelude::*;
use fuzzy_matcher::{skim::SkimMatcherV2, FuzzyMatcher};

#[component]
pub fn CommandPalette(
    commands: Vec<(String, String)>,
    query: String,
    visible: bool,
    on_select: Option<EventHandler<String>>,
) -> Element {
    if !visible {
        return rsx! {};
    }

    let matcher = SkimMatcherV2::default();
    let filtered: Vec<&(String, String)> = commands
        .iter()
        .filter(|(_, label)| {
            query.is_empty() || matcher.fuzzy_match(label, &query).is_some()
        })
        .collect();

    rsx! {
        div { class: "dialog-backdrop",
            div { class: "card command-palette",
                input {
                    class: "input cmd-input",
                    placeholder: "Type a command…",
                    value: "{query}",
                    autofocus: true,
                }
                ul { class: "cmd-results",
                    for (id, label) in filtered {
                        li {
                            class: "cmd-item",
                            key: "{id}",
                            onclick: {
                                let id = id.clone();
                                move |_| { if let Some(h) = &on_select { h.call(id.clone()); } }
                            },
                            "{label}"
                        }
                    }
                }
            }
        }
    }
}
```

CSS:
```css
.command-palette { min-width: 480px; max-height: 60vh; overflow: hidden; }
.cmd-input { width: 100%; margin-bottom: 8px; }
.cmd-results { list-style: none; padding: 0; max-height: 300px; overflow-y: auto; }
.cmd-item { padding: 8px; cursor: pointer; }
.cmd-item:hover { background: color-mix(in srgb, var(--lime), transparent 90%); }
```

- [ ] **Step 4: Verify tests pass**

Run: `cargo test -p apohara-desktop-dioxus polish::command_palette`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add crates/apohara-desktop-dioxus/src/components/polish/ crates/apohara-desktop-dioxus/Cargo.toml crates/apohara-desktop-dioxus/assets/brand.css
git commit -m "feat(dioxus): CommandPalette with fuzzy-matcher (G2.C.2)

cmdk-equivalent en Dioxus. SkimMatcherV2 para fuzzy filter.
on_select handler emite command id. Keybind cmd+K wiring pendiente
en G2.D (global keyboard hook)."
```

### Task G2.C.3: Toast + Tooltip + Resizable panels

**Files:**
- Create: `crates/apohara-desktop-dioxus/src/components/polish/{toast,tooltip,resizable}.rs`
- Create: `crates/apohara-desktop-dioxus/src/components/polish/polish_test.rs`
- Reference: `packages/desktop/src/components/{Toast,Tooltip,ResizablePanel}.tsx`

- [ ] **Step 1: Failing test for Toast**

```rust
// src/components/polish/polish_test.rs (parcial)
#[cfg(test)]
mod toast_tests {
    use crate::components::polish::Toast;
    use dioxus::prelude::*;
    use dioxus_ssr::render_lazy;

    #[test]
    fn toast_renders_message_and_kind() {
        let html = render_lazy(rsx! {
            Toast { message: "Saved", kind: "success" }
        });
        assert!(html.contains("Saved"), "message missing");
        assert!(html.contains("toast-success"), "kind class missing");
    }
}
```

- [ ] **Step 2: Verify fails**

Run: `cargo test -p apohara-desktop-dioxus polish`
Expected: compile error.

- [ ] **Step 3: Implementar Toast / Tooltip / Resizable**

```rust
// src/components/polish/toast.rs
use dioxus::prelude::*;

#[component]
pub fn Toast(message: String, kind: String) -> Element {
    rsx! {
        div { class: "toast toast-{kind}", role: "status", "{message}" }
    }
}
```

(Implementer escribe Tooltip y Resizable. Tooltip usa hover state via dioxus signals + delay. Resizable usa mouse events para drag + signals para width state.)

CSS:
```css
.toast {
  position: fixed; bottom: 24px; right: 24px;
  padding: 12px 16px;
  background: var(--ink); color: var(--fg);
  border-left: 4px solid var(--lime);
  z-index: 2000;
  animation: toast-in 200ms ease-out;
}
.toast-success { border-color: var(--lime); }
.toast-error { border-color: #ff5555; }

@keyframes toast-in {
  from { transform: translateX(100%); opacity: 0; }
  to { transform: translateX(0); opacity: 1; }
}

.tooltip-wrapper { position: relative; display: inline-block; }
.tooltip { position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
  padding: 4px 8px; background: var(--ink); color: var(--fg);
  border: 1px solid var(--lime); white-space: nowrap; font-size: 11px;
  margin-bottom: 4px; pointer-events: none; }

.resizable-panel { position: relative; overflow: hidden; }
.resizable-handle { position: absolute; right: 0; top: 0; bottom: 0; width: 4px;
  cursor: col-resize; background: color-mix(in srgb, var(--lime), transparent 80%); }
```

- [ ] **Step 4: Verify tests pass**

Run: `cargo test -p apohara-desktop-dioxus polish`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crates/apohara-desktop-dioxus/src/components/polish/toast.rs crates/apohara-desktop-dioxus/src/components/polish/tooltip.rs crates/apohara-desktop-dioxus/src/components/polish/resizable.rs crates/apohara-desktop-dioxus/src/components/polish/polish_test.rs crates/apohara-desktop-dioxus/assets/brand.css
git commit -m "feat(dioxus): Toast + Tooltip + Resizable panels (G2.C.3)

Sonner equiv (Toast), Radix Tooltip equiv (hover + delay state),
react-resizable-panels equiv (mouse drag + signal width).
~50 LOC + ~80 LOC + ~120 LOC respectively."
```

### Task G2.C.4: Composition — KanbanBoard DnD + ViewToggle + Statusline + ObjectivePane

**Files:**
- Create: `crates/apohara-desktop-dioxus/src/components/composition/{mod,kanban_board,view_toggle,statusline,objective_pane}.rs`
- Create: `crates/apohara-desktop-dioxus/src/components/composition/composition_test.rs`
- Reference: `packages/desktop/src/components/{KanbanBoard,ViewToggle,Statusline,ObjectivePane}.tsx`

- [ ] **Step 1: Failing test for KanbanBoard DnD**

```rust
// src/components/composition/composition_test.rs (parcial)
#[cfg(test)]
mod kanban_tests {
    use crate::components::composition::KanbanBoard;
    use apohara_types::{DagTask, TaskStatus};
    use dioxus::prelude::*;
    use dioxus_ssr::render_lazy;

    #[test]
    fn kanban_renders_draggable_tasks() {
        let tasks = vec![
            DagTask { id: "k1".into(), title: "Task K1".into(), status: TaskStatus::Pending, ..Default::default() },
        ];
        let html = render_lazy(rsx! { KanbanBoard { tasks: tasks.clone() } });
        assert!(html.contains("Task K1"), "task missing");
        assert!(html.contains(r#"draggable="true""#), "draggable attr missing");
        assert!(html.contains("data-task-id"), "data attr missing");
    }
}
```

- [ ] **Step 2: Verify fails**

Run: `cargo test -p apohara-desktop-dioxus composition`
Expected: compile error.

- [ ] **Step 3: Implementar KanbanBoard con HTML5 DnD**

```rust
// src/components/composition/kanban_board.rs
use apohara_types::{DagTask, TaskStatus};
use dioxus::prelude::*;
use crate::state::tasks::TASKS;

#[component]
pub fn KanbanBoard(tasks: Vec<DagTask>) -> Element {
    let columns = [
        ("pending", TaskStatus::Pending, "Pending"),
        ("ready", TaskStatus::Ready, "Ready"),
        ("in-verification", TaskStatus::InVerification, "Verifying"),
        ("done", TaskStatus::Done, "Done"),
    ];

    rsx! {
        div { class: "kanban-board",
            for (key, status, label) in columns {
                div {
                    class: "kanban-column",
                    "data-status": "{key}",
                    ondragover: |evt| evt.prevent_default(),
                    ondrop: {
                        let new_status = status.clone();
                        move |evt: DragEvent| {
                            let task_id = evt.data().get_data("text/plain");
                            if let Some(mut task) = TASKS.write().get_mut(&task_id) {
                                task.status = new_status.clone();
                            }
                        }
                    },
                    h3 { class: "press-start-2p", "{label}" }
                    for task in tasks.iter().filter(|t| t.status == status) {
                        div {
                            class: "card kanban-task",
                            "draggable": "true",
                            "data-task-id": "{task.id}",
                            ondragstart: {
                                let id = task.id.clone();
                                move |evt: DragEvent| {
                                    evt.data().set_data("text/plain", &id);
                                }
                            },
                            p { "{task.title}" }
                        }
                    }
                }
            }
        }
    }
}
```

(Implementer escribe ViewToggle, Statusline, ObjectivePane siguiendo references.)

- [ ] **Step 4: Verify tests pass**

Run: `cargo test -p apohara-desktop-dioxus composition`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add crates/apohara-desktop-dioxus/src/components/composition/
git commit -m "feat(dioxus): composition (KanbanBoard DnD + ViewToggle + Statusline + ObjectivePane) (G2.C.4)

HTML5 native DnD API (draggable + dragstart + dragover + drop)
reemplaza @hello-pangea/dnd. Drop handler escribe directo a TASKS signal.
ViewToggle/Statusline/ObjectivePane direct ports preservando CSS."
```

### Task G2.C.5: Re-wire Wave A components a signals (App composition)

**Files:**
- Modify: `crates/apohara-desktop-dioxus/src/main.rs`

- [ ] **Step 1: Composing App con todos los components + signals**

```rust
//! Apohara Desktop App root (post-Wave-B composition)

use crate::components::brand::*;
use crate::components::composition::*;
use crate::components::dialogs::*;
use crate::components::layout::*;
use crate::components::polish::*;
use crate::components::primitives::*;
use crate::state::tasks::all_tasks;
use crate::state::view_mode::VIEW_MODE;
use dioxus::prelude::*;

fn App() -> Element {
    let tasks = all_tasks();
    let view = VIEW_MODE.read().clone();

    rsx! {
        div { id: "apohara-app",
            style { include_str!("../assets/brand.css") }
            HeroBanner { title: "Apohara Catalyst" }
            ViewToggle {}
            Statusline {}
            match view.as_str() {
                "board" => rsx! { KanbanBoard { tasks } },
                "list" => rsx! { TaskBoard { tasks } },
                _ => rsx! { ObjectivePane {} }
            }
        }
    }
}
```

- [ ] **Step 2: Smoke test**

Run: `cargo run -p apohara-desktop-dioxus`
Expected: UI completa boots. Switching ViewToggle alterna entre Board/List/Objective.

- [ ] **Step 3: Commit**

```bash
git add crates/apohara-desktop-dioxus/src/main.rs
git commit -m "feat(dioxus): App composition wires Wave A+B components + signals (G2.C.5)

ViewToggle drives layout. KanbanBoard/TaskBoard/ObjectivePane swap.
All state via signals. Sprint 18 final integration."
```

### Task G2.C.6: Sprint 18 cierre

- [ ] **Step 1: Verify all green**

Run: `cargo test --workspace 2>&1 | tail -5`
Expected: all green.

- [ ] **Step 2: Sprint 18 cierre**

```bash
git commit --allow-empty -m "chore(sprint): S18 Wave B + signals migration complete (3 implementers paralelos)

Polish components (cmd palette, toast, tooltip, resizable) +
composition (KanbanBoard DnD, ViewToggle, Statusline, ObjectivePane).
Jotai atoms → GlobalSignal cutover complete.
Sprint 19 (hard components + delete TS) arranca."
```

---

## G2.D — Sprint 19 Hard components + delete TS (5d, 3 paralelos + 1 final)

**Outcome esperado**: 3 hard components implementados (TerminalPane via alacritty_terminal, CodeDiffPane via syntect, SwarmCanvas via custom SVG + petgraph). Al final, single commit que borra todo TS source. Phase 2 cierra como **v1.0.0-rc.3** "100% Rust source".

**Paralelización scheme**:
- **Implementer 1**: TerminalPane → `src/components/hard/terminal_pane.rs` (alacritty_terminal)
- **Implementer 2**: CodeDiffPane → `src/components/hard/code_diff_pane.rs` (syntect)
- **Implementer 3**: SwarmCanvas → `src/components/hard/swarm_canvas.rs` (petgraph + custom SVG)

Después de los 3 cierres, implementer final ejecuta delete TS.

### Task G2.D.1: TerminalPane — alacritty_terminal integration

**Files:**
- Create: `crates/apohara-desktop-dioxus/src/components/hard/{mod,terminal_pane}.rs`
- Create: `crates/apohara-desktop-dioxus/src/components/hard/terminal_test.rs`
- Modify: `crates/apohara-desktop-dioxus/Cargo.toml`
- Reference: `packages/desktop/src/components/TerminalPane.tsx`

- [ ] **Step 1: Add alacritty_terminal dependency**

Cargo.toml:
```toml
alacritty_terminal = "0.24"
```

- [ ] **Step 2: Failing test (state machine, no real PTY)**

```rust
// src/components/hard/terminal_test.rs
#[cfg(test)]
mod tests {
    use crate::components::hard::terminal_pane::TerminalState;

    #[test]
    fn terminal_state_accumulates_output() {
        let mut state = TerminalState::new(80, 24);
        state.process_output(b"hello\n");
        assert!(state.visible_text().contains("hello"));
    }

    #[test]
    fn terminal_state_handles_ansi_clear() {
        let mut state = TerminalState::new(80, 24);
        state.process_output(b"foo\n");
        state.process_output(b"\x1b[2J"); // clear screen
        state.process_output(b"bar\n");
        let text = state.visible_text();
        assert!(text.contains("bar"));
    }
}
```

- [ ] **Step 3: Verify fails**

Run: `cargo test -p apohara-desktop-dioxus terminal_pane`
Expected: compile error.

- [ ] **Step 4: Implementar TerminalState + TerminalPane**

```rust
// src/components/hard/terminal_pane.rs
//! TerminalPane embeds alacritty_terminal en Dioxus.
//! Reference: packages/desktop/src/components/TerminalPane.tsx (xterm.js).
//! Feature reduction: sin links rendering, sin search, sin scrollback search.

use alacritty_terminal::{
    event::VoidListener,
    event_loop::Notifier,
    term::{test::TermSize, Config, Term},
    vte::ansi::Processor,
};
use dioxus::prelude::*;

pub struct TerminalState {
    term: Term<VoidListener>,
    processor: Processor,
}

impl TerminalState {
    pub fn new(cols: u16, rows: u16) -> Self {
        let size = TermSize::new(cols as usize, rows as usize);
        let config = Config::default();
        let term = Term::new(config, &size, VoidListener);
        Self { term, processor: Processor::new() }
    }

    pub fn process_output(&mut self, bytes: &[u8]) {
        self.processor.advance(&mut self.term, bytes);
    }

    pub fn visible_text(&self) -> String {
        let mut out = String::new();
        let grid = self.term.grid();
        for line_idx in 0..grid.screen_lines() {
            for cell in &grid[line_idx as i32] {
                out.push(cell.c);
            }
            out.push('\n');
        }
        out
    }
}

#[component]
pub fn TerminalPane(pty_id: String) -> Element {
    let state = use_signal(|| TerminalState::new(80, 24));

    // Real PTY wiring vía Tauri command + WebSocket es S20 (post Phase 2);
    // por ahora renderiza state visible_text.
    let text = state.read().visible_text();

    rsx! {
        div { class: "terminal-pane",
            pre { class: "terminal-output", "{text}" }
        }
    }
}
```

CSS:
```css
.terminal-pane {
  background: #0d0d0d;
  border: 1px solid color-mix(in srgb, var(--lime), transparent 80%);
  padding: 8px;
  min-height: 240px;
  max-height: 480px;
  overflow-y: auto;
}
.terminal-output {
  font-family: 'JetBrains Mono', monospace;
  font-size: 12px;
  color: #d0d0d0;
  white-space: pre;
  margin: 0;
}
```

- [ ] **Step 5: Verify tests pass**

Run: `cargo test -p apohara-desktop-dioxus terminal_pane`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add crates/apohara-desktop-dioxus/src/components/hard/terminal_pane.rs crates/apohara-desktop-dioxus/src/components/hard/terminal_test.rs crates/apohara-desktop-dioxus/src/components/hard/mod.rs crates/apohara-desktop-dioxus/Cargo.toml crates/apohara-desktop-dioxus/assets/brand.css
git commit -m "feat(dioxus): TerminalPane via alacritty_terminal (G2.D.1)

State machine acepta bytes (incluyendo ANSI escapes) + renderiza
visible_text. Real PTY wiring deferred a S20 post-Phase-2 (WebSocket
streaming via Tauri command). Feature reduction aceptada: sin links,
search, scrollback search."
```

### Task G2.D.2: CodeDiffPane — syntect integration

**Files:**
- Create: `crates/apohara-desktop-dioxus/src/components/hard/code_diff_pane.rs`
- Create: `crates/apohara-desktop-dioxus/src/components/hard/diff_test.rs`
- Modify: `crates/apohara-desktop-dioxus/Cargo.toml`
- Reference: `packages/desktop/src/components/CodeDiffPane.tsx`

- [ ] **Step 1: Add syntect dependency**

```toml
syntect = "5"
```

- [ ] **Step 2: Failing test**

```rust
// src/components/hard/diff_test.rs
#[cfg(test)]
mod tests {
    use crate::components::hard::code_diff_pane::{highlight_line, diff_lines};

    #[test]
    fn highlight_recognizes_rust_keyword() {
        let highlighted = highlight_line("fn main() {}", "rs");
        assert!(highlighted.contains("fn"), "keyword missing");
    }

    #[test]
    fn diff_marks_added_lines() {
        let lhs = "let a = 1;";
        let rhs = "let a = 1;\nlet b = 2;";
        let diff = diff_lines(lhs, rhs);
        assert!(diff.iter().any(|line| line.kind == "added" && line.text.contains("let b")));
    }
}
```

- [ ] **Step 3: Verify fails**

Run: `cargo test -p apohara-desktop-dioxus diff_test`
Expected: compile error.

- [ ] **Step 4: Implementar code_diff_pane.rs**

```rust
// src/components/hard/code_diff_pane.rs
//! CodeDiffPane — syntect-based syntax highlighting + line diff.
//! Reference: packages/desktop/src/components/CodeDiffPane.tsx (monaco).
//! Feature reduction: sin IntelliSense, sin hover popups, sin go-to-def.

use dioxus::prelude::*;
use syntect::{
    easy::HighlightLines,
    highlighting::ThemeSet,
    html::{styled_line_to_highlighted_html, IncludeBackground},
    parsing::SyntaxSet,
};

#[derive(Clone, Debug)]
pub struct DiffLine {
    pub text: String,
    pub kind: String, // "added", "removed", "unchanged"
}

pub fn highlight_line(text: &str, ext: &str) -> String {
    let ps = SyntaxSet::load_defaults_newlines();
    let ts = ThemeSet::load_defaults();
    let syntax = ps.find_syntax_by_extension(ext).unwrap_or_else(|| ps.find_syntax_plain_text());
    let theme = &ts.themes["base16-ocean.dark"];

    let mut h = HighlightLines::new(syntax, theme);
    let regions = h.highlight_line(text, &ps).unwrap_or_default();
    styled_line_to_highlighted_html(&regions[..], IncludeBackground::No).unwrap_or_default()
}

pub fn diff_lines(lhs: &str, rhs: &str) -> Vec<DiffLine> {
    let lhs_lines: Vec<&str> = lhs.lines().collect();
    let rhs_lines: Vec<&str> = rhs.lines().collect();
    let mut out = Vec::new();

    let max = lhs_lines.len().max(rhs_lines.len());
    for i in 0..max {
        let l = lhs_lines.get(i);
        let r = rhs_lines.get(i);
        match (l, r) {
            (Some(a), Some(b)) if a == b => out.push(DiffLine { text: (*a).into(), kind: "unchanged".into() }),
            (Some(a), Some(b)) => {
                out.push(DiffLine { text: (*a).into(), kind: "removed".into() });
                out.push(DiffLine { text: (*b).into(), kind: "added".into() });
            }
            (Some(a), None) => out.push(DiffLine { text: (*a).into(), kind: "removed".into() }),
            (None, Some(b)) => out.push(DiffLine { text: (*b).into(), kind: "added".into() }),
            (None, None) => {}
        }
    }
    out
}

#[component]
pub fn CodeDiffPane(lhs: String, rhs: String, ext: String) -> Element {
    let diff = diff_lines(&lhs, &rhs);

    rsx! {
        div { class: "code-diff",
            for line in diff {
                div { class: "diff-line diff-{line.kind}",
                    pre { dangerous_inner_html: "{highlight_line(&line.text, &ext)}" }
                }
            }
        }
    }
}
```

CSS:
```css
.code-diff { font-family: 'JetBrains Mono', monospace; font-size: 12px; background: #0d0d0d; padding: 8px; }
.diff-line pre { margin: 0; padding: 1px 6px; }
.diff-added { background: color-mix(in srgb, var(--lime), transparent 90%); }
.diff-added pre::before { content: '+'; margin-right: 6px; color: var(--lime); }
.diff-removed { background: color-mix(in srgb, #ff5555, transparent 90%); }
.diff-removed pre::before { content: '-'; margin-right: 6px; color: #ff5555; }
.diff-unchanged pre::before { content: ' '; margin-right: 6px; }
```

- [ ] **Step 5: Verify tests pass**

Run: `cargo test -p apohara-desktop-dioxus diff_test`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add crates/apohara-desktop-dioxus/src/components/hard/code_diff_pane.rs crates/apohara-desktop-dioxus/src/components/hard/diff_test.rs crates/apohara-desktop-dioxus/Cargo.toml crates/apohara-desktop-dioxus/assets/brand.css
git commit -m "feat(dioxus): CodeDiffPane via syntect (G2.D.2)

Line-based diff (LCS-free naive) + syntect syntax highlighting.
Feature reduction documentado: sin IntelliSense, sin hover, sin
go-to-def. Suficiente para code review path. Tests cubren highlight
+ diff marking."
```

### Task G2.D.3: SwarmCanvas — petgraph + custom SVG layout

**Files:**
- Create: `crates/apohara-desktop-dioxus/src/components/hard/swarm_canvas.rs`
- Create: `crates/apohara-desktop-dioxus/src/components/hard/swarm_test.rs`
- Modify: `crates/apohara-desktop-dioxus/Cargo.toml`
- Reference: `packages/desktop/src/components/SwarmCanvas.tsx`

- [ ] **Step 1: Add petgraph dep**

```toml
petgraph = "0.6"
```

- [ ] **Step 2: Failing test**

```rust
// src/components/hard/swarm_test.rs
#[cfg(test)]
mod tests {
    use crate::components::hard::swarm_canvas::{Node, Edge, layout_nodes};

    #[test]
    fn layout_assigns_positions_to_all_nodes() {
        let nodes = vec![
            Node { id: "a".into(), label: "A".into() },
            Node { id: "b".into(), label: "B".into() },
            Node { id: "c".into(), label: "C".into() },
        ];
        let edges = vec![
            Edge { from: "a".into(), to: "b".into() },
            Edge { from: "b".into(), to: "c".into() },
        ];
        let positions = layout_nodes(&nodes, &edges);
        assert_eq!(positions.len(), 3, "all nodes positioned");
        assert!(positions.iter().any(|(id, _, _)| id == "a"));
        assert!(positions.iter().any(|(id, _, _)| id == "c"));
    }
}
```

- [ ] **Step 3: Verify fails**

Run: `cargo test -p apohara-desktop-dioxus swarm_test`
Expected: compile error.

- [ ] **Step 4: Implementar SwarmCanvas**

```rust
// src/components/hard/swarm_canvas.rs
//! SwarmCanvas — DAG visualization via petgraph topological layout + custom SVG render.
//! Reference: packages/desktop/src/components/SwarmCanvas.tsx (@xyflow/react).

use dioxus::prelude::*;
use petgraph::{algo::toposort, graph::{DiGraph, NodeIndex}};
use std::collections::HashMap;

#[derive(Clone, Debug)]
pub struct Node { pub id: String, pub label: String }

#[derive(Clone, Debug)]
pub struct Edge { pub from: String, pub to: String }

pub fn layout_nodes(nodes: &[Node], edges: &[Edge]) -> Vec<(String, f64, f64)> {
    let mut graph = DiGraph::<String, ()>::new();
    let mut id_to_idx: HashMap<String, NodeIndex> = HashMap::new();

    for n in nodes {
        let idx = graph.add_node(n.id.clone());
        id_to_idx.insert(n.id.clone(), idx);
    }
    for e in edges {
        if let (Some(&from), Some(&to)) = (id_to_idx.get(&e.from), id_to_idx.get(&e.to)) {
            graph.add_edge(from, to, ());
        }
    }

    let sorted = toposort(&graph, None).unwrap_or_else(|_| {
        // fallback: arbitrary order si hay cycle
        graph.node_indices().collect()
    });

    // Assign x = depth (topological level), y = position within level
    let mut depth_of: HashMap<NodeIndex, usize> = HashMap::new();
    for idx in &sorted {
        let max_pred_depth = graph
            .neighbors_directed(*idx, petgraph::Direction::Incoming)
            .map(|p| depth_of.get(&p).copied().unwrap_or(0) + 1)
            .max()
            .unwrap_or(0);
        depth_of.insert(*idx, max_pred_depth);
    }

    let mut per_depth: HashMap<usize, usize> = HashMap::new();
    let mut out = Vec::new();
    for idx in &sorted {
        let depth = *depth_of.get(idx).unwrap_or(&0);
        let count = per_depth.entry(depth).or_insert(0);
        let y_idx = *count;
        *count += 1;
        let x = (depth as f64) * 160.0 + 40.0;
        let y = (y_idx as f64) * 90.0 + 40.0;
        out.push((graph[*idx].clone(), x, y));
    }
    out
}

#[component]
pub fn SwarmCanvas(nodes: Vec<Node>, edges: Vec<Edge>) -> Element {
    let positions = layout_nodes(&nodes, &edges);
    let id_to_xy: HashMap<String, (f64, f64)> = positions.iter().map(|(id, x, y)| (id.clone(), (*x, *y))).collect();

    rsx! {
        svg { class: "swarm-canvas", width: "800", height: "600",
            for edge in &edges {
                if let (Some((x1, y1)), Some((x2, y2))) = (id_to_xy.get(&edge.from), id_to_xy.get(&edge.to)) {
                    line {
                        x1: "{x1 + 60.0}", y1: "{y1 + 20.0}",
                        x2: "{x2}", y2: "{y2 + 20.0}",
                        stroke: "var(--lime)", "stroke-width": "1.5",
                    }
                }
            }
            for (id, x, y) in &positions {
                g { transform: "translate({x}, {y})",
                    rect { width: "120", height: "40", fill: "var(--ink)",
                        stroke: "var(--lime)", "stroke-width": "1", rx: "2" }
                    text { x: "60", y: "25", fill: "var(--fg)", "text-anchor": "middle",
                        "font-family": "JetBrains Mono", "font-size": "11",
                        "{id}"
                    }
                }
            }
        }
    }
}
```

- [ ] **Step 5: Verify tests pass**

Run: `cargo test -p apohara-desktop-dioxus swarm_test`
Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add crates/apohara-desktop-dioxus/src/components/hard/swarm_canvas.rs crates/apohara-desktop-dioxus/src/components/hard/swarm_test.rs crates/apohara-desktop-dioxus/Cargo.toml
git commit -m "feat(dioxus): SwarmCanvas via petgraph + custom SVG (G2.D.3)

DAG layout: topological depth → x, position-in-level → y.
Custom SVG render reemplaza @xyflow/react. Feature parity:
nodes + edges + auto-layout. Missing: zoom/pan (defer v1.1)."
```

### Task G2.D.4: Delete TS source — single commit

**Files:**
- Delete: `src/`
- Delete: `packages/desktop/src/`
- Delete: `packages/tui/`
- Delete: `npx-cli/`
- Delete: `tests/` (TS test directories)
- Delete: package.json files, bun.lockb, tsconfig.json
- Preserve: Tauri 2 shell config, package.json files only if Cargo-relevant (rare)

- [ ] **Step 1: Audit TS files to delete**

```bash
find src/ packages/desktop/src/ packages/tui/ npx-cli/ tests/ -type f 2>/dev/null | head -20
ls packages/
```

Implementer revisa que estos paths existen y son TS-only.

- [ ] **Step 2: Verify Rust path es self-contained**

Run: `cargo test --workspace 2>&1 | tail -5`
Expected: green sin depender de `src/` o `packages/desktop/src/`.

Run: `cargo run -p apohara-desktop-dioxus`
Expected: UI completa funciona sin TS.

- [ ] **Step 3: Delete TS source en single commit**

```bash
git rm -rf src/
git rm -rf packages/desktop/src/
git rm -rf packages/tui/
git rm -rf npx-cli/
git rm -rf tests/
git rm -f package.json bun.lockb tsconfig.json bunfig.toml
git rm -rf packages/apohara-shared/  # types.ts ahora regenerado vía cargo
git rm -rf packages/github-bridge/   # TS package, port a Rust en Phase 3 si necesario
```

(Preservar `crates/`, `Cargo.toml`, `Cargo.lock`, `docs/`, `.specify/`, `.claude/`, `CLAUDE.md`, `RELEASE_NOTES.md`, `.github/`, etc.)

- [ ] **Step 4: Verify nothing TS remains**

```bash
find . -name "*.ts" -not -path "./node_modules/*" -not -path "./target/*" -not -path "./.git/*" 2>/dev/null | head -5
find . -name "*.tsx" -not -path "./node_modules/*" -not -path "./target/*" -not -path "./.git/*" 2>/dev/null | head -5
find . -name "package.json" -not -path "./node_modules/*" -not -path "./target/*" 2>/dev/null
```

Expected: 0 results (or only Tauri config package.json if applicable).

- [ ] **Step 5: Re-verify cargo workspace**

Run: `cargo test --workspace 2>&1 | tail -5`
Expected: all green.

Run: `cargo build --release -p apohara-desktop-dioxus`
Expected: builds clean.

- [ ] **Step 6: Commit delete**

```bash
git commit -m "chore: delete legacy TS source post-Rust-native cutover (G2.D.4)

Removed:
- src/                          (~30k LOC TS, ported a 7 Rust crates Phase 1)
- packages/desktop/src/         (~10k LOC React/TS, reescrito en Dioxus Phase 2)
- packages/tui/                 (~2k LOC Ink, port a ratatui en Phase 3)
- packages/apohara-shared/      (TS types, ahora derivados de Rust ts-rs)
- packages/github-bridge/       (TS, port a Rust en Phase 3)
- npx-cli/                      (deprecated en favor de cargo install)
- tests/                        (bun:test, migrado a cargo test crate-by-crate)
- package.json, bun.lockb, tsconfig.json, bunfig.toml

Zero TS source in repo. apohara-desktop-dioxus crate ES la UI canónica.
Phase 2 cierre milestone."
```

### Task G2.D.5: Phase 2 cierre commit + RELEASE_NOTES update

**Files:**
- Modify: `RELEASE_NOTES.md`
- Modify: `docs/superpowers/pre-release-validation/sign-off.md`

- [ ] **Step 1: Update RELEASE_NOTES**

Append section "Phase 2 — UI rewrite" describing:
- Dioxus UI (14 components + 30 primitives)
- HTML5 native DnD reemplaza @hello-pangea/dnd
- syntect reemplaza monaco-editor (feature reduction documentada)
- alacritty_terminal reemplaza xterm.js
- petgraph reemplaza @xyflow/react
- Cero TS source remaining

- [ ] **Step 2: Update sign-off checklist**

Add row: `- [ ] Phase 2 cierre verified: cargo test --workspace green + apohara-desktop-dioxus boots + UI completa + 0 TS files`.

- [ ] **Step 3: Final verification**

```bash
cargo test --workspace 2>&1 | tail -5
cargo build --release -p apohara-desktop-dioxus 2>&1 | tail -5
find . -name "*.ts" -not -path "./node_modules/*" -not -path "./target/*" -not -path "./.git/*" | wc -l
```

Expected: tests green; build clean; ts count = 0.

- [ ] **Step 4: Sprint 19 + Phase 2 cierre empty commit**

```bash
git commit --allow-empty -m "chore(sprint): S19 hard components + delete TS — Phase 2 COMPLETE

Sprints 16-19 done. Dioxus UI 100% ported. Zero TS source.
alacritty_terminal + syntect + petgraph + custom SVG/DnD/cmd palette.

Releasable as v1.0.0-rc.3 '100% Rust source' — branding factually true.

Next: Phase 3 TUI ratatui + ContextForge primitivas + Z3 INV-15."
```

---

## Self-Review

**1. Spec coverage**:
- §4 Phase 2 (S16-S19): G2.A → S16, G2.B → S17, G2.C → S18, G2.D → S19 ✓
- §3 Dioxus UI strategy: rsx! macro patterns + GlobalSignal usage + Tauri IPC pattern aplicados consistente ✓
- §1 Capas LAYER 5 binary `apohara-desktop` consolidated as `apohara-desktop-dioxus` ✓
- §5 Risk register: Dioxus bake-off decision gate (G2.A.6) + alacritty integration investigation (G2.D.1) ✓
- §5 Migration cutover: TS delete en cierre Phase 2 G2.D.4 ✓
- §5 Testing strategy: cada task escribe failing test → impl → pass + uses dioxus-ssr para SSR tests + criterion para benches ✓

**2. Placeholder scan**: 0 TBD/TODO/FIXME en plan. Implementer-judgment markers (ej. "[VALOR]ms en bench") son intencionalmente que el implementer rellene con observed numbers.

**3. Type consistency**:
- `DagTask` shape consistente con Phase 1 (G1.A.2 RunState aliasing) + components G2.B.3 / G2.C.4
- `TaskStatus` enum import path `apohara_types` consistente
- Component prop names: `tasks`, `variant`, `visible`, `on_select`, `on_allow`, `on_deny` consistentes entre Wave A y Wave B
- GlobalSignal naming: TASKS / ROSTER / PERMISSIONS / VIEW_MODE / SSE_EVENTS (UPPER_SNAKE_CASE per Rust convention)

**4. Crate naming consistency**: `apohara-desktop-dioxus` consistent across all sections. Cargo manifest uses dashes, module path uses underscores (Rust convention).

**5. Dependency consistency**: `alacritty_terminal`, `syntect`, `petgraph`, `fuzzy-matcher` only mentioned in their respective tasks (no leaks). Dev deps (`dioxus-ssr`, `criterion`) consistent in setup.

---

*Fin del plan Phase 2.*
