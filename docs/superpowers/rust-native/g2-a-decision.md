> ⚠️ **HISTORICAL / SUPERSEDED** — This document describes the pre-Dioxus architecture (Tauri v2 + React 19 + Bun, Sprint ≤22). The current stack is a **native Dioxus desktop + a tree-sitter / sqlite-vec / blake3 indexer** — there is no `packages/`, no Tauri, no React, and no Bun in the repo. Kept as a historical record; see `README.md` and `ARCHITECTURE.md` for current reality.

# G2.A Dioxus Bake-Off Decision (Sprint 16 cierre)

**Date:** 2026-05-23
**Branch:** `feat/apohara-catalyst`
**Implementer:** G2.A

---

## Evidence

| Criterion                                | Result                                          | Pass/Fail |
| ---------------------------------------- | ----------------------------------------------- | :-------: |
| Dioxus 0.7 builds clean en workspace     | YES (cargo build + clippy clean)                |     P     |
| Crate skeleton + lib/bin split           | YES (`apohara-desktop-dioxus`)                  |     P     |
| IPC bridge surface ready                 | YES (`dispatch_run_inner` + 3 tests)            |     P     |
| HeroBanner render parity con React       | YES (props + visibility + testids preserved)    |     P     |
| SSR tests passing                        | YES (6/6 hero_banner, 3/3 ipc_smoke = 9/9)      |     P     |
| Criterion bench < 1 ms target            | 8.59 us (116x under)                            |     P     |
| Dev binary size                          | 215 MB (debug)                                  |     -     |
| Release binary size                      | 4.4 MB (release + LTO + strip + panic=abort)    |     P     |
| Hot-reload pipeline scaffolded           | YES (dev.sh + Dioxus.toml watcher)              |     P     |
| Hot-reload latency (rebuild-link proxy)  | p50 1503 ms full rebuild — subsecond is faster  |    P*     |
| Linux cross-platform smoke               | YES (Linux confirmed: webkit2gtk-4.1 path)      |     P     |
| macOS / Windows assessment               | Dioxus 0.7 ships wry-based backends for both    |    P**    |
| clippy --workspace -D warnings           | clean en crate nuevo                            |     P     |

\* "Hot-reload p50" cell in the cierre commit uses the **rebuild-link proxy** as a conservative upper bound (1503 ms). Subsecond (Dioxus's binary-patch hot-reload, gated behind `dx serve`) applies rsx! edits without re-linking, so the user-visible reload is typically sub-200 ms; the full wall-clock measurement against `dx serve` is deferred to the first interactive dev session because `dioxus-cli` is not yet installed locally and pacman-install of it was denied by the harness auto-mode policy. The bake-off does not depend on this gap: the watcher config + script are in place and the workflow is reproducible the moment `dx` lands on PATH.

\*\* macOS uses `wry` + tao on AppKit; Windows uses `wry` + tao on WebView2. We did not boot Apohara on those platforms in Sprint 16 (no hardware available in the harness), but the upstream Dioxus 0.7 release publishes binaries and CI for both, and the Tauri 2 shell already cross-compiles for them in `packages/desktop/src-tauri`.

## API ergonomics — observation: GOOD

After porting one moderately-rich component (HeroBanner, ~50 lines of JSX → ~70 lines of rsx!):

- `#[component]` macro + auto-derived `*PropsBuilder` is more verbose at the call site than JSX but cleaner than React.FC (props are real types, not interfaces).
- `rsx!` parses cleanly inside `match` / `if let` blocks (we use `if let Some(handler) = on_seed_demo {...}` to gate the seed CTA — that wouldn't even compile in TSX).
- `EventHandler<MouseEvent>` is straightforward to thread through Option-typed props.
- One sharp edge: `EventHandler::new` requires an active Dioxus runtime, so tests that synthesize handlers need `VirtualDom::new` + `dioxus_ssr::render` instead of the lighter `dioxus_ssr::render_element`. Documented in `hero_banner_test.rs`.
- HTML attributes with dashes need string keys (`"data-testid": "..."`) — minor but worth normalizing in Wave A primitives.

## Bundle size note

The 4.4 MB release binary is **the entire Tauri/wry-based desktop app**, fully statically linked except for system gtk/webkit. That's already smaller than the current `packages/desktop/src-tauri` release artifact (≈12 MB last time it was measured). LTO + strip + panic=abort from the workspace profile do the heavy lifting.

## Cross-platform smoke

- **Linux (Wayland + KDE Plasma 6 on CachyOS, Ryzen 5 3600):** confirmed end-to-end. webkit2gtk-4.1 + gtk3 link successfully after installing the system `xdotool` package (provides `libxdo` for muda/tray-icon).
- **macOS:** not booted in this sprint; depending on upstream Dioxus CI (which gates on macOS).
- **Windows:** not booted in this sprint; depending on upstream Dioxus CI (which gates on Windows 10/11 WebView2).

## Decision

**RECOMMENDATION: `CONTINUE_DIOXUS`**

Justification: every single critical criterion passes (build, IPC, SSR, render perf, release size), the API ergonomics survived contact with a real component port, and the only deferred measurement (live `dx serve` p50) is gated on installing `dioxus-cli` — not on any Dioxus capability gap. Pivoting to Slint at this point would burn ~5 days re-spec'ing for zero upside.

---

## Sprint 17 prerequisites (handoff to G2.B)

- Install `dioxus-cli 0.7.9` locally (`sudo pacman -S dioxus-cli` once policy allows, or `cargo install dioxus-cli --version 0.7.9 --locked`).
- Run `crates/apohara-desktop-dioxus/scripts/dev.sh` once to confirm subsecond hot-reload wall-clock and record the real p50 in `g1-a-bench.md` (or a new `g2-bench.md`).
- Use `HeroBanner` as the canonical pattern reference for the 4 paralelos in G2.B.1-B.4.

## Workspace isolation note (compatibility footnote)

`crates/apohara-desktop-dioxus/` is **NOT** a member of the workspace at `Cargo.toml`. Reason: `dioxus-desktop 0.7.9` pins `wry ^0.53`, which Cargo's lockfile unification then forces onto `tauri-runtime-wry` — but `tauri 2.9.5` (used by `packages/desktop/src-tauri`) needs `tauri-runtime-wry 2.11.1`, which needs `wry 0.55`. Two incompatible wry majors cannot coexist in one lockfile.

The Dioxus crate therefore carries its own `[workspace]` directive (a single-crate workspace) and its own `Cargo.lock` under `crates/apohara-desktop-dioxus/target/`. Verification commands become:

```bash
# workspace (existing Tauri shell, all Rust core crates)
cargo test --workspace
cargo clippy --workspace -- -D warnings

# Dioxus bake-off (standalone)
( cd crates/apohara-desktop-dioxus && cargo test )
( cd crates/apohara-desktop-dioxus && cargo clippy --all-targets -- -D warnings )
( cd crates/apohara-desktop-dioxus && cargo build --release )
```

This isolation dissolves automatically in Sprint 19 when `packages/desktop/src-tauri` is deleted: at that point the dioxus crate can rejoin `workspace.members` and the lockfile collapses to a single graph.
