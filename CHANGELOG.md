# Changelog

All notable changes to **Apohara** are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-05-22

First public release of Apohara — a multi-agent code orchestration platform built on three CLI providers (Claude Code, Codex, OpenCode) with no provider-managed API keys.

### Added
- **Multi-agent orchestration** — bun:sqlite-backed task scheduler with non-overlapping write manifests, decision-gate serialization on conflicting writes, and per-task semantic memory injection.
- **Three sanctioned CLI drivers** — `claude-code-cli` (planner / critic), `codex-cli` (coder), `opencode-go` (explorer / editor) wrapped behind `BaseAgentProvider`. No OAuth, no API keys; subscriptions live with the user.
- **Sandbox crate (`apohara-sandbox`)** — seccomp-bpf + Linux namespaces (mount + user + PID + net) for untrusted runner execution.
- **Code indexer (`apohara-indexer`)** — tree-sitter + redb + Nomic BERT embeddings; mock mode via `APOHARA_MOCK_EMBEDDINGS=1` for CI.
- **SHA-256 event ledger** — append-only JSONL with hash chaining, genesis-block verification, and `apohara replay --verify`.
- **Internal MCP servers** — four loopback HTTP servers (`apohara.ledger`, `apohara.runs`, `apohara.indexer`, `apohara.settings`) with random 32-char hex tokens and endpoint-file handshake.
- **MCP Config Adapter (`apohara-mcp-bridge`)** — canonical → Claude / Codex / OpenCode dialect translation; per-spawn injection (§8.8).
- **github-bridge (poll-only)** — GitHub App auth (no PAT), Octokit client with retry + rate-limit, issue parser (frontmatter / SPEC heading / plain), poller, PR builder with three-strategy idempotency (`<!-- apohara-attempt: sha256:HEX -->`).
- **Desktop UI** — Tauri v2 + React 19; TaskBoard with 7 statuses, Plans panel, Agent config, Permissions dialog, Verification timeline; jotai vanilla atoms for React-free testability.
- **`apohara doctor`** — diagnostic CLI with 7 sections (`runtime`, `roster`, `policy`, `sandbox`, `ledger`, `mcp`, `assigned`), `--json` and `--skip-<section>` flags.
- **`apohara verify-setup`** — enrolls `LOCAL-SETUP-001` to exercise the full pipeline.

### Architecture
- **INV-15 JCR Safety Gate** — judge + critic + invariants must all pass before any PR ships.
- **SHA-256 ledger chain** — every event references the prior `chain_hash`; replay verifies end-to-end.
- **Cross-cutting disciplines (§0)** — centralized IPC listeners (§0.1), env sanitization on every spawn (§0.4), ts-rs SSoT for Rust ↔ TS types (§0.7), atomic file writes (§0.8), token accounting via absolutes not deltas (§0.14), `enum_dispatch` instead of `Box<dyn>` for providers (§0.16).
- **Bash compound guard** — `&&`, `||`, `;` in a command forces `["once"]` scope; `always` is never available for compound bash even with allow-list matches.

### Security
- **Sandbox hardening** — seccomp-bpf filter rejects unknown syscalls; mount / user / PID / net namespaces isolate runner processes.
- **Deny-first permission resolution** — `settings.deny` wins absolutely, even over cached `session` approvals.
- **No provider OAuth, no provider API keys** — credentials never enter the orchestrator process; CLI wrappers communicate over stdio with sanitized env.
- **MCP endpoint file** — written 0600; rotated on every bootstrap.

### Known limitations
- The github-bridge webhook handler returns **HTTP 501** in v1.0; push events ship in v1.1 via a two-track delivery worker (§11.2).
- `cargo test -p apohara-indexer` without `--lib` or `--test <bin>` will OOM on a 16 GB machine — the Nomic BERT weights are ~400 MB and cargo runs lib + integration binaries concurrently.
- The ContextForge regression test (`tests/integration/contextforge_regression.test.ts`) requires the sibling `apohara-context-forge` repo *and* `pytest` on `PATH`; otherwise it gracefully skips.
- Sandbox runner E2E currently SIGSEGVs on a futex / glibc / seccomp interaction in some test environments — tracked, not blocking v1.0 release.

[Unreleased]: https://github.com/SuarezPM/Apohara/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/SuarezPM/Apohara/releases/tag/v1.0.0