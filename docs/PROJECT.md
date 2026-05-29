# Apohara — Project Handbook

> **The single-source-of-truth technical document.** Everything a new
> contributor needs to read once: what Apohara is, what stack runs it,
> what's shipped, what's pending, where the gaps are. README is the
> launch surface; ARCHITECTURE.md is the system diagram; this is the
> reference.
>
> Architecture, stack, and command sections reconciled to current
> reality (post-Sprint-23: native Dioxus desktop, sqlite-vec + blake3
> indexer). The §10 roadmap and §11 commit-log sections remain a dated
> historical snapshot at commit `bd819ed` (2026-05-12) and are labelled
> as such. When the code drifts, this document is wrong — open a PR to
> update it in place.

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
action is recorded to an append-only JSONL event ledger so the run is
replayable. *(A SHA-256-chained ledger + `replay --verify` is planned
(Phase 2); today the ledger is append-only JSONL with no hash chain.)*

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

Optional booster (*separate-repo integration, not part of this repo*): a
parallel project, **Apohara · Context Forge**, runs as a Python sidecar
on a CUDA/ROCm GPU and provides KV-cache deduplication across
multi-agent calls. Reported 79.85% token savings on a 5-agent benchmark
(preprint, DOI [10.5281/zenodo.20114594](https://doi.org/10.5281/zenodo.20114594)).
Apohara works unchanged without it; it is wholly optional and lives in
its own repository.

Current status: visual orchestrator, sandbox, CLI-driver providers,
dual-arbiter verification, append-only JSONL event ledger, native
Dioxus 0.7 desktop binary (~4.4 MB release with LTO + strip +
panic=abort, per `docs/superpowers/rust-native/g2-a-decision.md`) — all
shipping. *(The historical Tauri figure was ~5.6 MB raw; the native
Dioxus binary differs.)* End-to-end smoke test runs `apohara
run "write a file at /tmp/X containing Y"` → claude-code-cli
plans + executes → file written → ledger events recorded → seconds of
wall time → $0 tokens.

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

The user launches the native `apohara-desktop-dioxus` binary (Dioxus 0.7,
no webview SPA, no localhost server). Three panes laid out left-to-right:

```
┌────────────┬──────────────────────────┬───────────────────────┐
│ Objective  │   Swarm Canvas (DAG)     │  Code + Diff          │
│  textarea  │   petgraph-laid nodes    │  file tree + syntect  │
│            │   per task with state    │  highlighted diff     │
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
5. **Verification mesh** — the mesh spawns two arbiters (a judge and a
   critic) from *different* providers than the coder. Both must approve
   before the diff is staged. The live safety gate is **INV-bash-scope**.
   *(The "INV-15 / JCR" fresh-context gate keyed on a τ risk threshold is
   the ContextForge paper concept, not implemented in this repo.)*
6. **Consolidation** — accepted diffs are applied to the trunk branch
   via a real `git apply`; if PR mode is enabled, `gh` opens the PR with
   the run id in the body.
7. **Ledger record** — every event in steps 1–6 was already streamed
   to `.events/run-<sid>.jsonl` as append-only JSONL. *(A SHA-256 hash
   chain — `event[i].prev_hash === event[i-1].hash` — plus an `apohara
   replay --verify` that refuses to render on a broken link is planned
   (Phase 2); today the ledger is append-only with no hash chain.)*

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
│  APOHARA DESKTOP  (native Dioxus 0.7, ~4.4 MB release ELF)           │
│  apohara-desktop-dioxus crate · petgraph DAG layout · syntect diff   │
│  ├─ Objective pane    ┬─ Swarm Canvas (DAG)   ┬─ Code+Diff           │
│  └────────────── in-process event subscription from ledger ───────── │
└──────────────────────────────────────────────────────────────────────┘
                              ↕ in-process Rust calls
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA CORE  (Rust)                                                │
│  dispatch · decomposer · scheduler · worktree · consolidator         │
│  ┌─ crates/ ────────────────────────────────────────────────────┐    │
│  │ apohara-dispatch · apohara-decomposer · apohara-worktree      │    │
│  │ apohara-verification (mesh + quality gates) · apohara-coordinator   │
│  │ apohara-token-accounting · apohara-attention · apohara-anti-thrash  │
│  │ apohara-sandbox · apohara-indexer · apohara-mcp-bridge        │    │
│  └─────────────────────────────────────────────────────────────  ┘    │
│  providers — Claude Code / Codex / OpenCode CLI drivers (BYO sub)    │
└──────────────────────────────────────────────────────────────────────┘
                              ↕ subprocess + in-process
┌──────────────────────────────┬───────────────────────────────────────┐
│  apohara-indexer (Rust) ✅   │  apohara-sandbox (Rust) ✅            │
│  tree-sitter + sqlite-vec +  │  seccomp-bpf + user/mount/PID ns      │
│  blake3 feature-hashing      │  3-tier permission profiles           │
│  (384-dim, ~0 RAM)           │  Per-process fork chain               │
└──────────────────────────────┴───────────────────────────────────────┘
                              ↕ HTTP (optional, separate repo)
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA CONTEXT FORGE  (separate repo, optional integration)        │
│  FastAPI + vLLM bridge + INV-15 (JCR) safety gate                    │
│  reported 60–80% token savings, CUDA/ROCm GPU                        │
└──────────────────────────────────────────────────────────────────────┘
```

### Process topology at runtime

When the user launches the native `apohara-desktop-dioxus` binary:

- **PID A** — the Dioxus desktop process (UI + orchestrator core,
  in-process; no separate web server, no localhost port).
- **PID B** — `apohara-indexer` daemon (Rust binary, Unix socket RPC).
- **PID C..N** — per-task `apohara-sandbox` subprocesses (Rust binary,
  short-lived, double-forked into the new namespace bundle).
- **PID local-LLM** — optional `llama-cpp-python` on :8000.
- **PID context-forge** — optional separate-repo Python sidecar on :8001.

PIDs A and B are long-lived. PIDs C..N are short-lived. The CLI drivers
(`claude`, `codex`, `opencode`) spawn one subprocess per LLM turn and exit.

---

## 5. Stack reference

### Languages & runtimes

| Concern | Choice | Why |
|---|---|---|
| Orchestrator | **Rust** | Single static binary, no runtime, kernel-level sandbox in the same language as the core, deterministic behavior. |
| Desktop shell | **Dioxus 0.7 (native)** | The `apohara-desktop-dioxus` crate renders natively — no webview SPA, no React/Electron/Bun, no localhost server. ~4.4 MB release binary (LTO + strip + panic=abort). |
| Frontend | **Dioxus `rsx!` components** + `petgraph` (DAG layout) + `syntect` (diff highlighting) | The React→Dioxus port replaced `@xyflow/react`→`petgraph` and Monaco→`syntect`; both are pure-Rust, in-process. |
| Sandbox | **Rust** + `seccompiler` 0.5 + `nix` 0.30 + `libc` | Kernel-level enforcement; the only way to do this on Linux. |
| Indexer | **Rust** + `tree-sitter` + `sqlite-vec` + `blake3` (feature-hashing) | Tree-sitter for parsing; sqlite-vec for vector storage; blake3 feature-hashing produces 384-dim embeddings in-process at ~0 RAM (no transformer model, no candle, no Nomic BERT). |
| Optional GPU sidecar | **Python** + FastAPI + vLLM (*separate repo*) | The ContextForge paper's reference implementation; optional separate-repo integration. |

### Visual identity

| Token | Value |
|---|---|
| Dark default | `#0a0a0f` background, `#111118` surface |
| Cyan accent (agent activity) | `#6ee7f7` |
| Violet accent (verification mesh) | `#a78bfa` |
| Success / warning / error | `#4ade80` / `#fbbf24` / `#f87171` |
| Font | Geist Mono + Geist Sans |

Carried in the `apohara-desktop-dioxus` crate's styling. Inspiration:
Linear, Vercel, Raycast.

### Dependencies (key ones)

| Dependency | Version | Where |
|---|---|---|
| `dioxus` / `dioxus-desktop` | 0.7 | `crates/apohara-desktop-dioxus` (native UI) |
| `petgraph` | 0.6 | `crates/apohara-desktop-dioxus` (DAG layout) |
| `syntect` | 5 (no default features) | `crates/apohara-desktop-dioxus` (diff highlighting) |
| `tree-sitter` | 0.24 | `crates/apohara-indexer` |
| `sqlite-vec` | 0.1 | `crates/apohara-indexer` (vector storage) |
| `blake3` | 1.5 | `crates/apohara-indexer` (feature-hashing embeddings) |
| `seccompiler` (Rust) | 0.5 (with `json` feature) | `crates/apohara-sandbox` |
| `nix` (Rust) | 0.30 | `crates/apohara-sandbox` |

### CLI drivers shipped (the user installs these themselves)

| Driver | npm/source package | Binary | Auth |
|---|---|---|---|
| `claude-code-cli` | `@anthropic-ai/claude-code` | `claude` | User's Claude subscription (one-time `claude login`) |
| `codex-cli` | `@openai/codex` | `codex` | User's ChatGPT/Codex subscription |
| `opencode-go` | `sst/opencode` | `opencode` | Vendor-agnostic; can host MiniMax, etc. |

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
- Defaults: judge and critic are picked cross-vendor from the coder,
  e.g. coder = `codex-cli` or whatever the role fallback order picked.
  The role→provider mapping codifies this cross-vendor bias by design.
- The live safety gate in the verification mesh is **INV-bash-scope**
  (the renamed, implemented gate). *Note: "INV-15 / JCR gate" refers to
  the ContextForge paper's KV-cache safety concept — fresh-context
  re-verification above a τ threshold — which is **not** implemented in
  this repo; it belongs to the optional separate-repo ContextForge
  integration.*

### Thompson Sampling layer (planned)

A per-`(provider, role)` success/failure Beta(α,β) bandit (priors
α₀=β₀=2) for live explore/exploit routing is **planned — not yet ported
to the Rust core (TS-legacy)**. It exists only in legacy TypeScript and
is **not** present in the Rust code. Today the router uses static
capability scores; no live-learning layer consumes the routing decision.

### The roster picker

The desktop top bar lets the user toggle which providers participate in
a run. The selected roster is forwarded to the dispatch layer so each
dispatched task only considers providers the roster permits. (In the
native Dioxus UI this is in-process state, not a `localStorage` /
`/api/roster` HTTP round-trip.)

---

## 7. Component reference

### 7.1 `crates/apohara-desktop-dioxus/`

Native Dioxus 0.7 crate (no webview SPA, no Bun/Node, no `packages/`
dir). The user-facing surface, compiled into the desktop binary. Diff
view via `syntect`, DAG layout via `petgraph`.

```
crates/apohara-desktop-dioxus/
├── Cargo.toml                 ← dioxus 0.7 + petgraph 0.6 + syntect 5
├── Dioxus.toml                ← Dioxus app config + dev watcher
├── scripts/dev.sh             ← `dx serve` hot-reload entry
├── src/
│   ├── main.rs                ← desktop binary entry
│   ├── lib.rs                 ← app root + three-pane layout
│   └── components/            ← `rsx!` components
│       ├── objective_pane.rs  ← textarea + Enhance + Run + error banner
│       ├── swarm_canvas.rs    ← petgraph-laid DAG, state classes
│       ├── code_diff_pane.rs  ← syntect-highlighted diff + file tree + verdicts
│       ├── cost_meter.rs      ← tokens / USD / savings + GPU/Cloud toggle
│       └── hero_banner.rs     ← canonical port-pattern reference
└── tests/                     ← SSR render tests + IPC smoke tests
```

### 7.2 `src/core/`

The orchestrator brain. TypeScript on Bun.

| Module | Responsibility |
|---|---|
| `decomposer.ts` | NL prompt → typed `Task[]` with `dependsOn` edges. Cycle detection (DFS). Indexer context injection. |
| `scheduler.ts` | Topo-walk the DAG; spawn one worktree per task in `.claude/worktrees/`. |
| `subagent-manager.ts` | Per-task agent loop. Retry budgets, escalation, role-aware prompts. |
| `consolidator.ts` | Merge accepted diffs into trunk. Optionally open PR via `gh`. |
| `verification-mesh.ts` | Dual-arbiter (judge + critic). Live gate is **INV-bash-scope** (renamed). Drift detection. *("INV-15 / JCR" is the ContextForge paper concept, not implemented here.)* |
| `agent-router.ts` | Role → provider mapping with fallback chains. Calls into the capability manifest + ROSTER filter. |
| `ledger.ts` | Append-only JSONL event log. *(SHA-256 hash chain + tamper-detecting `verify()` is planned (Phase 2), not in the live ledger.)* |
| `capability-manifest.ts` | Static per-provider per-task scores. Source of `selectBestProvider`. |
| `capability-stats.ts` | Runtime success/failure counts + Thompson-Sampling math. *(Planned — not yet ported to the Rust core (TS-legacy); not consumed by routing.)* |
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

- **Storage:** `sqlite-vec` (in-process SQLite vector storage).
- **Parsing:** tree-sitter, watch-driven.
- **Embeddings:** `blake3` feature-hashing — 384-dim vectors computed
  in-process at ~0 RAM, deterministic. No transformer model, no
  `candle`, no Nomic BERT, no 400 MB download, so there is no
  `APOHARA_MOCK_EMBEDDINGS` gate to manage.
- **API:** Unix-socket JSON-RPC. Methods:
  `searchMemories(query, k)`, `getBlastRadius(file, symbol)`,
  `listSymbols`, etc.

### 7.6 `apohara-context-forge` (separate repo, optional integration)

[`SuarezPM/Apohara_Context_Forge`](https://github.com/SuarezPM/Apohara_Context_Forge)
— FastAPI service in its own repository. KV-cache coordinator across
multi-agent calls. **Optional**; this repo does not depend on it.

- Sidecar URL: `localhost:8001` by default.
- `register_context(text) → handle` before inference.
- `get_optimized_context(handles[]) → compressed_text` for shared
  prompts.
- Implements the **INV-15 / JCR safety invariant** from the paper.
  *(This is the ContextForge-side concept; the live gate in this repo's
  verification mesh is the renamed **INV-bash-scope**.)*

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
2. **Safety gate** — the live gate is **INV-bash-scope** (the renamed,
   implemented gate). *The "INV-15 / JCR" gate — where `judge.risk > τ`
   feeds the verifier a fresh context window to block KV-cache reuse
   from smuggling in a corrupted prior — is the ContextForge paper's
   concept and is **not** implemented in this repo (it belongs to the
   optional separate-repo ContextForge integration).*
3. **Critic** (cross-vendor from both coder and judge) inspects the
   same diff for style, maintainability, and test coverage. Outputs
   the same JSON verdict shape.
4. Both must approve. A `mesh_verdict` event is logged for each.

If the judge or critic rejects, the diff goes back to the coder with
the rejection reason. After N retries (configurable), the task fails
and the worktree is destroyed.

### 8.4 Event ledger

Every meaningful action emits one JSON line to `.events/run-<sid>.jsonl`.
Today the ledger is **append-only JSONL** — no hash chain. The live CLI
surface is `apohara doctor` / `verify-setup` / `run`.

```
{ id, timestamp, type, severity, taskId?, payload, metadata? }
```

*Planned (Phase 2): a SHA-256 hash chain plus tamper-detecting replay.
The design is*
`hash = SHA-256(prev_hash || canonical_json(event_without_hashes))`
*with a genesis block `prev_hash = "0"*64`, a `verify()` that walks the
chain returning `{ ok, brokenAt, reason }`, and an `apohara replay
--verify` / `replay --dry-run --json` that rebuilds run state without
calling any provider. None of this is implemented yet.*

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

*Planned: an `apohara stats` per-role table or `--json`, e.g.*

```
# planning
rank provider                 score   succ_rate  trials
-------------------------------------------------------
1    claude-code-cli          0.953     50.0%       0
2    codex-cli                0.921     50.0%       0
...
```

*where `score` is a **single Thompson-Sampling draw** from
`Beta(α₀+successes, β₀+failures)` and the variance does the
explore/exploit balancing. This is **planned — not yet ported to the
Rust core (TS-legacy)**; the live CLI exposes `doctor` / `verify-setup`
/ `run`, not `stats`.*

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
| 4 | Event Ledger v2 *(historical TS milestone; the SHA-256 chain + `apohara replay` is **planned (Phase 2)** — today's ledger is append-only JSONL)* |

### M010 — Context Compression ✅

Tree-sitter based context compression in `apohara-indexer`.

### M011 — Long-Term Memory ✅

*(Historical milestone.)* The current `apohara-indexer` uses
**`sqlite-vec` storage + `blake3` feature-hashing embeddings** (384-dim,
~0 RAM) — **not** `redb` + Nomic BERT, which the early milestone tried
before the feature-hashing rewrite.

### M013 — Thompson Sampling *(planned — not yet ported to the Rust core (TS-legacy))*

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

- Multi-AI orchestration end-to-end via the CLI (`apohara run`).
- The native Dioxus desktop renders correctly and round-trips real LLM
  calls in-process (no localhost server).
- Sandbox actually enforces seccomp + namespaces on Linux. The
  `readonly_blocks_write_syscall` integration test forks a child,
  applies the ReadOnly filter, and confirms `write(2)` returns EPERM.
- Event ledger records every action as append-only JSONL under
  concurrent writes. *(The SHA-256 hash chain is planned (Phase 2).)*
- Roster picker works end-to-end as in-process desktop state (the native
  Dioxus UI; no `localStorage` / `/api/roster` HTTP round-trip).
- CLI driver framework spawns the user's installed `claude` / `codex`
  / `opencode` and captures their stdout. ANSI stripping handled.

### What doesn't work or is partial

- **Desktop `Run` button → orchestrator dispatch is still being
  hardened.** The native UI subscribes to ledger events in-process; the
  CLI path (`apohara run "..."`) is the reference flow for driving the
  swarm end-to-end.

- **Thompson Sampling is planned — not yet ported to the Rust core
  (TS-legacy).** The Beta-bandit math, its persistence, and an `apohara
  stats` command exist only in legacy TypeScript and are **not** in the
  Rust code. Today the router uses static capability scores + fallback
  chains; no live-learning layer consumes the routing decision.

- **Indexer daemon isn't auto-started.** Run `cargo run -p
  apohara-indexer --release` separately, or accept "Failed to fetch
  memories" warnings in the decomposer (it falls back to a
  no-memory prompt).

- **Tests for some CLI driver flags assume vendor flag stability.**
  `claude --print`, `codex exec`, `opencode` invocation are correct as
  of late-2025/early-2026 releases. When a vendor moves a flag, the
  cleanest fix is a CLI-driver config override (no source change
  needed).

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
# Build all crates (Rust workspace)
cargo build --workspace

# Native Dioxus desktop (standalone single-crate workspace)
( cd crates/apohara-desktop-dioxus && cargo build --release )
# Hot-reload dev (requires dioxus-cli `dx`):
( cd crates/apohara-desktop-dioxus && cargo run )   # or scripts/dev.sh with `dx serve`

# Rust sidecars
cargo build -p apohara-indexer --release
cargo build -p apohara-sandbox --release
```

> The Dioxus crate is **not** a workspace member (it pins `wry ^0.53`,
> incompatible with the Tauri shell's `wry`). It carries its own
> `[workspace]` directive and `Cargo.lock`. See
> `docs/superpowers/rust-native/g2-a-decision.md`.

### Test discipline

- **Rust**: `cargo test -p apohara-indexer` runs all indexer binaries in
  parallel without OOM hazard — the indexer uses sqlite-vec + blake3
  feature-hashing (in-process, ~0 RAM, no transformer model). Sandbox
  integration tests serialize:
  - `cargo test -p apohara-indexer`
  - `cargo test -p apohara-sandbox --lib`
  - `cargo test -p apohara-sandbox --test seccomp_enforcement -- --test-threads=1`
  - `cargo test -p apohara-sandbox --test namespace_isolation -- --test-threads=1`
  - `cargo test -p apohara-sandbox --test runner_e2e -- --test-threads=1`

- **Dioxus UI**: `( cd crates/apohara-desktop-dioxus && cargo test )` —
  SSR render tests + IPC smoke tests.

- **CI**: `.github/workflows/ci.yml` runs the Rust workspace test suite.

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
| (none) | Apohara desktop (native Dioxus, no port — UI + core in-process) | `apohara-desktop-dioxus` binary | relaunch the binary |
| `:8000` | Carnice-9b local LLM (optional) | `llama-cpp-python` | See ROADMAP §15.4 (Memory #49 has the systemd-run command with cgroup containment + GPU LD paths) |
| `:8001` | ContextForge sidecar (optional, separate repo) | `python -m apohara_context_forge.main` | `cd ~/Apohara-ContextForge && source .venv/bin/activate && python -m apohara_context_forge.main &` |
| (Unix sock) | `apohara-indexer` daemon | `apohara-indexer --serve` | Auto-spawned by the indexer client |

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

# Native Dioxus desktop (no port — UI + core in-process)
( cd crates/apohara-desktop-dioxus && cargo run --release )
```

### Inspect a run

```bash
# List runs
ls .events/

# Show a run's timeline (append-only JSONL)
cat .events/run-<id>.jsonl | jq -c '{type, severity, payload}'
```

*Planned (Phase 2): `apohara replay <id> --verify` to validate a SHA-256
hash chain, and `apohara replay <id> --dry-run --json` to re-render a run
without calling any provider. Not implemented yet — today's CLI exposes
`doctor` / `verify-setup` / `run`.*

### Live CLI commands

```bash
apohara doctor          # full environment check
apohara verify-setup    # end-to-end setup verification
apohara run "<goal>"    # dispatch a goal across the CLI drivers
```

*An `apohara stats` command (Thompson-Sampling rankings) is **planned —
not yet ported to the Rust core (TS-legacy)**.*

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
- `CapabilityCounts` (Thompson Sampling persistence) — *planned, TS-legacy; not in the Rust core*

### C. External references

- **INV-15 / JCR preprint** — DOI [10.5281/zenodo.20114594](https://doi.org/10.5281/zenodo.20114594).
  KV-cache safety invariant. *This paper concept is **not** implemented
  in this repo; it belongs to the optional separate-repo ContextForge
  integration. The live verification-mesh gate is **INV-bash-scope**.*
- **Apohara Context Forge** — [SuarezPM/Apohara_Context_Forge](https://github.com/SuarezPM/Apohara_Context_Forge).
  Separate repo for the optional GPU sidecar integration.
- **seccompiler** — [crate docs](https://docs.rs/seccompiler/0.5.0/seccompiler/).
- **Dioxus** — [dioxuslabs.com](https://dioxuslabs.com/) (native desktop UI, 0.7).
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
PR. Architecture/stack/command sections reconciled to post-Sprint-23
reality; the §10 roadmap and §11 commit-log are a dated snapshot against
commit `bd819ed` (2026-05-12).*
