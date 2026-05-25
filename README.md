# Apohara Catalyst

> Local-first multi-AI orchestrator. Catalyzes parallel dispatch across
> Claude Code, Codex, and OpenCode CLIs to slash Time-To-First-Token
> without consuming additional tokens from your subscriptions.

## What it does

Apohara Catalyst sits between you and your AI coding CLIs. You give it a
spec; it decomposes into tasks, dispatches them in parallel to whichever
CLI is best for each role (planner / coder / verifier), and stitches the
results back together with git worktrees so the agents never trip over
each other.

## Why "Catalyst"

In chemistry, a catalyst dramatically reduces the activation energy of a
reaction without being consumed. Apohara Catalyst dramatically reduces
TTFT (Time-To-First-Token) on multi-step engineering work by parallelizing
across the CLIs you already pay for — and consumes zero extra tokens of
its own.

## Quick start (Arch)

Apohara Catalyst v1.0 ships as a native Rust desktop app (Dioxus) — no Node, no
Tauri webview. On Arch / CachyOS:

```bash
bash scripts/install-arch.sh
```

This runs `cargo install --path crates/apohara-desktop-dioxus`, symlinks the
binary as `apohara-catalyst` in `~/.local/bin`, and installs a `.desktop`
launcher entry. Then:

- From a terminal: `apohara-catalyst`
- From the KDE/GNOME menu: search **Apohara Catalyst**

If the binary isn't found, make sure `~/.local/bin` is on your `PATH` (the
installer warns when it isn't).

## Install

```bash
npm install -g @apohara/catalyst
```

Or run without installing:

```bash
npx @apohara/catalyst doctor
```

## Quickstart

```bash
apohara doctor                 # verify your CLIs are reachable
apohara verify-setup           # round-trip test across active providers
apohara                        # opens the desktop UI on http://localhost:7331
```

## Architecture

- **local-first**: SQLite (bun:sqlite + Rust SQLx) for all state, no cloud.
- **CLI wrappers only**: Claude Code, Codex, OpenCode via stdin/stdout —
  zero OAuth, respects your existing subscriptions.
- **Tauri 2 + React 19** desktop UI; Ink TUI; npx CLI.
- **Rust workspace** for safety-critical paths (sandbox, worktree,
  pathsafety, audit, secrets).

See `docs/superpowers/specs/2026-05-23-apohara-catalyst-design.md` for
the design spec.

## Family

- **Apohara Catalyst** — orchestrator (this repo)
- **Apohara Probant** — verifier
- **Apohara Consilium** — governance OS

## License

MIT
