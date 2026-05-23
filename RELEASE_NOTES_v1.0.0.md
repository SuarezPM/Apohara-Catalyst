# Apohara v1.0.0 — Release Notes (DRAFTS, NOT POSTED)

> **Status.** Tag `v1.0.0` exists locally (SHA `bad1715`) on
> `feat/apohara-ultimate`. The push and the social posts below are
> awaiting Pablo's go-ahead — nothing has been published yet.

---

## Headline

Apohara v1.0.0 is the first stable release of a local-first multi-AI
orchestrator that wraps three CLIs (Claude Code, OpenAI Codex, OpenCode)
into one workspace with a kanban UI, SSE replay, semantic conflict
detection, and a sandboxed runner — without OAuth, without cloud sync,
without API-key leaks to subprocesses.

## What's inside (one-paragraph each)

**Multi-AI orchestration via CLI wrappers.** Three providers,
one roster, switchable per task or per session. No OAuth flows — Apohara
shells out to the installed CLIs (`claude`, `codex`, `opencode`) and
strips the parent process's API keys before each spawn (§0.4). Provider
abstraction lives in `src/core/providers/` with `BaseAgentProvider` +
three drivers; CLI calls are serialized FIFO per binary to dodge
`~/.claude/`-style lock contention.

**Local-first kanban + SSE replay.** Every event lands in a JSONL ledger
that the React UI replays via Server-Sent Events with `Last-Event-ID`
resume and client-side dedupe. Mode toggle: GPU (local Tauri host) or
cloud (npx shim with a remote daemon). The dispatch path writes results
atomically (`mkstemp + rename`, §0.8) so a power loss never strands a
half-written result.

**Sandbox + permission model.** Rust workspace ships `apohara-sandbox`
(seccomp-bpf + namespaces on Linux, sandbox-exec on macOS, AppContainer
on Windows) plus `apohara-pathsafety` (symlink-escape detection) and a
permission grid the user can tighten per session.

**Cross-platform install.** `npx apohara@1.0.0` works on Linux
(x64 + arm64), macOS (Intel + Apple Silicon), and Windows
(x64 + arm64) — six prebuilt binaries with sha256 sidecars per release.

## By the numbers

- **1187 tests pass / 0 fail / 4 skip** on the gated suite
  (`tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts
  tests/npx-cli/ tests/e2e/fresh-machine-smoke.test.ts`).
- **3 pre-existing TypeScript errors** (`McpServer.ts:67`, `watcher.ts:53`)
  — unchanged from Sprint 6, tracked for v1.1 cleanup.
- **17 Rust crates** in the workspace, all building cleanly on
  ubuntu-22.04 + ubuntu-24.04 + macos-13 + macos-14 + windows-2022 across
  Node 20 + 22 (10-job CI matrix, fail-fast disabled).
- **0 secrets in env** — the sanitizer allowlist is the entire spec for
  what reaches a provider CLI subprocess.

## Operational expectations (post-publish)

When Pablo pushes the tag, two workflows trigger:

1. **`desktop-release.yml`** — Tauri builds 6 binaries per OS × arch,
   sha256-stamps each, and uploads the GitHub Release artifacts:
   `apohara-desktop-{linux,darwin,win32}-{x64,arm64}` + `.sha256` sidecars
   + Tauri bundles (`.dmg` × 2, `.deb` × 2, `.AppImage` × 2, `.msi` × 2,
   `.nsis` × 2).
2. **`npm-publish.yml`** — publishes the `apohara` shim to npm. After
   the publish, `npm install -g apohara@1.0.0` resolves; `apohara --version`
   prints `apohara 1.0.0`; the binary it downloads matches the published
   sidecar sha256.

Until the tag is pushed, **neither workflow fires** and no artifacts
exist. The plan's "verify artifacts post-trigger" steps (G7.F.3, G7.F.4)
become live the moment Pablo runs `git push --tags`.

---

## Twitter/X thread (5 tweets, draft)

> ⚠️ NOT POSTED. Awaiting Pablo's authorization.

