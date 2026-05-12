# Apohara — Project Handbook

> **The single-source-of-truth technical document.** Everything a new
> contributor needs to read once: what Apohara is, what stack runs it,
> what's shipped, what's pending, where the gaps are. README is the
> launch surface; ARCHITECTURE.md is the system diagram; this is the
> reference.
>
> Anchored at commit `bd819ed` (2026-05-12). When the code drifts, this
> document is wrong — open a PR to update it in place.

---

## Table of contents

0. [Reading guide](#0-reading-guide)
1. [Executive summary](#1-executive-summary)
2. [Mission & Vision](#2-mission--vision)
3. [The product — what Apohara does for the user](#3-the-product)
4. [Architecture — the big picture](#4-architecture)
5. [Stack reference — every layer](#5-stack-reference)
6. [The multi-AI orchestration model](#6-multi-ai-orchestration-model)
7. [Component reference](#7-component-reference)
8. [Security model](#8-security-model)
9. [Data model & contracts](#9-data-model)
10. [Roadmap — full milestone state](#10-roadmap)
11. [What's shipped today](#11-whats-shipped)
12. [What's left](#12-whats-left)
13. [Known gaps and limitations (honest)](#13-gaps)
14. [Development workflow](#14-development-workflow)
15. [Operational runbook](#15-operational-runbook)
16. [Appendix](#16-appendix)

---

## 0. Reading guide

This document is exhaustive — about 700 lines. Read in this order if you
are joining the project:

1. §1 + §2 (10 min): what + why.
2. §3 + §4 (15 min): the product surface and the system shape.
3. §6 (10 min): the *core* of the pitch — the multi-AI orchestration
   model. Most reviewers miss this and walk away thinking it's "another
   Cursor"; it isn't.
4. §10 + §11 + §12 (15 min): roadmap state + what's done + what's left.
5. §13 (5 min): the gaps. Read this BEFORE you commit to any timeline.
6. §7 + §8 + §9 (deep dive): pull these up when you touch the
   corresponding code area. Don't try to read them cold.
7. §14 + §15 (operational): kept short on purpose, copy-pasteable.

---

## 1. Executive summary

**Apohara** is an open-source multi-AI coding orchestrator. The user
writes a natural-language objective; Apohara decomposes it into a DAG of
microtasks; each microtask is dispatched to the AI provider that scores
highest for that role (planner, coder, verifier, …); the verification
mesh forces a *different* AI to audit the diff before it merges; every
action is recorded to a SHA-256-chained event ledger so the run is
cryptographically replayable.

Three concrete differentiators against the current crop of coding tools:

1. **Multiple AIs collaborate on the same task.** Cursor/Aider/Cline run
   one AI per session; Nimbalyst runs multiple sessions of single-AI
   agents; GSD2 routes within the Claude-ecosystem (Pi SDK).
   Apohara is provider-agnostic and routes *per microtask*.
2. **Bring-your-own-subscription CLI drivers.** The user does not need
   API keys — Apohara drives the official `claude`, `codex`, `gemini`
   CLIs as subprocesses, so auth stays inside each vendor's TOS.
3. **Kernel-level sandbox.** Every untrusted command runs inside a
   `seccomp-bpf` filter + `user/mount/PID` namespace bundle. A blocked
   syscall surfaces as a `security_violation` ledger event rather than
   a SIGSYS kill or, worse, silent damage to the host.

Optional booster: a parallel project, **Apohara · Context Forge**, runs
as a Python sidecar on a CUDA/ROCm GPU and provides KV-cache
deduplication across multi-agent calls. Measured 79.85% token savings
on a 5-agent benchmark (preprint, DOI [10.5281/zenodo.20114594](https://doi.org/10.5281/zenodo.20114594)).
Apohara works unchanged without it.

Current status (2026-05-12): **v0.1 alpha**. Visual orchestrator,
sandbox, CLI-driver providers, dual-arbiter verification, event ledger
v2 with hash chain, Tauri desktop binary at 5.6 MB raw / 1.9 MB deb /
78 MB AppImage — all shipping. End-to-end smoke test runs `apohara
auto --no-pr "write a file at /tmp/X containing Y"` → claude-code-cli
plans + executes → file written → 14 ledger events with SHA-256 chain →
33 seconds wall time → $0 tokens.

What remains is **content + release engineering**, not code. See §12.

---

## 2. Mission & Vision

### Mission

> Transform a natural-language objective into a swarm of LLM agents
> that decompose, execute, verify, and merge — visually, interactively,
> with cryptographically-replayable evidence at every step. The user
> types intent. The swarm builds the code while the user watches and
> steers. Multiple AIs collaborate on the same task; a different AI
> audits the result.

### Vision

| Horizon | Target |
|---|---|
| **v0.1 viral demo** | 90-second split-screen of 5 providers debating a refactor on the DAG canvas, verification mesh resolving in vivo, green PR landing. |
| **Repo of the Day** | 5K stars in 60 days post-launch. Honest realism in §13. |
| **v0.2 stretch** | Self-improvement loop — `apohara auto "implementá X en Apohara"` ships PR by itself. |
| **Acquisition zone** | $20–80M acqui-hire (Vercept playbook: Anthropic / Vercel / Cognition). See §13 for honest probability assessment. |
| **Distribution** | `curl \| sh` install, single binary < 15 MB. |

### Non-goals (deliberately not Apohara)

- **One-AI-in-your-editor**. That's Cursor / Continue / Aider / Cline.
- **Frontend for other agents**. That's Nimbalyst (a great tool — just
  not what Apohara is). Apohara has its own orchestrator.
- **Hosted SaaS**. Apohara is local-first. A future paid collab tier
  may add Cloudflare Workers + Durable Objects for team mode, but the
  core is always self-host.
- **Enterprise-only on AMD MI300X**. The MI300X path is a *capability*
  for users who happen to have one. The 95% case is consumer GPUs +
  the user's existing AI subscriptions.

---

## 3. The product

### What the user sees

The user opens `apohara-desktop` (Tauri binary or `bun --hot
packages/desktop/src/server.ts`). Three panes laid out left-to-right:

```
┌────────────┬──────────────────────────┬───────────────────────┐
│ Objective  │   Swarm Canvas (DAG)     │  Code + Diff          │
│  textarea  │   @xyflow/react nodes    │  file tree + Monaco   │
│            │   per task with state    │  diff editor          │
│ [Enhance ▾]│   classes + mesh sentinels  │  + mesh verdict     │
│ [Run ▶]    │                          │                       │
└────────────┴──────────────────────────┴───────────────────────┘
```

Top bar: `◈ Apohara` brand, session id once a run starts, **roster
picker** (the user toggles which AIs participate in this run), **cost
meter** showing cumulative tokens / USD / savings, **GPU/Cloud** routing
mode toggle.

### What happens when the user hits Run

1. **Prompt enhancement** — the planner LLM rewrites the prompt for
   clarity (`/api/enhance`). The user sees the rewritten version
   before committing.
2. **Decomposition** — the planner LLM emits a typed `Task[]` with
   `dependsOn` edges. The DAG appears live in the center pane.
3. **Scheduling** — `src/core/scheduler.ts` walks the DAG in topo
   order; each task is dispatched to the role-appropriate provider
   (planner / coder / critic / judge). Up to N tasks run in parallel
   in isolated git worktrees.
4. **Execution** — each task runs inside the seccomp+namespace
   sandbox. The agent's tool calls, file writes, and test runs are
   captured.
5. **Verification mesh** — `src/core/verification-mesh.ts` spawns
   two arbiters (a judge and a critic) from *different* providers
   than the coder. Both must approve before the diff is staged. The
   INV-15 safety gate (M015.4) forces a fresh context window when the
   judge's risk score exceeds the paper's τ threshold.
6. **Consolidation** — accepted diffs are squashed into the trunk
   branch; if `--no-pr` is unset, `gh` opens the PR with the run id
   in the body.
7. **Ledger seal** — every event in steps 1–6 was already streamed
   to `.events/run-<sid>.jsonl`. The file is a SHA-256 hash chain:
   `event[i].prev_hash === event[i-1].hash`. `apohara replay --verify`
   refuses to render if any link is broken.

### What the user can do at any moment

- **Pause** the run (planned; today a Ctrl-C on the CLI does the job).
- **Toggle the AI roster** mid-run — the next dispatched task respects
  the new set.
- **Replay** an old session by id: `apohara replay <run-id>` rebuilds
  the DAG and the diffs without re-calling any provider.

---

## 4. Architecture

The system has four runtime tiers. Top to bottom: desktop, core, Rust
sidecars, optional GPU sidecar.

```
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA DESKTOP  (Tauri v2, ~5.6 MB raw ELF, M017)                  │
│  React 19 + Geist + @xyflow/react + Monaco                           │
│  ├─ Objective pane    ┬─ Swarm Canvas (DAG)   ┬─ Code+Diff           │
│  └─────────────────── SSE stream from ledger ─────────────────────── │
└──────────────────────────────────────────────────────────────────────┘
                              ↕ HTTP (localhost:7331)
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA CORE  (TypeScript on Bun)                                   │
│  Bun.serve() ──► /api/enhance · /api/run · /api/events (SSE)         │
│              ──► /api/mode · /api/roster · /api/health (Gap 1+M015.5)│
│  ┌─ src/core/ ──────────────────────────────────────────────────┐    │
│  │ decomposer · scheduler · subagent-manager · consolidator      │    │
│  │ verification-mesh · agent-router · ledger (Phase 4 hash chain)│    │
│  │ capability-manifest · capability-stats (M013)                 │    │
│  │ sandbox (TS wrapper) · indexer-client · contextforge-client   │    │
│  └─────────────────────────────────────────────────────────────  ┘    │
│  src/providers/ — router.ts (21 cloud) + cli-driver.ts (4 CLIs)      │
└──────────────────────────────────────────────────────────────────────┘
                              ↕ subprocess + Unix sockets
┌──────────────────────────────┬───────────────────────────────────────┐
│  apohara-indexer (Rust) ✅   │  apohara-sandbox (Rust) ✅ M014       │
│  tree-sitter + redb +        │  seccomp-bpf + user/mount/PID ns      │
│  Nomic BERT embeddings       │  3-tier permission profiles           │
│  Daemon, Unix socket RPC     │  Per-process fork chain (M014.4)      │
└──────────────────────────────┴───────────────────────────────────────┘
                              ↕ HTTP :8001 (optional)
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA CONTEXT FORGE  (parallel repo, optional)                    │
│  FastAPI + vLLM bridge + INV-15 safety gate                          │
│  60–80% token savings, CUDA/ROCm GPU                                 │
└──────────────────────────────────────────────────────────────────────┘
```

### Process topology at runtime

When the user runs `bun --hot packages/desktop/src/server.ts`:

- **PID A** — Bun.serve on :7331 (web server + React HMR + SSE).
- **PID B** — `apohara-indexer` daemon (Rust binary, Unix socket RPC).
- **PID C..N** — per-task `apohara-sandbox` subprocesses (Rust binary,
  short-lived, double-forked into the new namespace bundle).
- **PID local-LLM** — optional `llama-cpp-python` on :8000.
- **PID context-forge** — optional Python sidecar on :8001.

PIDs A and B are long-lived. PIDs C..N are short-lived. The CLI drivers
(`claude`, `codex`, `gemini`) spawn one subprocess per LLM turn and exit.

---

## 5. Stack reference

### Languages & runtimes

| Concern | Choice | Why |
|---|---|---|
| Orchestrator | **TypeScript on Bun 1.3.13** | Speed (Bun.serve), zero-config TS, native SQLite/Redis if needed. Pinned to 1.3.13 — `latest` (1.4.x) regressed `fs.promises.appendFile` await timing and surfaced as ENOENT in EventLedger Phase 4 tests. |
| Desktop shell | **Tauri v2** | ~6 MB bundle vs 200 MB Electron. Native FS access. Bun.serve as the HTTP backend speaks to the React SPA over `localhost:7331`. |
| Frontend | **React 19** + `@xyflow/react` 12 + `@monaco-editor/react` 4 | The DAG canvas wants `@xyflow/react`; the diff pane wants Monaco; both are MIT and battle-tested. |
| Sandbox | **Rust** + `seccompiler` 0.5 + `nix` 0.30 + `libc` | Kernel-level enforcement; the only way to do this on Linux. |
| Indexer | **Rust** + `tree-sitter` + `redb` + `candle` (Nomic BERT) | Tree-sitter for 18 languages; redb is zero-deps embedded KV; candle runs the BERT embeddings model. |
| Optional GPU sidecar | **Python 3.12** + FastAPI + vLLM | The ContextForge paper's reference implementation. |

### Visual identity

| Token | Value |
|---|---|
| Dark default | `#0a0a0f` background, `#111118` surface |
| Cyan accent (agent activity) | `#6ee7f7` |
| Violet accent (verification mesh) | `#a78bfa` |
| Success / warning / error | `#4ade80` / `#fbbf24` / `#f87171` |
| Font | Geist Mono + Geist Sans |

Locked in `packages/desktop/src/index.css`. Inspiration: Linear,
Vercel, Raycast.

### Dependencies (key ones)

| Dependency | Version | Where |
|---|---|---|
| `react` / `react-dom` | ^19 | `packages/desktop` |
| `@xyflow/react` | ^12 | `packages/desktop` (DAG visualization) |
| `@monaco-editor/react` | ^4 | `packages/desktop` (diff viewer) |
| `@tauri-apps/cli` | ^2.11 | dev dep, drives `bun run tauri:build` |
| `tauri` (Rust) | ^2 | `packages/desktop/src-tauri` |
| `seccompiler` (Rust) | 0.5 (with `json` feature) | `crates/apohara-sandbox` |
| `nix` (Rust) | 0.30 | `crates/apohara-sandbox` |
| `commander` | ^14 | TS CLI (`apohara` binary) |
| `zod` | ^4 | input validation in core |
| `@playwright/test` | 1.60 | `packages/desktop` e2e (uses system Chrome) |

### CLI drivers shipped (the user installs these themselves)

| Driver | npm package | Binary | Auth |
|---|---|---|---|
| `claude-code-cli` | `@anthropic-ai/claude-code` | `claude` | User's Claude subscription (one-time `claude login`) |
| `codex-cli` | `@openai/codex` | `codex` | User's ChatGPT/Codex subscription |
| `gemini-cli` | `@google/gemini-cli` | `gemini` | User's Google account |
| `opencode-go` (extra) | `sst/opencode` | `opencode` | Vendor-agnostic; can host MiniMax, etc. |

---

## 6. Multi-AI orchestration model

This is the **core of the pitch**. Most reviewers skim it because every
project promises "AI orchestration"; the part that's actually
distinctive is **what gets routed where** and **who verifies**.

### Three orthogonal axes the router considers

1. **TaskRole** (`src/core/types.ts`): `research`, `planning`,
   `execution`, `verification`. Set by the decomposer based on the
   task it just emitted.
2. **TaskType** (`src/core/capability-manifest.ts`): `research`,
   `planning`, `codegen`, `debugging`, `verification`. Slightly finer
   grain — `execution` role can map to `codegen` or `debugging`.
3. **Available providers** (`src/core/agent-router.ts`
   `getAvailableProviders`): the providers whose `TOKEN_VALIDATORS`
   return true. For API providers, "has a key"; for CLI drivers,
   always true (auth is inside the CLI).

### The routing decision

`routeTaskWithFallback(role, task, router)` in `agent-router.ts:140`:

```
1. Compute fallback chain from ROLE_FALLBACK_ORDER[role].
2. Get available providers from TOKEN_VALIDATORS.
3. Call selectBestProvider(available, taskType) — capability-manifest
   returns the provider with the highest score for taskType from the
   intersection.
4. Reorder fallback so the capability-best provider leads.
5. Apply user's roster filter — if the user disabled some providers
   via the RosterPicker, those are removed from the chain.
6. Call router.completion({ messages, provider }) with the head of the
   chain. If it fails (timeout, 429, ENOENT for a CLI), cooldown that
   provider for N seconds and try the next.
```

The CLI drivers have **deliberately higher capability scores** than the
API equivalents (planner role: `claude-code-cli` 0.94 vs `anthropic-api`
0.85) because they're free for the user — the system prefers the
subscription path when both are available.

### The verification mesh — what makes it "multi-AI" vs "fallback"

A single-AI router with fallback chains is still fundamentally one AI
per task. The verification mesh in `src/core/verification-mesh.ts`
breaks this:

- After the coder LLM emits a diff, the mesh asks **two arbiters from
  different providers**: a `judge` (rejects logic errors / scope
  drift) and a `critic` (rejects style / maintainability issues).
- Defaults: judge = `gemini-cli`, critic = `claude-code-cli`, coder =
  `codex-cli` or whatever ROLE_FALLBACK_ORDER picked. The
  `ROLE_TO_PROVIDER` map in `types.ts` codifies this cross-vendor bias
  by design.
- The **INV-15 safety gate** (M015.4) inspects the judge's confidence;
  if it's above τ (paper's threshold), the verifier is fed a *fresh*
  context window so KV-cache reuse can't smuggle in a corrupted prior.
  17 tests cover the paper's Table 1 sweep.

### Thompson Sampling layer (M013, post-v0.1)

`src/core/capability-stats.ts` persists per-`(provider, role)`
success/failure counts to `.apohara/capability-stats.json` (Beta(α,β)
distribution priors α₀=β₀=2). `apohara stats` prints the rankings.
Wiring this into `ProviderRouter.completion()` for live exploration is
**M013.3 — pending follow-up**. Today the router uses static capability
scores; the live-learning layer ships with the math and persistence but
isn't yet consumed by the routing decision.

### The roster picker (Gap 1, shipped 2026-05-12)

`packages/desktop/src/components/RosterPicker.tsx` is a popover in the
top bar that lets the user toggle which providers participate. The set
is mirrored to `localStorage["apohara.providerRoster"]`,
POSTed to `/api/roster`, and forwarded on every `/api/enhance` and
`/api/run` request via the `X-Apohara-Roster` header. The server holds
the canonical view in `providerRoster: Set<string>` and the
`pickEnhanceProvider(mode, roster)` helper walks a mode-appropriate
preference order, only choosing providers the roster permits.

---

## 7. Component reference

### 7.1 `packages/desktop/`

Tauri v2 + React 19 + Bun.serve. The user-facing surface.

```
packages/desktop/
├── index.html                 ← Bun HTML-import entry (dev)
├── package.json
├── playwright.config.ts       ← M017.10 e2e config, system Chrome
├── scripts/build.ts           ← Production bundle + dist/index.html
├── src/
│   ├── main.tsx               ← React entry
│   ├── App.tsx                ← Three-pane layout owner
│   ├── server.ts              ← Bun.serve backend + SSE + 5 API routes
│   ├── index.css              ← Visual identity tokens + pane chrome
│   ├── components/
│   │   ├── ObjectivePane.tsx  ← Textarea + Enhance + Run + error banner
│   │   ├── SwarmCanvas.tsx    ← @xyflow/react DAG, state classes
│   │   ├── CodeDiffPane.tsx   ← Monaco DiffEditor + file tree + verdicts
│   │   ├── CostMeter.tsx      ← tokens / USD / savings + GPU/Cloud toggle
│   │   └── RosterPicker.tsx   ← (Gap 1) per-run roster popover
│   ├── hooks/
│   │   └── useLedgerStream.ts ← EventSource SSE subscription
│   └── lib/
│       └── types.ts           ← Frontend-side EventLog mirror
├── src-tauri/                 ← Tauri 2 Rust shell + capabilities + icons
└── tests/e2e/smoke.spec.ts    ← Playwright 4 tests (3-pane + Run + roster + mode)
```

### 7.2 `src/core/`

The orchestrator brain. TypeScript on Bun.

| Module | Responsibility |
|---|---|
| `decomposer.ts` | NL prompt → typed `Task[]` with `dependsOn` edges. Cycle detection (DFS). Indexer context injection. |
| `scheduler.ts` | Topo-walk the DAG; spawn one worktree per task in `.claude/worktrees/`. |
| `subagent-manager.ts` | Per-task agent loop. Retry budgets, escalation, role-aware prompts. |
| `consolidator.ts` | Merge accepted diffs into trunk. Optionally open PR via `gh`. |
| `verification-mesh.ts` | Dual-arbiter (judge + critic). INV-15 safety gate. Drift detection. |
| `agent-router.ts` | Role → provider mapping with fallback chains. Calls into the capability manifest + ROSTER filter. |
| `ledger.ts` | Phase-4 SHA-256-chained JSONL event log. `verify()` rebuilds the chain to detect tampering. |
| `capability-manifest.ts` | Static per-provider per-task scores. Source of `selectBestProvider`. |
| `capability-stats.ts` | (M013) Runtime success/failure counts + Thompson-Sampling math. Persistence + `rank()` API. |
| `sandbox.ts` | TS wrapper around the Rust sandbox binary. Non-Linux consent fallback (M014.6). |
| `indexer-client.ts` | Unix-socket JSON-RPC to the indexer daemon. |
| `contextforge-client.ts` | Best-effort HTTP client to the parallel ContextForge service. |
| `memory-injection.ts` | Pulls relevant indexer memories into the decomposer's prompt. |
| `types.ts` | `ProviderId`, `TaskRole`, `TaskType`, `ROLE_TO_PROVIDER`, `ROLE_FALLBACK_ORDER`, `MODELS`. |

### 7.3 `src/providers/`

`router.ts` (~1700 LOC) holds 21 cloud-provider implementations and the
routing/fallback machinery. Each provider has a `call*` method
implementing its HTTP shape (Anthropic Messages, OpenAI completions,
DeepSeek, Gemini generateContent, Groq, MiniMax, etc.).

`cli-driver.ts` (new in Gap 2, 2026-05-12) holds the CLI-driver
framework: `CliDriverConfig` interface, `BUILTIN_CLI_DRIVERS` array
(claude-code-cli / codex-cli / gemini-cli), `loadCliDriverRegistry()`
that merges built-ins with `APOHARA_CLI_DRIVERS_CONFIG` user overrides,
and `callCliDriver(cfg, messages)` that spawns the binary + reads
stdout + handles ENOENT/non-zero/timeout cleanly. ANSI escapes are
stripped by default.

### 7.4 `crates/apohara-sandbox/`

Rust crate. The kernel-level enforcement boundary.

```
crates/apohara-sandbox/
├── Cargo.toml                          ← seccompiler 0.5 (json), nix 0.30, libc
├── src/
│   ├── lib.rs                          ← module entry
│   ├── error.rs                        ← SandboxError + Result
│   ├── permission.rs                   ← PermissionTier enum + parse/display
│   ├── namespace.rs                    ← enter_isolated_namespaces() (M014.3)
│   ├── profile.rs                      ← Profile trait + for_tier resolver
│   ├── profile/
│   │   ├── syscalls.rs                 ← Per-tier syscall allowlists
│   │   ├── linux.rs                    ← Real seccomp-bpf compilation (M014.2)
│   │   └── fallback.rs                 ← Non-Linux no-op
│   ├── runner.rs                       ← SandboxRequest / SandboxResult
│   ├── runner/imp.rs                   ← Linux 2-fork runner chain (M014.4)
│   └── main.rs                         ← apohara-sandbox CLI binary
├── tests/
│   ├── seccomp_enforcement.rs          ← M014.2 verify gate (4 tests)
│   ├── namespace_isolation.rs          ← M014.3 verify gate (2 tests)
│   └── runner_e2e.rs                   ← M014.4 verify gate (4 tests)
```

Test count: **31** (21 lib + 4 seccomp + 2 namespace + 4 runner). All
green on x86_64. See §8.1 for the security model.

### 7.5 `crates/apohara-indexer/`

Rust daemon. Owns the codebase knowledge graph.

- **Storage:** `redb` (embedded KV, zero deps).
- **Parsing:** tree-sitter for 18 languages, watch-driven.
- **Embeddings:** Nomic BERT via `candle`. Tests gate the model
  behind `APOHARA_MOCK_EMBEDDINGS=1` to avoid OOM in CI
  (`CLAUDE.md §8.1`).
- **API:** Unix-socket JSON-RPC. Methods:
  `searchMemories(query, k)`, `getBlastRadius(file, symbol)`,
  `listSymbols`, etc.

### 7.6 `apohara-context-forge` (parallel repo)

[`SuarezPM/Apohara_Context_Forge`](https://github.com/SuarezPM/Apohara_Context_Forge)
— FastAPI service. KV-cache coordinator across multi-agent calls.

- Sidecar URL: `localhost:8001` by default.
- `register_context(text) → handle` before inference.
- `get_optimized_context(handles[]) → compressed_text` for shared
  prompts.
- Implements the **INV-15 safety invariant** referenced by the
  verification mesh.

Apohara works unchanged when `CONTEXTFORGE_ENABLED` is unset. Every
call is best-effort and falls back to the raw context on any failure.

---

## 8. Security model

### 8.1 Sandbox — `crates/apohara-sandbox`

Every untrusted command (test runs, `bun install`, agent-generated
binaries) runs through `apohara-sandbox` as a separate process. The
isolation is **3-layered**:

**Layer 1 — User + mount + PID namespace bundle** (M014.3,
`src/namespace.rs`):

```rust
unshare(CLONE_NEWUSER | CLONE_NEWNS | CLONE_NEWPID);
write_proc_self("setgroups", "deny");
write_proc_self("uid_map", &format!("0 {host_uid} 1"));
write_proc_self("gid_map", &format!("0 {host_gid} 1"));
```

Why all three: plain `CLONE_NEWNS`/`CLONE_NEWPID` need
`CAP_SYS_ADMIN`. Bundled with `CLONE_NEWUSER` they become accessible
to unprivileged users on any kernel with
`unprivileged_userns_clone=1`. After the unshare, the next forked
child sees PID 1 in its own namespace and cannot enumerate or signal
host processes.

**Layer 2 — seccomp-bpf filter per permission tier** (M014.2,
`src/profile/`):

| Tier | Use case | Behavior |
|---|---|---|
| `ReadOnly` | Test introspection, code reading, dry-run analysis | Open(2) restricted to access mode `O_RDONLY` via masked_eq. No `write`, no `execve`, no fork/exec, no network. |
| `WorkspaceWrite` | Default agent execution | ReadOnly's set + `write`, `pwrite64`, `mkdirat`, `unlinkat`, `renameat2`, `execve`, `clone3`. `fcntl` cmd limited to `F_GETFL/F_SETFL/F_DUPFD/F_DUPFD_CLOEXEC`. `ioctl` request limited to `TIOCGWINSZ/FIOCLEX/FIONCLEX`. |
| `DangerFullAccess` | `--i-know-what-im-doing` mode | No filter installed. Only used for self-improve mode and explicit user opt-in. |

Default mismatch action: `errno(EPERM)` (not SIGSYS). This means the
agent observes a normal failure and Apohara records a
`security_violation` event, rather than the agent dying with no
context. Hard-forbidden (never in any allowlist): `ptrace`,
`process_vm_readv/writev`, `perf_event_open`, `mount`, `umount2`,
`pivot_root`, `unshare`, `setns`, `fork`, `vfork`, `kexec_load`,
`init_module`, `delete_module`, `reboot`, `sethostname`, `swapon`,
`swapoff`.

**Layer 3 — Runner fork chain** (M014.4, `src/runner/imp.rs`):

```
parent (orchestrator)
   │  pipes: stdout, stderr, exec-error (CLOEXEC)
   │  fork()
   │
   │  read pipes + waitpid(middle)
   │            ▼
   │          middle child
   │            │  enter_isolated_namespaces() [M014.3]
   │            │  fork()
   │            │
   │            │  waitpid(grand) + _exit(grand.status)
   │            │            ▼
   │            │          grandchild   ← PID 1 in new pid-ns
   │            │            │  dup2 stdout/stderr to pipes
   │            │            │  chdir(workdir)
   │            │            │  profile.install() [M014.2 seccomp]
   │            │            │  execvp(command)
```

The exec-error pipe is `O_CLOEXEC`. A successful `execvp` closes it
(EOF for the parent → "exec ok"). A failed `execvp` writes 4 bytes of
errno first, so the parent surfaces a clean `execve_failed(errno=X)`
violation. Under ReadOnly, the grandchild's `write` syscall is itself
blocked, so the parent infers `execve_failed(errno=unknown)` from
exit_code=126 + empty pipe.

### 8.2 Non-Linux fallback (M014.6)

On macOS / Windows / WSL2, the Rust sandbox is unavailable. The TS
wrapper `Isolator.execBypassNonLinux` gates execution behind an
explicit consent flag:

- Without `APOHARA_ALLOW_UNSANDBOXED=1`: returns `exitCode=99`,
  `error="sandbox_unavailable"`, and emits
  `security_violation(syscall="sandbox_unavailable_no_consent")` to
  the ledger. **No host execution happens.**
- With consent: runs the command directly via `spawn`. Emits
  `sandbox_bypassed` to the ledger recording the platform,
  permission tier, exit code, and workdir. Audit trail stays
  complete.

`APOHARA_FORCE_NONLINUX=1` is a hidden test hook so this path is
reachable from a Linux dev box.

### 8.3 Verification mesh — `src/core/verification-mesh.ts`

After the coder emits a diff:

1. **Judge** (cross-vendor from coder) inspects the diff for logic
   errors, scope drift, security issues. Outputs a JSON verdict
   + risk score.
2. **INV-15 safety gate** — if `judge.risk > τ` (paper's threshold),
   the verifier is fed a fresh context window. This prevents
   KV-cache reuse from smuggling in a corrupted prior. 17 tests
   in `tests/inv15.test.ts` cover the paper's Table 1 sweep +
   Theorem 1 (zero violations) + Section 5.4 critic dense rate 1.0.
3. **Critic** (cross-vendor from both coder and judge) inspects the
   same diff for style, maintainability, and test coverage. Outputs
   the same JSON verdict shape.
4. Both must approve. A `mesh_verdict` event is logged for each.

If the judge or critic rejects, the diff goes back to the coder with
the rejection reason. After N retries (configurable), the task fails
and the worktree is destroyed.

### 8.4 Event ledger — `src/core/ledger.ts`

Every meaningful action emits one JSON line to `.events/run-<sid>.jsonl`:

```
{ id, timestamp, type, severity, taskId?, payload, metadata?, prev_hash, hash }
```

`hash = SHA-256(prev_hash || canonical_json(event_without_hashes))`.
Genesis block: `prev_hash = "0"*64`.

`EventLedger.verify(filePath)` walks the chain and returns either
`{ ok: true, legacy: false, events: n }` or `{ ok: false, brokenAt: i,
reason }`. Tamper detection is exact: changing any character of any
payload invalidates the chain at the first modified line.

`apohara replay <run-id>` rebuilds the entire run state from the
ledger without calling any provider. `apohara replay --dry-run --json`
emits the canonical action plan for diff comparison across machines.

---

## 9. Data model

### 9.1 ProviderId (the enum)

`src/core/types.ts` defines the closed set of every provider Apohara
knows about:

```
"opencode-go" | "anthropic-api" | "gemini-api" | "deepseek-v4" |
"deepseek" | "tavily" | "gemini" | "moonshot-k2.5" | "moonshot-k2.6" |
"xiaomi-mimo" | "qwen3.5-plus" | "qwen3.6-plus" | "minimax-m2.5" |
"minimax-m2.7" | "glm-deepinfra" | "glm-fireworks" | "glm-zai" |
"groq" | "kiro-ai" | "mistral" | "openai" | "carnice-9b-local" |
"claude-code-cli" | "codex-cli" | "gemini-cli"
```

= **25 providers**. Adding a new one requires touching:

- `ProviderId` union in `types.ts`
- `MODELS` (`ModelCapability[]`) for capability scoring
- `CAPABILITY_MANIFEST` in `capability-manifest.ts` for per-task scores
- `TOKEN_VALIDATORS` in `agent-router.ts` (auth probe)
- `API_ENDPOINTS` + `MODEL_NAMES` + a `call<Provider>()` method in `router.ts`
  (or, for a CLI driver, just an entry in `BUILTIN_CLI_DRIVERS` in `cli-driver.ts`)
- `costMap` in `verification-mesh.ts` (for cost-aware ranking)
- `RosterPicker.tsx` (so the user can toggle it in the UI)

### 9.2 TaskRole vs TaskType

Two related but distinct concepts:

- **TaskRole** (4): `research`, `planning`, `execution`, `verification`.
  Set by the decomposer; consumed by `routeTaskWithFallback`.
- **TaskType** (5): `research`, `planning`, `codegen`, `debugging`,
  `verification`. Consumed by capability scoring. `execution` role can
  map to either `codegen` or `debugging` taskType based on heuristics
  in `agent-router.ts roleToTaskType()`.

### 9.3 Event types (non-exhaustive)

The ledger speaks a vocabulary of event types. The current vocabulary
(grouped by phase):

| Phase | Types |
|---|---|
| Session lifecycle | `session_started`, `auto_command_started`, `auto_command_completed`, `genesis` |
| Decomposition | `decomposer_complete`, `decomposition_completed`, `indexer_context_injected` |
| Provider | `provider_selected`, `llm_request`, `provider_failed`, `provider_cooldown` |
| Cost / savings | `contextforge_savings` (with `costUsdLocal`, `costUsdBaselineEstimate`) |
| Task lifecycle | `task_scheduled`, `task_completed`, `task_failed`, `task_retry` |
| File diffs | `file_created`, `file_modified`, `file_deleted` |
| Verification | `mesh_verdict`, `inv15_gate_decision`, `judge_response`, `critic_response` |
| Sandbox | `sandbox_execution`, `security_violation`, `sandbox_bypassed`, `sandbox_unavailable` |
| Consolidation | `consolidation_started`, `consolidation_completed`, `branch_creation_failed`, `lint_applied` |
| GitHub | `github_pr_opened`, `github_pr_skipped` |
| Summary | `summary_generated` |
| Role | `role_assignment` |

### 9.4 Capability scoring

`CAPABILITY_MANIFEST` in `capability-manifest.ts` is an array of
`ProviderCapability` records:

```typescript
{
  provider: ProviderId;
  scores: { research: number; planning: number; codegen: number;
            debugging: number; verification: number };  // 0..1
  sources: string[];                                     // benchmark refs
  lastUpdated: string;                                   // ISO
}
```

Scores are intentionally biased: **CLI drivers score slightly above
their API equivalents** (e.g. `claude-code-cli.planning = 0.94`
vs `anthropic-api.planning = 0.85`) so capability-driven selection
prefers the no-key path when both are available.

`apohara stats` (M013.5) prints a per-role table or `--json`:

```
# planning
rank provider                 score   succ_rate  trials
-------------------------------------------------------
1    claude-code-cli          0.953     50.0%       0
2    codex-cli                0.921     50.0%       0
3    deepseek-v4              0.889     50.0%       0
...
```

`score` here is a **single Thompson-Sampling draw** from
`Beta(α₀+successes, β₀+failures)`. Each invocation produces fresh
draws; the variance does the explore/exploit balancing.

---

## 10. Roadmap

The canonical roadmap is `ROADMAP.md` at the repo root. This is its
state as of `bd819ed` (2026-05-12).

### Phases 1–4 — legacy, all ✅

| Phase | Capability |
|---|---|
| 1 | Credentials tracer-bullet (CLW-CRED-001 fixed) |
| 2 | Auth CLI (Gemini OAuth working; Anthropic blocked by TOS) |
| 3 | Vibe DAG hardening (real DAG, cycle detection in `decomposer.ts`) |
| 4 | Event Ledger v2 (SHA-256 chain + `apohara replay`) |

### M010 — Context Compression ✅

Tree-sitter based context compression in `apohara-indexer`.

### M011 — Long-Term Memory ✅

`redb` + Nomic BERT embeddings. Mem0 dependency removed.

### M013 — Thompson Sampling (post-v0.1) — 3/5 ✅

| # | Status | Detail |
|---|---|---|
| 13.1 persist counts | ✅ | `capability-stats.ts`: `.apohara/capability-stats.json` store with lazy load + write queue. |
| 13.2 Beta math | ✅ | Marsaglia–Tsang Gamma + Box–Muller normal. `sampleBeta(α,β)`. 7 tests. |
| 13.3 router wiring | 🔴 | Surface ready (`CapabilityStats.rank/.sample`) but not consumed by `router.ts`. Follow-up. |
| 13.4 kv_share_friendliness | 🔴 | Depends on M013.3 + telemetry plumbing from `contextforge_savings`. |
| 13.5 `apohara stats` | ✅ | CLI command, ASCII table + `--json` + `--role` + `--file`. |

### M014 — apohara-sandbox real — 6/6 ✅

| # | Status | Detail |
|---|---|---|
| 14.1 scaffold + deps | ✅ | 8/8 lib tests. |
| 14.2 seccomp-bpf 3-tier | ✅ | `seccompiler::compile_from_json`. ReadOnly's `openat` constrained to `O_RDONLY` via `masked_eq`. 4 integration tests. |
| 14.3 user+mount+PID ns | ✅ | `enter_isolated_namespaces()`. 2 integration tests. |
| 14.4 fork-chain runner | ✅ | Parent → middle child unshares → grandchild seccomp+execvp. CLOEXEC exec-error pipe. 4 integration tests. |
| 14.5 violation events | ✅ | `Isolator.logExecution` emits `security_violation` per violation. |
| 14.6 non-Linux fallback | ✅ | `APOHARA_ALLOW_UNSANDBOXED=1` consent gate + `sandbox_bypassed` audit. 3 tests. |

### M015 — ContextForge integration — 6/6 ✅

| # | Status | Detail |
|---|---|---|
| 15.1 Carnice-9b local provider | ✅ | `router.ts` calls llama-cpp-python OpenAI-compat on `:8000`. |
| 15.2 ContextForge HTTP client + router/scheduler hooks | ✅ | `contextforge-client.ts`. |
| 15.3 `contextforge_savings` ledger event | ✅ | Emitted from `router.ts:1588`. |
| 15.4 INV-15 safety gate port | ✅ | 17 tests covering paper Table 1 + Theorem 1 + §5.4. |
| 15.5 UI GPU/Cloud toggle | ✅ | `CostMeter.tsx` + `/api/mode` + localStorage. |
| 15.6 docs | ✅ | README ContextForge section. |

### M017 — apohara-desktop — 10/10 ✅

| # | Status | Detail |
|---|---|---|
| 17.1 Tauri v2 scaffold | ✅ | `packages/desktop/src-tauri/`. |
| 17.2 API routes + SSE | ✅ | `/api/enhance`, `/api/run`, `/api/session/:id/events`. |
| 17.3 Objective pane | ✅ | Textarea + Enhance + Run + error banner. |
| 17.4 Swarm Canvas | ✅ | `@xyflow/react` DAG with state classes + mesh sentinels. |
| 17.5 Code+Diff Monaco | ✅ | DiffEditor + file tree + verdict panel. |
| 17.6 Cost meter + GPU/Cloud toggle | ✅ | Tokens, USD, savings; GPU/Cloud radio toggle. |
| 17.7 Visual identity | ✅ | Geist + cyan/violet + xyflow dark theme. |
| 17.8 Tauri build → single binary | ✅ Linux | 5.6 MB raw / 1.9 MB deb / 78 MB AppImage. macOS/Windows: CI matrix wired but not yet run on hosted runners. |
| 17.9 Archive packages/tui | 🟡 marker | README + ROADMAP entry. Physical deletion gated on M017.10 + dashboard rewire. |
| 17.10 Playwright E2E | ✅ | 4 tests. Uses system Chrome on the dev box (Playwright doesn't ship for ubuntu26.04-x64). |

### Phase 6 — v0.1 ship — wiring done

| # | Status | Detail |
|---|---|---|
| 6.1 Cross-OS Tauri matrix | ✅ wiring | `.github/workflows/desktop-release.yml` matrix on ubuntu/macos/windows. First hosted run pending tag. |
| 6.2 90-sec viral demo video | 🔴 | User-side content shoot. |
| 6.3 README + ARCHITECTURE.md | ✅ | README hero rewrite + ARCHITECTURE.md (new). |
| 6.4 HN / Twitter / arXiv launch | 🔴 | User-side coordination. |
| 6.5 Discord beta channel | 🔴 | User-side. |
| 6.6 Release + Homebrew + curl\|sh | 🟡 templates | `scripts/install.sh` + `packaging/homebrew/apohara.rb` skeleton. Real SHA256s rendered at tag time. |

### Multi-AI orchestration gaps (closed 2026-05-12)

| Gap | Status |
|---|---|
| Gap 1 — UI roster selector | ✅ `RosterPicker.tsx` + `/api/roster` + `X-Apohara-Roster` header. |
| Gap 2 — CLI driver framework | ✅ `cli-driver.ts` + 3 built-in drivers + `BUILTIN_CLI_DRIVERS` + `APOHARA_CLI_DRIVERS_CONFIG` overrides. |
| Gap 3 — README narrative | ✅ "first open-source multi-AI coding orchestrator" hero. |

### M018 — GSD2 pattern adoption (incremental, ongoing)

`gsd-build/gsd-2` (7K stars) has battle-tested patterns Apohara should
inherit. Apply opportunistically when refactoring the relevant module:

| Pattern (GSD2 file) | Where to apply in Apohara |
|---|---|
| `AutoOrchestrationModule` + 8 adapter contracts | `subagent-manager.ts` |
| `STUCK_WINDOW_SIZE = 6` ring-buffer stuck detector | scheduler run loop |
| `worktree-manager.ts` lifecycle verbs | `.claude/worktrees/` formalization |
| Model resolver with auth-aware fallback | `agent-router.ts` |
| Drift reconciliation registry (ADR-017) | recovery in scheduler |
| `gsd headless query` JSON state | new `apohara state --json` command |

Not a blocking milestone. Stolen incrementally.

### Phase 7 — v0.2 Self-Improvement Loop

| # | Status | Detail |
|---|---|---|
| 7.1 Apohara reads its own repo via the indexer | 🔴 | Wiring exists but the prompt scaffolding for "implementá X en Apohara" isn't built. |
| 7.2 Nimbalyst-style markdown specs | 🔴 | `.apohara/specs/*.md` with frontmatter that agents read. |
| 7.3 Public Discord scales to 500 users | 🔴 | User-side. |
| 7.4 Release v0.2.0 | 🔴 | Gated on 7.1 + 7.2. |

---

## 11. What's shipped

Today, on branch `apohara/run-2026-05-08T23-48-06-343Z`, in commit
order:

```
bd819ed  chore: sync gitnexus auto-managed blocks (3675→3877 symbols)
691ae8e  feat(Gap 2): CLI-driver framework — bring your own subscriptions
0793e2c  feat(Gap 1): RosterPicker UI + /api/roster — user picks which AIs run
41a2ac2  feat(M013.1+.2+.5): capability stats + Thompson Sampling + apohara stats
729489f  docs+ci(Phase 6): cross-OS Tauri matrix, README rewrite, install bootstrap
b58dbca  feat(M017.10): Playwright E2E smoke for the desktop visual orchestrator
218d25d  feat(M014.5+.6): per-violation ledger events + non-Linux consent fallback
bbfa65d  feat(M014.4): runner fork-chain + pipes + execvp end-to-end
8ef1151  feat(M014.3): user+mount+PID namespace bundle for unprivileged isolation
778fba3  ci: pin bun to 1.3.13 to unblock EventLedger Phase 4 tests
78018ad  docs(M017.9): mark packages/tui as archived (marker only)
d0828d5  feat(M017.8): Tauri 2 Linux build pipeline — 5.6 MB raw binary
b09b5d5  fix(ts): clean up 17 pre-existing tsc --noEmit errors
ec2c69d  feat(M014.2): real seccomp-bpf 3-tier profile + fork-enforced tests
2571f71  feat(desktop): M017.3-.7 visual surface + M015.5 GPU/Cloud toggle
479a9d9  feat(M017.2): real /api/enhance, /api/run, SSE tail on desktop server
43d3df1  chore: untrack runtime artifacts + sync GitNexus auto-managed blocks
b3107e4  docs(M015.6): ContextForge sidecar deploy + integration guide in README
f589d4f  feat(M015.2): ContextForge HTTP client + router/scheduler hooks
c49039e  feat(M015.4): port INV-15 JCR Safety Gate to verification-mesh
55c4bf5  feat(M015.1): carnice-9b-local provider
```

### Test inventory (verified green 2026-05-12)

| Suite | Tests | Where |
|---|---|---|
| `capability-stats` | 7 | `tests/` |
| `cli-driver` | 6 | `tests/` |
| `credentials` | 5 | `tests/` |
| `ledger` | 10 | `tests/` |
| `sandbox-fallback` | 3 | `tests/` |
| `gemini OAuth` | 18 | `src/lib/oauth/` |
| Playwright e2e (3-pane + Run + roster + mode) | 4 | `packages/desktop/tests/e2e/` |
| `apohara-sandbox` lib | 21 | `crates/apohara-sandbox/src/` |
| `apohara-sandbox` seccomp_enforcement | 4 | `crates/apohara-sandbox/tests/` |
| `apohara-sandbox` namespace_isolation | 2 | `crates/apohara-sandbox/tests/` |
| `apohara-sandbox` runner_e2e | 4 | `crates/apohara-sandbox/tests/` |
| `tsc --noEmit` | 0 errors | both root and `packages/desktop` |
| **Total assertions verified green** | **84** | |

### End-to-end smoke (real, not synthetic)

```
$ bun run src/cli.ts auto --no-pr -w 1 \
    "Write a file at /tmp/apohara-demo.txt containing exactly 'hello from apohara'"

# 33 seconds wall time. 14 ledger events. Provider chosen: claude-code-cli.
$ cat /tmp/apohara-demo.txt
hello from apohara
```

---

## 12. What's left

### Phase 6 — v0.1 ship

| Item | Owner | Notes |
|---|---|---|
| 90-second demo video | **user** | The pitch turns on this. See §13 for what the video needs to show. |
| HN front-page launch | **user** | First-comment thread should reference the kernel sandbox, the multi-AI roster, and the verification mesh. |
| Twitter thread | **user** | Pin the 90s video. |
| arXiv link to INV-15 paper | **user** | Cross-ref from README and HN post. |
| Discord community | **user** | 50 beta users to seed M015 ContextForge feedback. |
| `v0.1.0` tag | **user** | Single `git tag v0.1.0 && git push --tags`. Fires `desktop-release.yml` matrix. |
| Real SHA256s in Homebrew formula | **automation** | Add to release pipeline; render `packaging/homebrew/apohara.rb` at tag time. |
| Cross-OS binary verification | **first CI run** | macOS-latest + windows-latest haven't been exercised on hosted runners yet. |

### Technical follow-ups (post-v0.1)

| Item | Why deferred | Effort |
|---|---|---|
| M013.3 router wiring of Thompson Sampling | Risky autonomous change to the routing critical path; consumed by sandbox + verification mesh. | ~1 session, careful |
| M013.4 `kv_share_friendliness` dimension | Depends on M013.3 + plumbing `contextforge_savings` payload into the stats store. | ~0.5 session after .3 |
| PR #5 EventLedger CI cluster | Was unblocked by the bun 1.3.13 pin; needs a CI re-run to confirm and then attack the residual env-driven fails. | ~1 session |
| Cross-OS Tauri binaries | Need actual CI runner time on macos-latest + windows-latest. | 1 hosted-runner pass |
| Desktop `Run` button drives the orchestrator | Today `/api/run` only seeds the session; the full `bun run src/cli.ts auto` flow is CLI-only. | ~1 session — spawn the auto runner from the API handler |
| M017.9 physical deletion of `packages/tui/` | Gated on M017.10 + dashboard.ts rewire. | ~0.5 session |
| MiniMax bridge stability | Currently fails on >60s prompts; opencode rate limit suspected. | Investigation |
| Indexer daemon JSON-RPC method coverage | Decomposer sees "Method not found" warnings on memory-injection path. | ~0.5 session |
| M018 GSD2 pattern adoption | Incremental — pick one per refactor cycle. | Opportunistic |

### v0.2 (Phase 7)

The self-improvement loop. Concretely:

- Indexer must be able to map every reference in the Apohara repo
  itself.
- Markdown specs in `.apohara/specs/*.md` with frontmatter must be
  read+written by the agent loop.
- The PR template must include the `apohara replay --dry-run --json`
  signature so reviewers can independently verify what the agent
  intended to do.

---

## 13. Gaps and limitations (honest)

### What works today

- Multi-AI orchestration end-to-end via the CLI (`apohara auto`).
- Visual desktop renders correctly; `/api/enhance` round-trips real
  LLM calls.
- Sandbox actually enforces seccomp + namespaces on Linux. The
  `readonly_blocks_write_syscall` integration test forks a child,
  applies the ReadOnly filter, and confirms `write(2)` returns EPERM.
- Event ledger SHA-256 chain holds under concurrent writes (the
  `write_queue` in `ledger.ts` serializes appends).
- Roster picker works end-to-end through `localStorage` + `/api/roster`
  + the `X-Apohara-Roster` header.
- CLI driver framework spawns the user's installed `claude` / `codex`
  / `gemini` and captures their stdout. ANSI stripping handled.

### What doesn't work or is partial

- **Desktop `Run` button doesn't drive the orchestrator.** It writes
  a `session_started` event to the ledger and tails. To see the
  swarm act, run `bun run src/cli.ts auto ...` in a terminal. The
  desktop's SSE will pick up the events because the server tails
  `.events/run-*.jsonl` regardless of who wrote them — but the
  button itself doesn't spawn the runner. Fixing this is a ~1
  session change.

- **Thompson Sampling math + persistence + `apohara stats` ship —
  routing doesn't consume them yet.** M013.1, .2, .5 done; M013.3
  pending. So today the router still uses static capability scores +
  fallback chains. The data-collection path is live: every
  `provider_selected` and the eventual success/failure outcome will
  be persisted once .3 lands.

- **Indexer daemon isn't auto-started.** Run `cargo run -p
  apohara-indexer --release` separately, or accept "Failed to fetch
  memories" warnings in the decomposer (it falls back to a
  no-memory prompt).

- **Tests for some CLI driver flags assume vendor flag stability.**
  `claude --print`, `codex exec`, `gemini -p` are correct as of
  late-2025/early-2026 releases. When the vendor moves the flags, the
  cleanest fix is `APOHARA_CLI_DRIVERS_CONFIG` overrides (no source
  change needed).

- **Cross-OS Tauri build never ran on hosted runners.** The workflow
  YAML is syntactically valid and built locally; macOS and Windows
  may surface dependency gaps in their first run that aren't
  Linux-visible.

- **Carnice/ContextForge are positioned as boosters but the
  README/architecture sometimes still leads with them.** This
  document corrects the positioning; older commits may not.

- **The 245m duration in the auto run's summary** is a
  `summary-generator.ts` bug — it reads state.json instead of the
  ledger. Cosmetic.

- **`branch_creation_failed` during consolidation** when the current
  branch matches the pattern `apohara/run-*`. Defensive; the run
  still succeeds without a new branch when `--no-pr` is set.

### What's flat-out absent (deliberate, future)

- Self-improvement loop (Phase 7).
- Hosted SaaS / team mode.
- iOS companion (mentioned for v0.2 backlog; not on the v0.1 path).
- Anthropic OAuth — blocked by TOS; subscription auth happens inside
  Claude Code CLI instead.

### Honest "Repo of the Day" probability assessment

The competition: Aider (~30K ⭐), Cline (~50K ⭐), Cursor (closed, ~$$),
OpenHands (~25K ⭐), Continue (~25K ⭐), GSD2 (~7K ⭐), Nimbalyst
(actively growing). The space is saturated.

Apohara's real differentiation lives in three places:

1. **Kernel sandbox.** Real low-level Rust engineering. Lands well on
   "Show HN: I built a real seccomp-bpf sandboxed coding agent".
2. **Multi-AI orchestration via existing CLI subscriptions.** This
   resonates with developers who already pay for Claude Code + Codex
   + Gemini and feel they're juggling tabs. "One tool, three AIs,
   zero API keys" is a clean hook.
3. **Verification mesh with cross-vendor audit.** Concrete answer to
   "what if the AI is wrong?" — a different AI checks it.

Probability ceiling with a good demo + thoughtful HN post:

| Outcome | Honest probability |
|---|---|
| Front page HN one day | 35–50% |
| 500–1K stars in week 1 | 25–40% |
| 5K stars in 60 days | 8–15% |
| Vercept-tier acqui-hire | < 2% |
| Sustained side-project with 100–300 stars + real users | 60% |

The single biggest lever is the **demo video**. Without it, none of the
above probabilities trigger.

---

## 14. Development workflow

### Build commands

```bash
# TS orchestrator + CLI
bun install
bun run build                  # → dist/cli.js

# Desktop dev (HMR, opens on :7331)
cd packages/desktop && bun run dev

# Desktop production build (Tauri binary)
cd packages/desktop && bun run tauri:build

# Rust sidecars
cargo build -p apohara-indexer --release
cargo build -p apohara-sandbox --release

# Reindex GitNexus (auto-managed AGENTS.md / CLAUDE.md blocks)
npx gitnexus analyze
```

### Test discipline

- **Rust**: NEVER bare `cargo test` (OOM hazard — the indexer crate
  loads a 400 MB BERT model and `cargo test` runs binaries in
  parallel). Run one binary at a time:
  - `cargo test -p apohara-indexer --lib`
  - `cargo test -p apohara-indexer --test memory_integration`
  - `cargo test -p apohara-sandbox --lib`
  - `cargo test -p apohara-sandbox --test seccomp_enforcement -- --test-threads=1`
  - `cargo test -p apohara-sandbox --test namespace_isolation -- --test-threads=1`
  - `cargo test -p apohara-sandbox --test runner_e2e -- --test-threads=1`

- **TypeScript**: prefer per-file. `bun test tests/<file>.test.ts`.
  `APOHARA_MOCK_EMBEDDINGS=1` to skip BERT.

- **E2E (visual)**: `cd packages/desktop && bun run e2e`. Requires
  Chrome at `/usr/bin/google-chrome` (configured in
  `playwright.config.ts`).

- **CI**: `.github/workflows/ci.yml` runs `bun test src tests` with
  bun 1.3.13 pinned (see §13).

### GitNexus workflow (mandatory per `CLAUDE.md`)

Before editing any function / class / method:

```bash
# Impact analysis — what breaks if you change this symbol?
# (also available as MCP tool: gitnexus_impact)
npx gitnexus impact --target <symbolName> --direction upstream

# After edits, before commit:
npx gitnexus detect-changes --scope unstaged
```

NEVER rename symbols with find-and-replace — use `gitnexus_rename`
which understands the call graph.

### Commit conventions

- Conventional commits with the milestone in parens:
  `feat(M014.3): user+mount+PID namespace bundle ...`
- Subject ≤ 70 chars. Detailed body. Co-author trailer
  `Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>` when
  the commit was AI-assisted.

### Surgical-changes rule

Per `CLAUDE.md §2.3`:

- Touch only what the task requires.
- Match existing style.
- Notice dead code; mention it; don't delete it.
- Every changed line must trace to the request.

This is the rule that keeps the codebase legible across many small
commits.

---

## 15. Operational runbook

### Local stack ports

| Port | Service | Owner | Restart |
|---|---|---|---|
| `:7331` | Apohara desktop dev (Bun.serve + SSE + React HMR) | `bun --hot packages/desktop/src/server.ts` | `pkill -f packages/desktop/src/server.ts; bun --hot packages/desktop/src/server.ts &` |
| `:8000` | Carnice-9b local LLM | `llama-cpp-python` | See ROADMAP §15.4 (Memory #49 has the systemd-run command with cgroup containment + GPU LD paths) |
| `:8001` | ContextForge sidecar | `python -m apohara_context_forge.main` | `cd ~/Apohara-ContextForge && source .venv/bin/activate && python -m apohara_context_forge.main &` |
| (Unix sock) | `apohara-indexer` daemon | `apohara-indexer --serve` | Auto-spawned by `indexer-client.ts` |

### Crash protection (linconx-specific)

The Apohara orchestrator runs inside Ghostty terminal. If Ghostty dies
the Claude Code session dies and unsaved work is lost. Hard rules from
the engineering contract:

- `apohara.slice` (systemd) wraps long-running processes with
  `MemoryMax=7G` so they get OOM-killed before the whole cgroup tier.
- `oom_score_adj = -500` on Ghostty + Claude processes (must re-apply
  after reboot because `oom_score_adj` doesn't persist).

### Stack restart (after reboot)

The full re-bring-up command set lives in memory `#49`. Abbreviated:

```bash
# Carnice on :8000 (cgroup-contained)
systemd-run --user --scope --slice=apohara.slice -p MemoryMax=7G \
  --setenv=LD_LIBRARY_PATH=... --setenv=CUDA_VISIBLE_DEVICES=0 \
  python -m llama_cpp.server --model .local/models/Carnice-9b-Q4_K_M.gguf \
  --host 0.0.0.0 --port 8000 --n_gpu_layers -1 --n_ctx 4096 --chat_format chatml &

# ContextForge on :8001
cd ~/Apohara-ContextForge && source .venv/bin/activate && \
  CUDA_VISIBLE_DEVICES=0 nohup python -m apohara_context_forge.main \
  > /tmp/contextforge.log 2>&1 &

# Desktop dev on :7331
cd ~/Apohara && CONTEXTFORGE_ENABLED=1 \
  bun --hot packages/desktop/src/server.ts > /tmp/desktop-server.log 2>&1 &
```

### Replay a run

```bash
# List runs
ls .events/

# Show a run's timeline
cat .events/run-<id>.jsonl | jq -c '{type, severity, payload}'

# Verify the hash chain
bun run src/cli.ts replay <id> --verify

# Re-render the run without calling any provider
bun run src/cli.ts replay <id> --dry-run --json
```

### Stats command

```bash
# Full table per role
bun run src/cli.ts stats

# Just one role
bun run src/cli.ts stats --role codegen

# Machine-readable
bun run src/cli.ts stats --json

# Custom store
bun run src/cli.ts stats --file .apohara/capability-stats.json
```

---

## 16. Appendix

### A. Where to look for what

| Question | File |
|---|---|
| What's the launch pitch? | `README.md` |
| What's the system shape? | `ARCHITECTURE.md` |
| What's done vs pending? | `ROADMAP.md` |
| Engineering contract (guardrails) | `CLAUDE.md` |
| GitNexus index pointers | `AGENTS.md` |
| Everything in one place | **this file** |

### B. Key contracts

- `ProviderId` (closed enum) — `src/core/types.ts`
- `EventLog` (ledger row) — `src/core/types.ts`
- `CliDriverConfig` (CLI driver) — `src/providers/cli-driver.ts`
- `SandboxRequest` / `SandboxResult` (sandbox boundary) — `crates/apohara-sandbox/src/runner.rs`
- `PermissionTier` (sandbox tier) — `crates/apohara-sandbox/src/permission.rs`
- `CapabilityCounts` (Thompson Sampling persistence) — `src/core/capability-stats.ts`

### C. External references

- **INV-15 preprint** — DOI [10.5281/zenodo.20114594](https://doi.org/10.5281/zenodo.20114594).
  KV-cache safety invariant. Implemented in
  `src/core/verification-mesh.ts` (M015.4 port).
- **Apohara Context Forge** — [SuarezPM/Apohara_Context_Forge](https://github.com/SuarezPM/Apohara_Context_Forge).
  Parallel repo for the GPU sidecar.
- **seccompiler** — [crate docs](https://docs.rs/seccompiler/0.5.0/seccompiler/).
- **Tauri v2** — [tauri.app](https://tauri.app/).
- **GSD2** (pattern donor) — [gsd-build/gsd-2](https://github.com/gsd-build/gsd-2).
- **Nimbalyst** (positioning reference) — [Nimbalyst/nimbalyst](https://github.com/Nimbalyst/nimbalyst).

### D. Memory log (engram observations referenced by this doc)

| ID | Topic |
|---|---|
| #49 | Session checkpoint with stack restart commands |
| #50 | M017.3-.7 + M015.5 (visual surface) |
| #51 | M014.2 + TS cleanup + M017.8 Tauri build |
| #52 | AFK ralph M014.3 + CI pin + M017.9 |
| #53 | Ultrawork closing M014.4-.6 + M017.10 |
| #54 | Ultrawork phases (Phase 6 + M013) |
| #55 | Ultrawork 3 gaps (multi-AI narrative alignment) |

---

*This document is generated, hand-curated, and the agreed canonical
reference. When the code drifts, **this document is wrong** — open a
PR. Updated 2026-05-12 against commit `bd819ed`.*
