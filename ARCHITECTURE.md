# Architecture — Apohara v1.0

> This document describes how the v1.0 orchestrator, sidecars, and surfaces
> fit together. It is the reference text every PR is expected to match; if
> the code drifts from it, the document is the lie — open a PR to update it.

For the *what* (capabilities and roadmap), see [`README.md`](README.md) and
[`ROADMAP.md`](ROADMAP.md). For the *agent-facing navigation contract*, see
[`AGENTS.md`](AGENTS.md) (symlinked as `CLAUDE.md`). For the *commitments
that drove the design*, see [`PRINCIPLES.md`](PRINCIPLES.md). For the spec,
see [`docs/superpowers/specs/2026-05-21-apohara-v1-design.md`](docs/superpowers/specs/2026-05-21-apohara-v1-design.md).

---

## 1. System overview

Apohara is a multi-agent code orchestration platform built on three CLI
providers (Claude Code, Codex, OpenCode) with no provider-managed API keys.
Tasks come in as SPEC.md files or GitHub issues, get decomposed into a
dependency DAG by the planner, dispatched to git-worktree-isolated agents
by a bun:sqlite scheduler, executed under a seccomp-bpf sandbox, gated by a
judge / critic / invariants (JCR) verifier, and merged via the GitHub
bridge. Every meaningful event is appended to a SHA-256-chained JSONL
ledger; `apohara replay --verify` rebuilds the run and refuses to render
tampered chains.

---

## 2. Core invariants

These hold across every commit. Violating any of them is a P0 regression.

- **INV-15 (JCR safety gate)** — judge model + critic model + invariant
  suite (tests + schema + permission lattice) must *all* agree before any
  Apohara-authored diff opens a PR. A 2-of-3 majority does not ship.
- **SHA-256 ledger chain** — every event in `.events/run-<sid>.jsonl`
  references the prior `chain_hash`; `apohara replay --verify` rejects any
  tampering and `EventLedger.verify()` returns `brokenAt: i` on the first
  divergent index.
- **Atomic file writes (§0.8)** — every on-disk producer uses
  `mkstemp + rename` (TS: `src/core/persistence/atomicWrite.ts`, Rust:
  the corresponding helper in `apohara-persistence`). Half-written
  artifacts are not a failure mode the rest of the system has to handle.
- **Env sanitization on every spawn (§0.4)** — `src/core/persistence/envSanitizer.ts`
  scrubs provider API keys (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, etc.)
  and host secrets before any subprocess inherits the environment. The
  three CLI drivers authenticate against the user's subscriptions, not
  against a key embedded in the orchestrator process.
- **Bash compound guard** — `src/core/safety/bashCompoundAnalyzer.ts`
  defensively splits on `&&`, `||`, `;` (honoring quotes, heredocs, and
  command substitution). Any compound forces `["once"]` scope; `always`
  is never available for compound bash even when each component matches
  an allow-list entry.

The full set of 33 cross-cutting disciplines lives in spec §0; this
document only highlights the load-bearing ones.

---

## 3. Module map

This table mirrors `AGENTS.md` / `CLAUDE.md` (the agent-facing source of
truth). If you find a divergence, fix both.

### Rust crates (`crates/`)

| Crate | Responsibility |
|---|---|
| `crates/apohara-types` | Shared types Rust↔TS (ts-rs SSoT, §0.7) |
| `crates/apohara-secrets` | OS-native credential store (keyring-rs) |
| `crates/apohara-pathsafety` | Symlink-escape detection |
| `crates/apohara-audit` | JSONL audit sink + rotation + fchmod 0600 |
| `crates/apohara-notifications` | Cross-platform push notifications |
| `crates/apohara-persistence` | Cross-platform service installer + atomic-write helpers |
| `crates/apohara-worktree` | Git worktree lifecycle (consolidates the previous isolation-engine crate; not yet renamed in this branch) |
| `crates/apohara-coordinator` | Semantic conflict coordinator (slim, delegates state) |
| `crates/apohara-hooks-server` | Agent-hooks HTTP loopback (axum sidecar) |
| `crates/apohara-attention` | Attention bands state machine (HOT/WARM/COOL/IDLE) |
| `crates/apohara-token-accounting` | Token accounting (absolutes > deltas, per-thread) |
| `crates/apohara-mcp-bridge` | Canonical MCP config + per-provider adapters (Claude/Codex/OpenCode dialects) |
| `crates/apohara-event-humanizer` | Provider events → human-readable labels |
| `crates/apohara-anti-thrash` | Strategy rotation tracker (anti-loop) |
| `crates/apohara-indexer` | tree-sitter + sqlite-vec storage + blake3 feature-hashing embeddings (~0 RAM, no model) |
| `crates/apohara-sandbox` | seccomp-bpf + Linux namespaces (mount + user + PID + net) |

