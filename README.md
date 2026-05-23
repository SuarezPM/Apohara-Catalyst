# Apohara

[![Build](https://github.com/SuarezPM/Apohara/actions/workflows/ci.yml/badge.svg)](https://github.com/SuarezPM/Apohara/actions/workflows/ci.yml)
[![Tests](https://img.shields.io/badge/tests-1300%2B%20passing-success)](https://github.com/SuarezPM/Apohara/actions)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![DOI](https://zenodo.org/badge/DOI/10.5281/zenodo.20114594.svg)](https://doi.org/10.5281/zenodo.20114594)
[![npm](https://img.shields.io/npm/v/apohara)](https://www.npmjs.com/package/apohara)

![Apohara dashboard](docs/img/hero.png)

> **For builders who ship.** Multi-AI orchestrator that wraps your CLI subscriptions
> (Claude Code, Codex, OpenCode) into a single local-first kanban dispatcher.
> No OAuth. No cloud sync. No per-token pricing. Your subscriptions, your machine,
> your control.

## Pain → Relief

| Pain (today) | Apohara (relief) |
|---|---|
| Each CLI agent runs in isolation; you copy-paste between them | One kanban; agents dispatched via your existing subscriptions |
| OAuth flows leak your subscription tier across vendors | Apohara wraps the CLIs — your auth stays where it always was |
| Run `claude code` and pray you didn't miss the right output | Hook events stream live to the UI; verification timeline shows what passed |
| Three providers, three CLIs, three terminal windows | Three providers, one Apohara, one git history |
| Lose track of which task ran which prompt | Every dispatch persisted in JSONL ledger; replay any session |

## Trusted by

<!--
  Logo wall coming post-launch — F4 in the nimbalyst-landing audit. The intent
  is a row of 6-8 logos of teams running Apohara in production, with a link
  out to each team's case study. We'll populate this once v1.0 has been in
  the wild for a few weeks and we have explicit permission from each team
  to namedrop them.

  Until then: this section is a placeholder so we have the slot baked into
  the layout, and so the empty state below is intentional rather than an
  oversight.
-->

> _Logo wall coming post-launch — we'll seed it once we have explicit
> permission from each team running Apohara in production._

## Testimonials

<!--
  Testimonial pull-quotes at v1.1 — F5 in the nimbalyst-landing audit.
  Format: 1-2 sentences per quote, name + title + company, optional photo.
  We need real users on real workloads before we ship pull-quotes;
  manufactured copy lands badly with the technical buyer this README
  targets.
-->

> _Testimonials at v1.1 — once real users have shipped real work on top of
> Apohara, we'll quote them here with permission._

## Why Apohara

**Your subscriptions stay with you.** Apohara does not hold provider API keys, broker an OAuth flow, or store tokens in a cloud vault. The three CLI drivers (`claude-code-cli`, `codex-cli`, `opencode-go`) authenticate against your existing subscriptions over stdio, with the environment scrubbed of host secrets on every spawn (§0.4). If you delete Apohara tomorrow, no upstream service has anything of yours to expire.

**Replay or it didn't happen.** Every meaningful event — task dispatch, provider request, tool call, verdict, ledger commit — is appended to a SHA-256 chained JSONL ledger. `apohara replay --verify` recomputes the chain end-to-end and rejects any tampering. A bug report that includes the relevant `replay.jsonl` is a reproducible bug report; the rest are guesses.

**The judge / critic / invariants gate is not optional.** Before any code Apohara wrote reaches a PR, a judge model must accept it against the spec, a critic model must find no blocking concerns, and the invariant suite (tests + schema + permission lattice) must be green. INV-15 is the gate; 2-of-3 majority does not ship. Loosening it is a fork, not a v1.x change. See [`PRINCIPLES.md`](PRINCIPLES.md).

## Install

**One-liner (Linux, macOS):**

```bash
curl -fsSL https://raw.githubusercontent.com/SuarezPM/Apohara/main/scripts/install.sh | sh
```

The installer probes `uname` for `linux-x64`, `linux-arm64`, `darwin-x64`, `darwin-arm64`, resolves the latest GitHub release tag, and drops the binary into `${APOHARA_PREFIX:-$HOME/.local}/bin`. Override the release with `APOHARA_VERSION=v1.0.0` and the destination with `APOHARA_PREFIX=/usr/local`. Exit codes are documented in the script header.

**Homebrew (macOS, Linuxbrew):**

```bash
brew install SuarezPM/apohara/apohara
```

The formula lives in [`packaging/homebrew/apohara.rb`](packaging/homebrew/apohara.rb). It pulls `bun`, `rust`, and `node` as build deps and ships a launchd service definition you can opt into with `brew services start apohara`.

**Manual download:**

Grab `apohara-desktop` for your platform from <https://github.com/SuarezPM/Apohara/releases>, `chmod +x` it, and move it onto `$PATH`. The SHA-256 of every release asset is published as a `.sha256` sidecar; verify with `sha256sum -c apohara-desktop.sha256` before running.

Apohara needs at least one of the three CLI providers reachable on `$PATH` (`claude`, `codex`, `opencode`). `apohara doctor` will tell you which are missing.

## Quick start

```bash
# 1. Verify the environment, one section at a time.
apohara doctor

# 2. Run the canonical setup task end-to-end (LOCAL-SETUP-001).
apohara verify-setup

# 3. Hand Apohara your first objective.
apohara plan "Add a /health endpoint that returns the git SHA"
```

`apohara doctor` walks seven sections — `runtime`, `roster`, `policy`, `sandbox`, `ledger`, `mcp`, `assigned` — and exits non-zero on the first failure. Pass `--json` for machine output, or `--skip-sandbox` (or any other section) to bypass a known-broken host check.

`apohara verify-setup` enrolls a fixture task that exercises the full pipeline: decomposer → provider spawn → sandbox execution → verification mesh (judge + critic + invariants) → ledger commit. If this is green, the wiring is good; if it fails, the section that failed tells you exactly which subsystem to fix.

`apohara plan` is the entry point for real work: it creates a SPEC document, dispatches it through the scheduler with the configured roster, and streams progress to the desktop UI (or `--headless` for CI).

## The three providers

Apohara drives three sanctioned CLI agents. Each lives behind `BaseAgentProvider` and is wrapped per spec §8.

| Provider id        | Driver binary | Role               | Get it from |
|--------------------|---------------|--------------------|-------------|
| `claude-code-cli`  | `claude`      | planner, critic    | [@anthropic-ai/claude-code](https://www.npmjs.com/package/@anthropic-ai/claude-code) |
| `codex-cli`        | `codex`       | coder              | [@openai/codex](https://www.npmjs.com/package/@openai/codex) |
| `opencode-go`      | `opencode`    | explorer, editor   | [sst/opencode](https://github.com/sst/opencode) |

Apohara never reads or forwards provider API keys. Each driver is spawned with sanitized env (§0.4), communicates over stdio, and is reconfigured per task via the canonical MCP config adapter (§8.8) in [`crates/apohara-mcp-bridge`](crates/apohara-mcp-bridge). The desktop roster lets you enable or disable any of the three per run; missing binaries are reported by `apohara doctor`, not silently dropped.

## What's in v1.0

The full inventory lives in [`CHANGELOG.md`](CHANGELOG.md). The headline shipments:

- Multi-agent scheduler on `bun:sqlite` with non-overlapping write manifests and decision-gate serialization on conflicting writes.
- Three CLI drivers (`claude-code-cli`, `codex-cli`, `opencode-go`) wired behind `BaseAgentProvider` with per-spawn MCP config injection.
- `apohara-sandbox` (seccomp-bpf + mount/user/PID/net namespaces) for untrusted runner execution.
- `apohara-indexer` (tree-sitter + redb + Nomic BERT embeddings); CI-safe via `APOHARA_MOCK_EMBEDDINGS=1`.
- SHA-256 chained event ledger with `apohara replay --verify`.
- Four internal MCP servers (`apohara.ledger`, `apohara.runs`, `apohara.indexer`, `apohara.settings`) on loopback with 32-char hex tokens and a 0600 endpoint-file handshake.
- `github-bridge` poll-only (GitHub App auth, no PAT) with three-strategy idempotent PR builder.
- Desktop UI (Tauri v2 + React 19): TaskBoard, Plans, Agent config, Permissions, Verification timeline.
- `apohara doctor` (7 sections, `--json`, `--skip-<section>`) and `apohara verify-setup` (LOCAL-SETUP-001).

INV-15 (judge + critic + invariants), the bash compound guard, deny-first permission resolution, and `enum_dispatch` providers are architectural commitments documented in [`PRINCIPLES.md`](PRINCIPLES.md) and [`ARCHITECTURE.md`](ARCHITECTURE.md).

## What's deferred

- **GitHub webhook receiver.** v1.0 ships poll-only (`github-bridge` reads issues on a timer). The webhook handler currently returns HTTP 501; the two-track delivery worker lands in v1.1 (§11.2).
- **Additional providers.** Cloud APIs and historical drivers (Gemini, Cursor, 21-provider router, Carnice-9B sidecar) are gated behind `APOHARA_LEGACY_PROVIDERS=1`. They are not part of the v1.0 INV-15 characterization. A fourth sanctioned provider is a major-version event, not a config toggle.
- **ContextForge GPU sidecar.** The optional KV-cache coordinator ships from a sibling repo. The integration test (`tests/integration/contextforge_regression.test.ts`) skips when the sibling checkout or `pytest` is missing.
- **`apohara-indexer` full-binary `cargo test`.** Runs OOM on 16 GB hosts (Nomic BERT weights are ~400 MB and `cargo test` spawns lib + integration binaries concurrently). Always run one binary at a time; mock with `APOHARA_MOCK_EMBEDDINGS=1` for CI.

## Links

- [`PRINCIPLES.md`](PRINCIPLES.md) — the six commitments that drove every "no" in v1.0
- [`CHANGELOG.md`](CHANGELOG.md) — full v1.0.0 release notes (Keep a Changelog 1.1.0)
- [`ARCHITECTURE.md`](ARCHITECTURE.md) — system diagram, request flow, crate map
- [`docs/github-app-setup.md`](docs/github-app-setup.md) — GitHub App registration for `github-bridge`
- [`docs/release-flow.md`](docs/release-flow.md) — pre-release to stable promotion procedure

## Download — one-line CTAs

The full install matrix (Linux one-liner, Homebrew, manual download) lives in [§Install](#install) above. For the impatient:

- **npx (no install):** `npx apohara doctor` then `npx apohara desktop` opens the local UI on `http://localhost:7331`.
- **From source:** `git clone https://github.com/SuarezPM/Apohara.git && cd Apohara && bun install && bun run build`.
- **Latest release:** grab `apohara-desktop` from [github.com/SuarezPM/Apohara/releases](https://github.com/SuarezPM/Apohara/releases) and `chmod +x` it.

After any path, `apohara doctor` (7 sections, each with actionable hints) confirms the three CLI drivers are wired and your env is sanitized.

## Footer

Apohara is built by [SuarezPM](https://github.com/SuarezPM) under the MIT license.
Issues, PRs, and adversarial security disclosures all welcome at
[github.com/SuarezPM/Apohara](https://github.com/SuarezPM/Apohara).

If something in v1.0 surprised you — good or bad — open an issue. Every audit in
`docs/superpowers/specs/` lists the inspirations and the disagreements; the goal is
that nothing about how Apohara behaves is hidden.

## License

MIT. See [`LICENSE`](LICENSE).
