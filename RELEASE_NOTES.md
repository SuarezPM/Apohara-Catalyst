# Apohara Catalyst v1.0.0

> Local-first multi-AI orchestrator. Catalyzes parallel dispatch across
> Claude Code, Codex, and OpenCode CLIs to slash Time-To-First-Token
> without consuming additional tokens from your subscriptions.

## What's new in 1.0.0

This is the first public release. Highlights:

### Orchestration

- Spec → tasks decomposition with verification mesh
- Parallel dispatch across 3 CLI providers (Claude Code / Codex / OpenCode)
- Git worktree isolation per agent — no cross-talk, no file conflicts
- SQLite (bun:sqlite + Rust SQLx) for all state; zero cloud dependency

### Brand: Catalyst

- New pixel-art identity (lime + ink palette, Press Start 2P display font)
- Chief mascot animates with orchestrator state
- Kanban view with drag-and-drop status updates
- Cmd+K command palette
- Sonner toasts + Radix dialogs + resizable panels
- shadcn/ui primitives with Apohara branding

### Indexer

- sqlite-vec + blake3 feature-hashing replaces in-process Nomic BERT
- Eliminates the ~400MB OOM hazard documented in v0 spec §10 R1
- Deterministic, ~0 RAM, in-process

### Safety & isolation

- Sandbox via seccomp-bpf + namespaces (Linux)
- Path-safety with symlink-escape detection
- Atomic file writes (mkstemp + fdatasync + rename)
- Env sanitizer — no API keys leak to spawned CLIs
- OS-native credential store via keyring-rs
- §0.33 crash reports local-first (no telemetry by default)

### Local-first

- No telemetry by default (opt-in only)
- Crash reports stored locally; "Send to Apohara" is explicit
- No OAuth, no cloud sync — your subscriptions stay yours

## Install

```bash
npm install -g @apohara/catalyst
apohara doctor
apohara
```

## Compatibility

- Linux (Ubuntu 22.04+, Arch, CachyOS, Fedora 39+)
- macOS 14+ (Apple Silicon)
- Windows 11 + WSL2

## Pre-launch validation summary

Sprint 10 reports in `docs/superpowers/pre-release-validation/`:

| Report | Status | Notes |
|---|---|---|
| G10.A cross-platform | PROCEED contingent CI + WSL2 manual | 3 OS × 2 Node matrix in CI |
| G10.B security | PROCEED | 0 Critical/High; 1 Medium accepted (Marvin Attack threat-model mismatch) |
| G10.C performance | PROCEED | Cold-start 75.5ms, dispatch 7.2ms, indexer 7.6ms (all <target with >6x margin) |
| G10.D doctor coverage | PROCEED | 14 sections; verify-setup --skip-real-providers wired |

## Acknowledgments

This release stands on the shoulders of these projects:

- **orca** — AgentStateDot + ConfirmationDialogProvider patterns
- **chorus** — PixelCanvas approach
- **vibe-kanban** — @hello-pangea/dnd Kanban + animated running border
- **shadcn/ui** primitive patterns
- Brand identity inspired by sister projects Apohara Probant + Apohara Consilium

## Rust-Native core (Phase 1 cierre — defensible v1.0.0-rc.2)

Sprints 12-15 ported `src/core/*.ts` + `src/providers/cli-driver.ts` + `src/cli.ts` to 8 brand new Rust crates plus the `apohara` binary. Feature flags individual per crate, defaults flipped ON at G1.D.2. TS legacy still ships behind `APOHARA_RUST_<NAME>=0` opt-out until Phase 2 S19 delete.

