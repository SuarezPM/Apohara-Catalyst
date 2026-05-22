# Apohara — Agent Navigation Guide

> Concise navigation for AI coding agents working in this repository.
> For day-to-day engineering contract, see `CLAUDE.md` (symlinked here).

## Build & test commands

| Task | Command |
|---|---|
| Build all crates | `cargo build --workspace` |
| Run all Rust tests (be careful, see OOM hazard) | See "OOM hazard" below |
| Build TS bundle | `bun run build` |
| Run TS tests | `bun test` |
| Start desktop dev | `cd packages/desktop && bun run dev` |
| Generate TS types from Rust | `bun run generate-types` |
| Check types didn't drift | `bun run generate-types:check` |
| Doctor (full env check) | `apohara doctor` |
| Setup verification end-to-end | `apohara verify-setup` |

## Module map

| Crate / package | Responsibility | Crate AGENTS.md |
|---|---|---|
| `crates/apohara-types` | Shared types Rust↔TS (ts-rs SSoT) | `crates/apohara-types/AGENTS.md` |
| `crates/apohara-config` | Versioned config schema (v1→vN migrations) | `crates/apohara-config/AGENTS.md` |
| `crates/apohara-secrets` | OS-native credential store (keyring-rs) | `crates/apohara-secrets/AGENTS.md` |
| `crates/apohara-pathsafety` | Symlink-escape detection | `crates/apohara-pathsafety/AGENTS.md` |
| `crates/apohara-audit` | JSONL audit sink + rotation + fchmod 0600 | `crates/apohara-audit/AGENTS.md` |
| `crates/apohara-notifications` | Cross-platform push notifications | `crates/apohara-notifications/AGENTS.md` |
| `crates/apohara-persistence` | Cross-platform service installer | `crates/apohara-persistence/AGENTS.md` |
| `crates/apohara-worktree` | Git worktree lifecycle (rename of isolation-engine) | `crates/apohara-worktree/AGENTS.md` |
| `crates/apohara-coordinator` | Semantic conflict coordinator (slim, delegates state) | `crates/apohara-coordinator/AGENTS.md` |
| `crates/apohara-hooks-server` | Agent-hooks HTTP loopback (axum sidecar) | `crates/apohara-hooks-server/AGENTS.md` |
| `crates/apohara-attention` | Attention bands state machine (HOT/WARM/COOL/IDLE) | `crates/apohara-attention/AGENTS.md` |
| `crates/apohara-token-accounting` | Token accounting (absolutes > deltas, per-thread) | `crates/apohara-token-accounting/AGENTS.md` |
| `crates/apohara-mcp-bridge` | Canonical MCP config + per-provider adapters | `crates/apohara-mcp-bridge/AGENTS.md` |
| `crates/apohara-event-humanizer` | Provider events → human-readable labels | `crates/apohara-event-humanizer/AGENTS.md` |
| `crates/apohara-anti-thrash` | Strategy rotation tracker (anti-loop) | `crates/apohara-anti-thrash/AGENTS.md` |
| `crates/apohara-mcp` | Internal MCP servers (ledger/runs/indexer/settings) | `crates/apohara-mcp/AGENTS.md` |
| `crates/apohara-indexer` | tree-sitter + redb + Nomic BERT (existing, see OOM hazard) | `crates/apohara-indexer/AGENTS.md` |
| `crates/apohara-sandbox` | seccomp-bpf + namespaces sandbox (existing) | `crates/apohara-sandbox/AGENTS.md` |
| `packages/desktop` | Tauri v2 + React 19 desktop UI | `packages/desktop/AGENTS.md` |
| `packages/github-bridge` | GitHub Issues → orchestration → PR | `packages/github-bridge/AGENTS.md` |
| `src/core/orchestration/` | bun:sqlite orchestration DB + coordinator | `src/core/orchestration/AGENTS.md` |
| `src/core/safety/` | Permission patterns + settings hierarchy | `src/core/safety/AGENTS.md` |
| `src/core/spec/` | SPEC.md parser + plan documents | `src/core/spec/AGENTS.md` |

## Spec source of truth

`docs/superpowers/specs/2026-05-21-apohara-v1-design.md` — read it before non-trivial changes.

## Plan source of truth

`docs/superpowers/plans/2026-05-22-apohara-v1.md` — task-by-task implementation plan.

## OOM hazard with `cargo test`

**NEVER** run bare `cargo test` or `cargo test -p apohara-indexer`. The Nomic BERT model is ~400MB and `cargo test` spawns lib + integration binaries in parallel, OOM-ing the machine. See spec §10 R1.

Always run ONE test binary at a time:
- `cargo test -p apohara-indexer --lib`
- `cargo test -p apohara-indexer --test memory_integration`
- `cargo test -p apohara-indexer --test indexer_persistence`

For mock mode in CI/dev: `APOHARA_MOCK_EMBEDDINGS=1` skips the model load.

## Cross-cutting disciplines (spec §0)

Before making changes, review the 33 disciplines in `docs/superpowers/specs/2026-05-21-apohara-v1-design.md#0-disciplinas-transversales`. They are NOT suggestions — they're guardrails that prevent entire bug classes.

Highlights:
- §0.1 Centralized IPC listeners (never per-component)
- §0.4 Env sanitization on all spawns (no API keys to subprocesses)
- §0.7 ts-rs Single Source of Truth (never edit `packages/apohara-shared/types.ts` by hand)
- §0.8 Atomic file writes (mkstemp + rename)
- §0.14 Token accounting: absolutes > deltas
- §0.16 enum_dispatch instead of `Box<dyn>` for providers

## What NOT to do

- **Do NOT** edit `packages/apohara-shared/types.ts` manually — regenerate via `bun run generate-types`
- **Do NOT** commit to `main` directly — open a PR (this is a public repo from Stage 11 onwards)
- **Do NOT** add OAuth flows for providers — CLI wrappers only (Pablo's hard rule, see `~/.claude/projects/.../memory/feedback_providers_cli_wrapper.md`)
- **Do NOT** add providers to the active roster beyond `claude-code-cli`, `codex-cli`, `opencode-go` — others are LEGACY behind `APOHARA_LEGACY_PROVIDERS=1`

---

*This document is auto-loaded by Claude Code / Codex / OpenCode via `CLAUDE.md` symlink.*
