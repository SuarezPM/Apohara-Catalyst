# Changelog

All notable changes to **Apohara** are documented in this file.

The format is based on [Keep a Changelog 1.1.0](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning 2.0.0](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- **Desktop UI ported to native Dioxus 0.7** (`crates/apohara-desktop-dioxus`).
  The previous Tauri v2 + React 19 UI and the entire `packages/` TypeScript
  tree (`packages/desktop`, `packages/tui`, `packages/apohara-shared`,
  `packages/github-bridge`) were removed — no webview, no Electron, no
  Node/Bun toolchain. The shipping surfaces are now all Rust crates:
  `apohara-desktop-dioxus` (native UI), `apohara-tui` (ratatui), and
  `apohara` (CLI). This supersedes the "Tauri 2" / "bun:sqlite" identity
  lines recorded under [1.0.0].
- Indexer storage/embeddings swap (redb + Nomic BERT → sqlite-vec + blake3
  feature-hashing) is in effect — see [1.0.0-rc.1].

## [1.0.0-rc.1] — 2026-05-23

### Renamed

- npm package `apohara` → `@apohara/catalyst` (binary `apohara` preserved).
- Project tagline: "Apohara Ultimate" → "Apohara Catalyst".

### Removed

- `crates/apohara-indexer` no longer ships Nomic BERT (~400MB in-process model).
- `APOHARA_MOCK_EMBEDDINGS` environment variable (no longer needed).
- `mock-embeddings` cargo feature in `apohara-indexer`.
- Spec §10 R1 OOM warning + per-binary cargo test serialization rule.

### Added

- `crates/apohara-indexer/src/storage.rs`: sqlite-vec backed vector storage.
- `crates/apohara-indexer/src/embeddings.rs`: deterministic blake3 feature-hashing
  embeddings (~0 RAM, in-process, no model download).
- `tests/unit/no-mock-embeddings-references.test.ts`: regression guard.
- `tests/unit/readme-branding.test.ts`: branding regression guard.

### Changed

- `cargo test -p apohara-indexer` now safe to run without per-binary
  serialization — sqlite-vec + blake3 use negligible memory.
- README rewritten around the catalyst/TTFT narrative.

### Notes

This is a release-candidate of the v1.0.0 rebrand. v1.0.0 final ships in
Sprint 11 launch after the UI pixel-art rebrand (Sprint 9) and pre-release
validation (Sprint 10).

## [1.0.0] - 2026-05-23

First public release of Apohara — a multi-agent code orchestration platform built on three CLI providers (Claude Code, Codex, OpenCode) with no provider-managed API keys.

This release squashes the **v1.0 baseline** (Stages 1-11) with the **Apohara Ultimate** waves (Sprints 4-6) on top: every feature below ships under INV-15 and the SHA-256 ledger gate. Task IDs (`T4.x`, `G5.x`, `G6.x`, `G7.x`) reference the implementation plan in `docs/superpowers/plans/`.

### Added — Sprint 1-3 (v1.0 baseline)

- **Multi-agent orchestration** — bun:sqlite-backed task scheduler with non-overlapping write manifests, decision-gate serialization on conflicting writes, and per-task semantic memory injection.
- **Three sanctioned CLI drivers** — `claude-code-cli` (planner / critic), `codex-cli` (coder), `opencode-go` (explorer / editor) wrapped behind `BaseAgentProvider`. No OAuth, no API keys; subscriptions live with the user.
- **Sandbox crate (`apohara-sandbox`)** — seccomp-bpf + Linux namespaces (mount + user + PID + net) for untrusted runner execution.
- **Code indexer (`apohara-indexer`)** — tree-sitter + redb + Nomic BERT embeddings; mock mode via `APOHARA_MOCK_EMBEDDINGS=1` for CI. _(Superseded: the redb + Nomic BERT stack was replaced by sqlite-vec + blake3 feature-hashing — see [1.0.0-rc.1] "Removed"/"Added"; `APOHARA_MOCK_EMBEDDINGS` no longer exists.)_
- **SHA-256 event ledger** — append-only JSONL with hash chaining, genesis-block verification, and `apohara replay --verify`.
- **Internal MCP servers** — four loopback HTTP servers (`apohara.ledger`, `apohara.runs`, `apohara.indexer`, `apohara.settings`) with random 32-char hex tokens and endpoint-file handshake.
- **MCP Config Adapter (`apohara-mcp-bridge`)** — canonical → Claude / Codex / OpenCode dialect translation; per-spawn injection (§8.8).
- **github-bridge (poll-only)** — GitHub App auth (no PAT), Octokit client with retry + rate-limit, issue parser (frontmatter / SPEC heading / plain), poller, PR builder with three-strategy idempotency (`<!-- apohara-attempt: sha256:HEX -->`).
- **Desktop UI** — Tauri v2 + React 19; TaskBoard with 7 statuses, Plans panel, Agent config, Permissions dialog, Verification timeline; jotai vanilla atoms for React-free testability. _(Superseded: the Tauri + React UI was later ported to a native Dioxus 0.7 desktop crate, `apohara-desktop-dioxus` — no webview, no Node/Bun. See "Changed" below / [Unreleased].)_
- **`apohara doctor`** — diagnostic CLI with 7 sections (`runtime`, `roster`, `policy`, `sandbox`, `ledger`, `mcp`, `assigned`), `--json` and `--skip-<section>` flags.
- **`apohara verify-setup`** — enrolls `LOCAL-SETUP-001` to exercise the full pipeline.

### Added — Sprint 4 (Foundation / bug-barrels)

- Token accounting per-thread absolute (T4.1) — closes spec §0.14.
- `DurablePromptStore` JSONL-backed with atomic appends (T4.2).
- Runner policy wired to spawn path (T4.3) — closes agentrail #8.
- Poisoned session detection + quarantine (T4.4a) — closes multica #7.
- Duplicate prevention guard with delimiter-resistant fingerprint (T4.4b) — closes multica #13.
- Settings versioning chain with `loadAndMigrateSettings` (T4.4c) — closes multica #17.
- Hooks server broadcast channel (T4.5) — closes orca #1.
- Coordinator class with tick loop (T4.6) — closes orca #9.
- Real spawn in `ClaudeCodeProtocol` / `CodexProtocol` / `OpenCodeProtocol` (T4.7) — closes nimbalyst #1.2.
- JSONC CST with comment preservation (T4.8a) — closes spec §0.27.
- Versioned config schema with migration chain (T4.8b) — closes vibe-kanban #10.

### Added — Sprint 5 (Mid-stack features)

- `availableActions[]` contract (G5.D.1) + critic prompts (G5.D.4) + dual-status AC (G5.D.3) + hallucination flag (G5.D.5) + permission grid (G5.D.6) + `registerPermissionedTool` (G5.D.2) + doctor wired to `compileRunnerExecutionPlan` (G5.D.7).
- Filter DSL parser + applier (G5.E.1) + whisper stderr protocol (G5.E.2) + universal verbs (G5.E.3) + passthrough CLI (G5.E.4) + decentralized config (G5.E.5) + `TaggedEventBus` (G5.E.6) + skills install (G5.E.7).
- Multica mid-stack — secret redactor, atomic JSONL append (§0.8), UUID validate, empty-claim cache, lifecycle hooks, per-thread keying.
- Backlog Tier 3 — WSL handling, `apohara learn` cmd, `parseWithFallback`, OSC 998 command-state protocol (G5.I.5), git cherry status, named locks, prompt cache.

### Added — Sprint 6 (v1.1+ promoted)

- Workspace GC 3-tier with auto-downgrade (G6.B) — closes multica #8 promoted.
- `/yolo` full-auto pipeline with TRIPLE-OFF defense (G6.E) — closes Chorus `/yolo` promoted.
- Multi-process foundation — daemon + client + WS hub + transport + profiles (G6.A) — closes multica cliente-daemon split promoted.
- Distributed compute — SSH server + worker + handshake + recovery (G6.C) — closes vibe-kanban embedded SSH + symphony SSH worker promoted.
- Smart automation — intent classifier + reaction engine state machine (G6.D) — closes claude-octopus #12 + #13 promoted.

### Added — Sprint 7 (Release pipeline + landing polish)

- `linux-arm64` + `win32-arm64` added to desktop-release matrix (G7.A.1) — six-platform native builds.
- Artifact rename to `apohara-desktop-<slug>` schema (G7.A.2).
- SHA-256 sidecars per release asset (G7.A.3).
- `npm-publish.yml` workflow for the `apohara` package on npm (G7.A.5).
- Workspace version bump `1.0.0-dev` → `1.0.0` (G7.A.6, G7.A.7).
- README pain → relief grid + tagline (G7.B.1), trust badges + DOI link (G7.B.2), hero screenshot reference (G7.B.3), logo wall placeholder (G7.B.9), testimonials slot (G7.B.10).
- `docs/architecture.md` (G7.B.5), `docs/getting-started.md` (G7.B.6), `docs/troubleshooting.md` (G7.B.7).
- `apohara doctor` output polish — banners + actionable hints (G7.B.8).
- CI hardening — expanded OS × Node matrix (G7.D.1), `cargo audit` gate (G7.D.2), license scan via `cargo-deny` + `license-checker` (G7.D.3), bundle size guard (G7.D.4), perf regression smoke (G7.D.5).

### Changed

- Workspace version `1.0.0-dev` → `1.0.0` across Cargo + npm (G7.A.6, G7.A.7).
- `loadSettings` → `loadAndMigrateSettings` rename in the safety domain (T4.4c follow-up) — call sites must opt into migration explicitly.
- Doctor `policy` section replaces "Stage 5 integration pending" placeholder with a real `compileRunnerExecutionPlan` call (G5.D.7).

### Architecture

- **INV-15 JCR Safety Gate** — judge + critic + invariants must all pass before any PR ships.
- **SHA-256 ledger chain** — every event references the prior `chain_hash`; replay verifies end-to-end.
- **Cross-cutting disciplines (§0)** — centralized IPC listeners (§0.1), env sanitization on every spawn (§0.4), ts-rs SSoT for Rust ↔ TS types (§0.7), atomic file writes (§0.8), token accounting via absolutes not deltas (§0.14), `enum_dispatch` instead of `Box<dyn>` for providers (§0.16).
- **Bash compound guard** — `&&`, `||`, `;` in a command forces `["once"]` scope; `always` is never available for compound bash even with allow-list matches.

### Security

- **Sandbox hardening** — seccomp-bpf filter rejects unknown syscalls; mount / user / PID / net namespaces isolate runner processes.
- **Deny-first permission resolution** — `settings.deny` wins absolutely, even over cached `session` approvals.
- **No provider OAuth, no provider API keys** — credentials never enter the orchestrator process; CLI wrappers communicate over stdio with sanitized env (§0.4).
- **MCP endpoint file** — written 0600; rotated on every bootstrap.
- **/yolo mode** requires TRIPLE-OFF gates (env + UI + per-workspace allowlist file with non-empty content). Defaults to off everywhere.
- **SSH worker** binds `127.0.0.1` only with key-based auth (G6.C); no password fallback.

### Deprecated

- Legacy `.github/workflows/release.yml` removed in G7.A.4 — pointed to an `isolation-engine/` directory that no longer exists. `desktop-release.yml` + `npm-publish.yml` cover the real flow.

### Identity (preserved — non-negotiable)

- **Tauri 2**, no Electron. _(Superseded: native Dioxus 0.7, no webview/Electron — see [Unreleased].)_
- **bun:sqlite + Rust SQLx**, no PostgreSQL. _(Now SQLite on disk via the Rust-native stack; no Bun/Node — see [Unreleased].)_
- **Single-user-per-machine**, no multi-tenant.
- **CLI wrappers only**, no OAuth flows.
- **Local-first**, no cloud sync.
- No PostHog telemetry (anonymous install-id + denylist OK per §0.33).

### Known limitations

- The github-bridge webhook handler returns **HTTP 501** in v1.0; push events ship in v1.1 via a two-track delivery worker (§11.2).
- ~~`cargo test -p apohara-indexer` without `--lib` or `--test <bin>` will OOM on a 16 GB machine — the Nomic BERT weights are ~400 MB and cargo runs lib + integration binaries concurrently.~~ _Resolved in [1.0.0-rc.1]: the indexer no longer loads any model (sqlite-vec + blake3, ~0 RAM); the full suite runs in parallel safely._
- The ContextForge regression test (`tests/integration/contextforge_regression.test.ts`) requires the sibling `apohara-context-forge` repo *and* `pytest` on `PATH`; otherwise it gracefully skips.
- Sandbox runner E2E currently SIGSEGVs on a futex / glibc / seccomp interaction in some test environments — tracked, not blocking v1.0 release.

[Unreleased]: https://github.com/SuarezPM/Apohara/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/SuarezPM/Apohara/releases/tag/v1.0.0