**1/** Apohara v1.0.0 is here.

Multi-AI orchestrator that wraps the CLIs you already use
(Claude Code, OpenAI Codex, OpenCode) into one local-first kanban.

No OAuth. No cloud sync. Your keys never reach subprocesses.

A short thread on what's inside ⬇

**2/** Three providers, one roster.

Switch per task or per session. The CLI wrappers shell out to the
binaries you logged into yourself — Apohara strips API keys from the
spawn env so the wrong account never gets billed.

**3/** Local-first kanban with SSE replay.

Every event lands in a JSONL ledger the UI streams back with
`Last-Event-ID` resume + dedupe. Atomic writes (`mkstemp + rename`)
so a crash never leaves a half-written result.

**4/** Sandbox by default.

seccomp-bpf + namespaces on Linux, sandbox-exec on macOS,
AppContainer on Windows. Path-safety crate catches symlink escapes
before the dispatcher writes anywhere.

**5/** Install:

```
npx apohara@1.0.0
```

Six prebuilt binaries (Linux/macOS/Windows × x64/arm64) with sha256
sidecars. 1187 tests pass on the gated suite. Open issue at
github.com/SuarezPM/Apohara if anything breaks.

---

## HackerNews submission (draft)

> ⚠️ NOT POSTED. Awaiting Pablo's authorization.

**Title:** Apohara — Local-first multi-AI orchestrator (Claude/Codex/OpenCode CLIs, no OAuth)

**URL:** https://github.com/SuarezPM/Apohara

**Text:**

Hi HN — I've been building Apohara for the past few months and v1.0.0
just shipped. It's a local-first orchestrator that wraps three AI
coding CLIs (Claude Code, OpenAI Codex, OpenCode) into one workspace.

The thing I wanted but couldn't find: a way to use the CLI subscriptions
I already pay for (Claude Pro, ChatGPT Plus, etc.) from one tool without
giving that tool OAuth access to my account. Apohara shells out to the
installed CLIs directly and strips the parent env so API keys never
leak to subprocesses. No "wrong account billed" surprises (this is a
real failure mode — see CLAUDE.md "past incidents" section in the repo
for the postmortem).

A few design choices that might be of interest:

- **CLI wrappers, not API integrations.** Anthropic / OpenAI block
  programmatic OAuth wrapping in their TOS for several products.
  Apohara's compromise: if you can run `claude` interactively, Apohara
  can drive it. The wrapper layer is in `src/core/providers/`.

- **Local-first ledger.** Every event lands in a JSONL file. The UI
  replays it via SSE with `Last-Event-ID` resume. No database, no
  cloud, no telemetry beyond an opt-in anonymous install ID.

- **Sandbox by default.** Rust workspace ships `apohara-sandbox`
  (seccomp + namespaces on Linux, sandbox-exec on macOS, AppContainer
  on Windows). The dispatcher won't run a provider that wants
  filesystem access outside the workspace.

- **Three-CLI minimum.** I keep wanting to add more providers and
  keep refusing — the "active roster" is fixed at three to keep
  the surface area honest. Legacy providers (Cursor, Copilot, Codex
  older versions) are still in-tree behind `APOHARA_LEGACY_PROVIDERS=1`.

Tag: https://github.com/SuarezPM/Apohara/releases/tag/v1.0.0
Install: `npx apohara@1.0.0`
Docs: https://github.com/SuarezPM/Apohara/blob/main/docs/getting-started.md

Happy to answer questions. AMA.

---

## Reddit /r/programming + /r/rust (drafts)

> ⚠️ NOT POSTED. Awaiting Pablo's authorization.

**/r/programming title:** Apohara v1.0.0 — local-first multi-AI orchestrator that wraps CLI subscriptions instead of using OAuth

**Body:**

Released v1.0.0 of Apohara today. It's a desktop app + CLI that
orchestrates three AI coding tools (Claude Code, OpenAI Codex,
OpenCode) from a single workspace.

What makes it different from the existing orchestrators (cursor,
nimbalyst, etc.):

1. **No OAuth.** Apohara doesn't ask for an API key or a token. It
   wraps the CLI binaries you've already logged into. If you can run
   `claude` interactively, Apohara can drive it.
2. **Env sanitization.** Every subprocess spawn goes through an
   allowlist sanitizer. Your `ANTHROPIC_API_KEY` / `OPENAI_API_KEY`
   never reach the wrapped CLI — that prevents the "wrong account
   billed" failure I've seen reported elsewhere.
3. **Local-first ledger.** All events land in JSONL. UI replays via
   SSE with `Last-Event-ID` resume. No cloud sync.
4. **Sandbox-first.** Rust crate uses seccomp+namespaces (Linux),
   sandbox-exec (macOS), AppContainer (Windows). Dispatch refuses
   to spawn providers without a working sandbox.

Stack: Bun + TypeScript (UI + orchestrator), Rust workspace
(17 crates: types, secrets, sandbox, indexer, daemon, …), Tauri v2
desktop, npx shim CLI.

Install: `npx apohara@1.0.0`
Source: https://github.com/SuarezPM/Apohara

**/r/rust title:** Apohara v1.0.0 — 17-crate Rust workspace powering a multi-AI orchestrator (seccomp sandbox + ts-rs SSoT + token accounting)