### Surfaces (Rust crates)

The UI and all user-facing surfaces are native Rust. There is no `packages/`
directory and no TypeScript/Node toolchain; the old `packages/desktop`
(Tauri + React), `packages/tui` (Ink), `packages/apohara-shared`, and
`packages/github-bridge` are gone. ts-rs bindings now emit per-crate to
`crates/<X>/bindings/*.ts` (§0.7).

| Crate | Responsibility |
|---|---|
| `crates/apohara-desktop-dioxus` | Dioxus 0.7 native desktop UI (TaskBoard, Plans, Permissions, Verification timeline). No webview, no Electron. |
| `crates/apohara-tui` | ratatui terminal UI (Dashboard, AgentList, CostTable, config wizard) |
| `crates/apohara` | `apohara` CLI (`doctor`, `verify-setup`, `plan`, …) |

### TypeScript domains (`src/core/`)

| Path | Responsibility |
|---|---|
| `src/core/orchestration/` | bun:sqlite orchestration DB, scheduler, decision gates, coordinator-runs, drift probe, circuit breaker, setup-verification |
| `src/core/safety/` | Permission patterns, bash compound analyzer, settings hierarchy, durable prompt, runnerPolicy (planCompiler / presets / fsSnapshot) |
| `src/core/spec/` | SPEC.md watcher + plan documents + plan status cache |
| `src/core/mcp/` | Internal MCP servers (bootstrap, canonical schema, mcpInjection, `base/` + `servers/` for ledger/runs/indexer/settings) |
| `src/core/providers/` | `BaseAgentProvider` + 3 active drivers (Claude / Codex / OpenCode), active vs. legacy roster, trust presets, mixins/protocols/streams |
| `src/core/hooks/` | Agent-hooks installer + events bridge |
| `src/core/decomposer/` | SPEC → tasks manifest decomposer |
| `src/core/verification/` | Verification mesh + `qualityGates/` (JCR gate orchestration) |
| `src/core/telemetry/` | Anonymous install ID + telemetry plumbing |
| `src/core/persistence/` | Atomic file writes (§0.8), env sanitizer (§0.4), shared defaults |
| `src/core/anti-thrash/` | TS counterpart of strategy-rotation tracker |
| `src/core/context/` | Per-request context propagation |
| `src/core/cli/` | Shared CLI errors + output helpers (`apohara doctor`, `verify-setup`, etc.) |

Per-crate `AGENTS.md` files (where present) carry the local invariants for
that crate; the agents read them on every session.

---

## 4. Data flow

A single objective travels through the same pipeline whether it enters via
SPEC.md or via the GitHub bridge:

```
  SPEC.md / GitHub issue
          │
          ▼
   decomposer (src/core/decomposer/)        — NL → typed task manifest
          │
          ▼
   tasks table (bun:sqlite, src/core/orchestration/)
          │
          ▼
   scheduler (src/core/orchestration/)      — topo walk, decision gates,
          │                                   circuit breaker, conflict serial
          ▼
   worktree spawn (crates/apohara-worktree) — symlink-safe checkout
          │
          ▼
   provider (src/core/providers/)           — BaseAgentProvider →
          │                                   claude-code-cli | codex-cli |
          │                                   opencode-go (stdio, no keys)
          ▼
   ledger (.events/run-<sid>.jsonl)         — SHA-256-chained JSONL
          │
          ▼
   verifier (src/core/verification/)        — judge + critic + invariants
          │                                   (INV-15 JCR gate)
          ▼
   PR builder (packages/github-bridge/)     — three-strategy idempotency:
          │                                   apohara-attempt: sha256:HEX
          ▼
   github-bridge (packages/github-bridge/)  — Octokit, retry + rate-limit,
                                              poll-only in v1.0
```

Sandbox execution (`crates/apohara-sandbox`) sits beneath the provider
step: whenever a CLI driver needs to run code, it asks the sandbox to
spawn the command via the two-fork seccomp+namespaces chain. Internal MCP
servers (`src/core/mcp/`, `crates/apohara-mcp-bridge`) sit beside the
provider step: they expose ledger / runs / indexer / settings to the
spawned CLI over loopback HTTP with a per-bootstrap 32-char hex token
written 0600 to the endpoint file.