| Crate | Source ported | Feature flag | Highlight |
|---|---|---|---|
| `apohara-dispatch` | `src/providers/cli-driver.ts` + `src/core/dispatch/*.ts` | `APOHARA_RUST_DISPATCH` | sanitize-then-overlay env preserves §0.4; bench 2.59 µs/spawn |
| `apohara-verification` | `src/core/verification/*.ts` | `APOHARA_RUST_VERIFICATION` | 6 quality gates run in 1.44 µs |
| `apohara-safety` | `src/core/safety/*.ts` | `APOHARA_RUST_SAFETY` | INV-bash-scope regression pinned; permission grid lookup 36 ns |
| `apohara-spec` | `src/core/spec/*.ts` | `APOHARA_RUST_SPEC` | notify-rs watcher + 161 µs plan parse + 1.27 µs cache fast-path |
| `apohara-mcp` | `src/core/mcp/*.ts` | `APOHARA_RUST_MCP` | axum 0.8 sidecars (5 built-in servers); injection 51 µs |
| `apohara-hooks` | `src/core/hooks/*.ts` | `APOHARA_RUST_HOOKS` | hook event dispatch 717 ns; idempotent installer |
| `apohara-decomposer` | `src/core/decomposer/*.ts` | `APOHARA_RUST_DECOMPOSER` | SPEC.md → manifest 16 µs / 210 LOC |
| `apohara-projector` | `src/core/projector/*.ts` | `APOHARA_RUST_PROJECTOR` | UI cards 7.19 µs / 48 events; JSON-Patch roundtrip 32.6 µs |
| `apohara` (binary) | `src/cli.ts` + `src/commands/{doctor,verifySetup,run}.ts` | (always) | clap-rs CLI; Phase 1 subset (doctor + verify-setup + run) |

Gate summary at Phase 1 cierre:
- `cargo test --workspace`   → 836/0 across 109 test binaries
- `cargo clippy --workspace` → clean (post rust 1.95 lint fixes)
- `cargo build --workspace`  → clean
- `./target/release/apohara doctor` → exits 0 or 2 (provider-warn only)

## Phase 2 — UI rewrite to Dioxus (cierre — defensible v1.0.0-rc.3 "100% Rust source")

Sprints 16-19 ported the entire React/TS UI to Dioxus (rsx! + GlobalSignal). Phase 2 cierre deletes all TS source from the repo. The `apohara-desktop-dioxus` crate is now the canonical UI shell.

Components ported (19 total):
- **Primitives**: Button, Input, Card, Badge
- **Brand**: AgentStateDot, RunningBorder, PixelCanvas
- **Layout**: TaskBoard, ProviderRoster
- **Dialogs**: PermissionDialog, ToastDialog (Sonner-style)
- **Polish**: CommandPalette (fuzzy-matcher), Toast, Tooltip, Resizable
- **Composition**: KanbanBoard (HTML5 native dnd, no @hello-pangea/dnd), ViewToggle, Statusline, ObjectivePane
- **Hard**: TerminalPane (alacritty_terminal), CodeDiffPane (syntect, no monaco), SwarmCanvas DAG (petgraph + custom SVG, no @xyflow/react)

State migration (5 atoms → 5 GlobalSignals): TASKS, ROSTER, PERMISSIONS, VIEW_MODE, SSE_EVENTS.

Dependency replacement summary:
- `@hello-pangea/dnd` → HTML5 native drag-and-drop via Dioxus event handlers
- `monaco-editor` → `syntect` (smaller, no WASM, lower latency)
- `xterm.js` → `alacritty_terminal` (true PTY semantics, ANSI escape sequences)
- `@xyflow/react` → `petgraph` + hand-rolled SVG (Sugiyama layered layout)
- `cmdk` → `fuzzy-matcher` + plain Dioxus
- `jotai` → Dioxus `GlobalSignal`

TS source deleted in single commit (G2.D.4): 780 files / 87,484 deletions. Zero `.ts/.tsx` files remain outside `crates/*/bindings/` (ts-rs auto-generated, no consumers) and `crates/apohara-indexer/tests/fixtures/` (tree-sitter parser test data).

Gate at Phase 2 cierre HEAD:
- `cargo test --workspace` → 949/0 across all binaries (was 836 before dioxus joined)
- `cargo clippy --workspace -- -D warnings` → clean
- `cargo check --workspace` → clean

## Roadmap (post-1.0)

- v1.1: smart router (cost/latency-aware dispatch), reactions, remote workers (opt-in), real chief mascot artwork (placeholder PNG ships in 1.0)
- v1.2: demo video tooling + comparative benchmarks
- Phase 3 (Sprints 20+): ratatui TUI + ContextForge — context-as-code DSL + Z3 INV-15 verifier
- v2.0: TBD — community input gating major changes

---

Made with Apohara Catalyst orchestrating itself.