**Body:**

Released v1.0.0 today. The TS side is documented elsewhere, but the
Rust workspace is what I'd want to flag for r/rust:

- `apohara-types` is the single source of truth for Rust ↔ TS
  shared structs. ts-rs derives the TS interfaces; the build step
  regenerates `packages/apohara-shared/types.ts` and CI fails on
  drift. No hand-written cross-language types.
- `apohara-sandbox` uses seccomp-bpf + user namespaces on Linux.
  The runner sanitizes env (per-process allowlist) before exec.
- `apohara-token-accounting` tracks LLM token usage in absolutes
  per thread (deltas drift across replays — absolutes don't).
- `apohara-indexer` is tree-sitter + redb + Nomic BERT. ~400 MB
  weights, so `cargo test -p apohara-indexer` has to run binaries
  one-at-a-time or it OOMs. Mock mode via
  `APOHARA_MOCK_EMBEDDINGS=1`.
- `enum_dispatch` instead of `Box<dyn>` for provider dispatch (per
  §0.16 in the spec — the perf delta isn't huge but the codegen is
  measurably cleaner in stack traces).

cargo-audit + cargo-deny (license allowlist) gate every PR. No
yanked deps, no GPL.

Source: https://github.com/SuarezPM/Apohara
Architecture doc: https://github.com/SuarezPM/Apohara/blob/main/docs/architecture.md

---

## LinkedIn personal post (draft)

> ⚠️ NOT POSTED. Awaiting Pablo's authorization.

I just shipped v1.0.0 of Apohara — a local-first multi-AI orchestrator
that wraps three CLI subscriptions (Claude Code, OpenAI Codex, OpenCode)
into a single workspace.

What I learned shipping it:

→ The hardest engineering problem in multi-AI tooling isn't the AI
side — it's keeping subprocess environments clean. Every spawn is a
potential API-key leak to the wrong account. Apohara's env sanitizer
is the single most load-bearing piece of code in the entire repo.

→ OAuth-wrapping is a non-starter for several providers (TOS
prohibits it). CLI wrappers are the path forward. If you're building
multi-provider tooling, plan around it from day one.

→ Local-first wins over cloud-first when the user is a developer.
Every "cloud sync" I've seen for dev tools introduced more failure
modes than it eliminated. Apohara is JSONL + SSE end-to-end. No
database. No cloud.

→ Test-driven development with parallel implementer agents lets you
ship faster than you can review. The discipline is the same — define
the contract before writing code, run the suite before committing —
but the throughput is 10× when you can fan out 5+ tasks at once.

Install: `npx apohara@1.0.0`
Repo: https://github.com/SuarezPM/Apohara

#opensource #ai #typescript #rust

---

## CHANGELOG link

Full release notes: [`CHANGELOG.md`](./CHANGELOG.md)

## How to install (post-publish)

```bash
# npx (works on any machine with Node ≥ 20)
npx apohara@1.0.0

# Global install
npm install -g apohara@1.0.0
apohara doctor    # diagnostics
apohara verify-setup    # full env check
```

## Verification expectations (G7.F.3 + G7.F.4)

After `git push --tags`:

1. `desktop-release.yml` runs. Verify the GitHub Release at
   `https://github.com/SuarezPM/Apohara/releases/tag/v1.0.0` has:
   - 6 binaries: `apohara-desktop-{linux,darwin,win32}-{x64,arm64}`
   - 6 sha256 sidecars: one `.sha256` per binary
   - Tauri bundles: 2 `.dmg`, 2 `.deb`, 2 `.AppImage`, 2 `.msi`, 2 `.nsis`
2. `npm-publish.yml` runs. Verify:
   - `npm install -g apohara@1.0.0` resolves
   - `apohara --version` returns `apohara 1.0.0`
   - The binary it downloads matches the published sidecar sha256

If either check fails post-trigger, do NOT post the announcements
below — debug first.

---

## Posting checklist (when Pablo approves)

- [ ] `git push origin feat/apohara-ultimate` (or merge to main first)
- [ ] `git push --tags v1.0.0`
- [ ] Wait for `desktop-release.yml` + `npm-publish.yml` to complete (~15-20 min)
- [ ] Verify GitHub Release artifacts (G7.F.3 expectations above)
- [ ] Verify npm publish (G7.F.4 expectations above)
- [ ] Post Twitter/X thread
- [ ] Submit HackerNews
- [ ] Post /r/programming
- [ ] Post /r/rust
- [ ] Post LinkedIn
- [ ] (Optional) Email the SuarezPM mailing list
