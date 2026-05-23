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

## Roadmap (post-1.0)

- v1.1: smart router (cost/latency-aware dispatch), reactions, remote workers (opt-in), real chief mascot artwork (placeholder PNG ships in 1.0)
- v1.2: demo video tooling + comparative benchmarks
- v2.0: TBD — community input gating major changes

---

Made with Apohara Catalyst orchestrating itself.