---

## 5. Cross-cutting disciplines

The full list is in
[`docs/superpowers/specs/2026-05-21-apohara-v1-design.md` §0](docs/superpowers/specs/2026-05-21-apohara-v1-design.md)
(33 disciplines). Highlights worth re-reading before any non-trivial PR:

- **§0.1 Centralized IPC listeners** — never per-component; abort
  controllers + session mapping + permission lifecycle all flow through
  a single dispatcher.
- **§0.4 Env sanitization** — `src/core/persistence/envSanitizer.ts` on
  every spawn; no API keys reach subprocesses.
- **§0.7 ts-rs SSoT** — Rust types in `apohara-types` are the source of
  truth; ts-rs emits the per-crate bindings (`crates/<X>/bindings/*.ts`),
  never edited by hand.
- **§0.8 Atomic file writes** — `mkstemp + rename`, project-wide.
- **§0.14 Token accounting** — absolutes over deltas, per-thread.
- **§0.16 `enum_dispatch` instead of `Box<dyn>`** for provider polymorphism.

---

## 6. What's NOT in v1.0

These surfaces are intentionally absent. Don't search for them; don't add
"helpful" stubs. They are tracked for v1.1+.

- **Webhook delivery worker (`scripts/two-track-events.ts`)** — deferred
  to v1.1 per plan §11.2. The `packages/github-bridge/src/webhook.ts`
  endpoint exists only to reserve the URL path and always returns
  **HTTP 501 Not Implemented** in v1.0. v1.0 ingestion is poll-only
  (60s cadence). The two-track design (SSE + HMAC-signed webhook with
  8-attempt back-off `[0,10,30,90,300,900,1800,3600]s` + 410 auto-disable)
  ships in v1.1.
- **Additional providers** — the active roster is exactly
  `claude-code-cli`, `codex-cli`, `opencode-go`. The 21-provider legacy
  roster (cloud APIs + Gemini OAuth + others) is gated behind
  `APOHARA_LEGACY_PROVIDERS=1` and is **not characterized end-to-end
  against the JCR gate in v1.0**. A fourth official provider is a
  major-version event, not a config toggle. See `PRINCIPLES.md` §5.
- **Kanban/DAG UI sync integration test** — Task 10.6 (mount TaskBoard +
  SwarmCanvas in a test harness and assert both views update on a
  scheduler-side task mutation) is deferred. No
  `tests/integration/kanban_dag_sync.test.ts` ships in v1.0.
- **Anthropic provider OAuth** — TOS blocks programmatic OAuth wrapping
  for several providers (including Anthropic). The CLI-wrapper pattern
  is the v1.0 contract; OAuth flows are out of scope for the
  foreseeable future, not just v1.0.
- **Certain runner policies** — `src/core/safety/runnerPolicy/` ships the
  `balanced` preset compiled and validated by `apohara doctor`; the
  full preset taxonomy (per-provider, per-environment) lands incrementally
  in v1.x.

Known v1.0 quirks (vs. genuinely-absent features) are tracked in
[`CHANGELOG.md` "Known limitations"](CHANGELOG.md).

---

## 7. Where to read more

- **Spec:** [`docs/superpowers/specs/2026-05-21-apohara-v1-design.md`](docs/superpowers/specs/2026-05-21-apohara-v1-design.md) — full v1.0 design, including §0 disciplines.
- **Plan:** [`docs/superpowers/plans/2026-05-22-apohara-v1.md`](docs/superpowers/plans/2026-05-22-apohara-v1.md) — task-by-task implementation log (which Stage/Task created each module).
- **Principles:** [`PRINCIPLES.md`](PRINCIPLES.md) — the six commitments that drove every "no" in v1.0.
- **Changelog:** [`CHANGELOG.md`](CHANGELOG.md) — v1.0.0 entry + known limitations.
- **Agent navigation:** [`AGENTS.md`](AGENTS.md) (symlinked as `CLAUDE.md`) — module map, build/test commands, OOM hazards, "do not do" list.
- **Roadmap:** [`ROADMAP.md`](ROADMAP.md) — milestone-level state beyond v1.0.

---

*Document anchored 2026-05-22 against branch `feat/apohara-v1`. Update in
place when modules land or move; never rewrite from scratch.*
