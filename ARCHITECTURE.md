# Architecture — Apohara v2.0

> This document describes how the orchestrator, sidecars, and visual surface
> fit together. It is the reference text every PR is expected to match; if
> the code drifts from it, the document is the lie — open a PR to update it.

For the *what* (capabilities and roadmap), see [`README.md`](README.md) and
[`ROADMAP.md`](ROADMAP.md). For the *day-to-day engineering contract*, see
[`CLAUDE.md`](CLAUDE.md).

---

## 1. System diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA DESKTOP  (Tauri v2, ~6 MB single binary, M017)              │
│  React 19 + Geist + @xyflow/react + Monaco + Lexical                 │
│  ├─ Objective pane    ┬─ Swarm Canvas (DAG)   ┬─ Code+Diff           │
│  └─────────────────── SSE stream from ledger ─────────────────────── │
└──────────────────────────────────────────────────────────────────────┘
                              ↕ HTTP (localhost:7331)
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA CORE  (TypeScript on Bun)                                   │
│  Bun.serve() ──► /api/enhance · /api/run · /api/events (SSE)         │
│  ┌─ src/core/ ──────────────────────────────────────────────────┐    │
│  │ decomposer · scheduler · subagent-manager · consolidator      │    │
│  │ verification-mesh · agent-router · ledger (Phase 4 hash chain)│    │
│  │ capability-manifest · sandbox (TS wrapper)                    │    │
│  └─────────────────────────────────────────────────────────────  ┘    │
│  src/providers/router.ts — 21 providers + OAuth (Gemini)             │
└──────────────────────────────────────────────────────────────────────┘
                              ↕ subprocess + Unix sockets
┌──────────────────────────────┬───────────────────────────────────────┐
│  apohara-indexer (Rust) ✅   │  apohara-sandbox (Rust) ✅ M014       │
│  tree-sitter + redb +        │  seccomp-bpf + user/mount/PID ns      │
│  Nomic BERT embeddings       │  3-tier permission profiles           │
│  Daemon, Unix socket RPC     │  Per-process fork chain               │
└──────────────────────────────┴───────────────────────────────────────┘
                              ↕ HTTP :8001 (optional)
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA CONTEXT FORGE  (parallel repo, optional)                    │
│  FastAPI + vLLM bridge + INV-15 safety gate                          │
│  60–80% token savings, AMD MI300X local-first path                   │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. End-to-end request flow

The lifecycle of one objective from the textarea to a green PR.

1. **Desktop pane → POST /api/enhance**
   `packages/desktop/src/components/ObjectivePane.tsx` posts the raw
   prompt with an `X-Apohara-Mode: gpu|cloud` header. The Bun server
   (`packages/desktop/src/server.ts`) looks up the routing mode and
   picks a provider — `carnice-9b-local` for GPU mode, the configured
   cloud provider otherwise. The enhanced prompt streams back into the
   pane and the user clicks **Run**.

2. **Desktop pane → POST /api/run**
   The server materializes a session id (`desktop-<base36>-<rand6>`)
   and writes `session_started` to `.events/run-<sid>.jsonl`. The pane
   subscribes to `/api/session/<sid>/events` (SSE) and starts tailing.

3. **Decomposer → DAG**
   `src/core/decomposer.ts` calls the planning provider and parses the
   structured JSON output into a `Task[]` with `dependsOn` edges. Cycle
   detection (DFS) rejects malformed plans. `decomposer_complete` is
   logged to the ledger; the Swarm Canvas picks it up over SSE and
   renders the DAG via `@xyflow/react`.

4. **Scheduler → worktrees**
   `src/core/scheduler.ts` walks the DAG in topo order, spawning each
   task into an isolated git worktree under `.claude/worktrees/`. Each
   task carries a permission tier (`workspace_write` by default).

5. **Subagent → router → provider**
   The subagent loop calls `src/providers/router.ts` for each LLM turn.
   When `CONTEXTFORGE_ENABLED=1`, calls go through
   `src/core/contextforge-client.ts` first to compress + reuse KV
   context; on any error the client silently falls back to the cloud
   API. Every call emits `provider_selected` and, on the Carnice path,
   `contextforge_savings` with the measured baseline delta.

6. **Sandbox → test execution**
   When the subagent needs to run code (`bun test`, `cargo build`, the
   binary it just wrote), it asks `src/core/sandbox.ts` to spawn the
   `apohara-sandbox` Rust binary. That binary forks twice (parent →
   middle child unshares namespaces → grandchild applies seccomp +
   `execvp`s the command) and pipes stdout/stderr back as JSON. Any
   blocked syscall produces a `security_violation` ledger event.

7. **Verification mesh → judge + critic**
   `src/core/verification-mesh.ts` invokes the two arbiter providers
   over the diff. The INV-15 safety gate (M015.4) forces fresh context
   when judge risk exceeds the paper's τ threshold. Both arbiters must
   approve before the consolidator opens the PR.

8. **Consolidator → PR + ledger seal**
   `src/core/consolidator.ts` `git push`es the worktree, opens the PR
   via `gh`, and logs `github_pr_opened`. The session's ledger file is
   now a cryptographically chained record (Phase 4 SHA-256 chain): each
   event's `prev_hash` equals the previous event's `hash`, and
   `apohara replay --verify` rejects any tampering.

---

## 3. The core packages

### `src/core/`

| Module | Responsibility |
|---|---|
| `decomposer.ts`         | NL intent → typed `Task[]` with `dependsOn` edges; cycle detection (DFS). |
| `scheduler.ts`          | Topo-walk the DAG, spawn worktree per task, gather results. |
| `subagent-manager.ts`   | Per-task agent loop, retry budgets, escalation. |
| `consolidator.ts`       | Merge accepted diffs into trunk, open PR via `gh`. |
| `verification-mesh.ts`  | Dual-arbiter judge/critic, INV-15 safety gate, drift detection. |
| `agent-router.ts`       | Role → provider mapping with fallback chains; emits `provider_selected`. |
| `ledger.ts`             | Phase-4 SHA-256-chained JSONL event log, `verify()`, tamper detection. |
| `capability-manifest.ts`| Per-provider role/tag scoring; backs Thompson Sampling (M013, post-v0.1). |
| `sandbox.ts`            | TS wrapper around the Rust sandbox binary + non-Linux consent fallback. |
| `indexer-client.ts`     | Unix-socket RPC to the indexer daemon (tree-sitter + embeddings). |
| `contextforge-client.ts`| Best-effort HTTP client to the parallel ContextForge service. |

### `crates/apohara-indexer/`

Rust daemon that owns the code knowledge graph.

- **Storage:** `redb` (zero-deps embedded KV).
- **Parsing:** tree-sitter for 18 languages, hits every changed file on
  watch.
- **Embeddings:** Nomic BERT loaded via `candle`. Tests gate the model
  load behind `APOHARA_MOCK_EMBEDDINGS=1` so CI / dev loops don't OOM —
  see `CLAUDE.md §8.1` for the hard rule.
- **API:** Unix-socket JSON-RPC. `searchMemories(query, k)` powers
  similarity search; `getBlastRadius(file, symbol)` powers the impact
  warning in PRs.

### `crates/apohara-sandbox/` — M014

The syscall-level enforcement boundary. Three runtime layers:

| Layer | Source | Mechanism |
|---|---|---|
| Permission tier model | `src/permission.rs`  | `ReadOnly`, `WorkspaceWrite`, `DangerFullAccess`. Serde-roundtrippable, parsed from the TS wrapper's tier string. |
| Syscall allowlists    | `src/profile/syscalls.rs` | Static `&[&str]` arrays per tier (~45 pure-allow entries + conditional `openat` for ReadOnly, conditional `fcntl` + `ioctl` for WorkspaceWrite). |
| BPF filter            | `src/profile/linux.rs`    | Compiles the manifest to a real `BpfProgram` via `seccompiler::compile_from_json`. Default mismatch action = `errno(EPERM)` so violations are observable failures, not SIGSYS kills. |
| Namespaces            | `src/namespace.rs`        | `unshare(CLONE_NEWUSER \| CLONE_NEWNS \| CLONE_NEWPID)` + the three uid/gid/setgroups writes that unlock unprivileged operation. |
| Runner                | `src/runner/imp.rs`       | Two-fork chain: parent → middle child unshares → grandchild dups pipes + chdir + installs seccomp + `execvp`s. Exec failures surface via a CLOEXEC error pipe. |

The two-fork shape is structural: `unshare(CLONE_NEWPID)` only takes
effect for the *next* child of the unsharer, so the grandchild is the
first process inside the new PID namespace. The middle child also
isolates the orchestrator from the user/mount-ns move.

### `packages/desktop/` — M017

Tauri v2 + React 19 + Bun.serve. Three panes plus a cost-meter top bar:

- `src/components/ObjectivePane.tsx` — textarea, Enhance, Run, error banner.
- `src/components/SwarmCanvas.tsx` — `@xyflow/react` DAG; node state classes from `task_scheduled`/`task_completed`/`task_failed`; mesh-verdict sentinels.
- `src/components/CodeDiffPane.tsx` — file tree + Monaco `DiffEditor` (vs-dark, inline); reconstructs file snapshots from `file_created` / `file_modified` payloads.
- `src/components/CostMeter.tsx` — cumulative tokens + USD + savings; GPU/Cloud routing toggle wired to `/api/mode`.

The Bun.serve backend exposes `/api/enhance`, `/api/run`,
`/api/session/:id/events` (SSE), `/api/mode`, `/api/health`. The SSE
endpoint tails `.events/run-<sid>.jsonl` via `fs.watch`, holding back
partial JSON lines on byte-offset boundaries so the React stream never
sees half an event.

---

## 4. The event ledger

Every meaningful action in Apohara — provider selection, contextforge
savings, task scheduling, sandbox execution, mesh verdict, PR open —
writes one line of JSON to `.events/run-<sid>.jsonl`.

Phase 4 hardened the ledger with a **SHA-256 hash chain**:

```
{ ..., prev_hash: "00..00", hash: "h1" }   ← genesis
{ ..., prev_hash: "h1",     hash: "h2" }   ← first event
{ ..., prev_hash: "h2",     hash: "h3" }   ← second event
                                ▲
                                │
                                └ each event's prev_hash must equal the
                                  previous event's hash, OR
                                  EventLedger.verify() returns brokenAt: i.
```

`apohara replay <run-id>` walks the chain and refuses to render a run if
verify() fails. The CLI's `--dry-run` flag emits deterministic JSON
suitable for diffing across machines, which is what underpins the
"reproducible incident triage" use case.

---

## 5. The provider router

`src/providers/router.ts` knows about 21 LLM providers and exposes
`completion({ messages, agentId, provider })`. Highlights:

- **Routing modes** (M015.5): `gpu` prefers `carnice-9b-local`; `cloud`
  prefers `process.env.APOHARA_CLOUD_PROVIDER` (default `opencode-go`).
- **Fallback chains**: each role (`planner`, `coder`, `critic`, `judge`)
  has an ordered fallback list in `agent-router.ts`'s `ROLE_FALLBACK_ORDER`.
- **OAuth**: Gemini works via the Google PKCE flow; Anthropic is gated
  by TOS and currently disabled.
- **Capability score** (post-v0.1, M013): every call updates a Beta
  distribution per (provider, role) in `capability-manifest.ts`; the
  router samples to pick the next call (Thompson Sampling) with 5%
  exploration traffic.

---

## 6. Determinism and replay

The orchestrator is deterministic *given* the ledger and the providers'
responses. Two practical consequences:

1. **`apohara replay`** rebuilds the DAG, the verification mesh
   decisions, the cost meter, and the final diff *without* re-calling
   any provider. It's what the desktop UI uses to render a finished run
   in scrub mode.
2. **`apohara replay --dry-run --json`** emits the canonical action plan
   for the run. Diffing two `--dry-run` outputs across machines confirms
   that two clients agree on what should happen — which is the building
   block for the future paired-execution mode (M013.5 + Phase 7).

---

## 7. Build + distribution

| Artifact | Source | Size |
|---|---|---|
| `apohara` CLI bundle (`dist/cli.js`) | `bun build src/cli.ts --target node` | ~3 MB JS |
| `apohara-indexer` daemon | `cargo build -p apohara-indexer --release` | ~12 MB |
| `apohara-sandbox` binary | `cargo build -p apohara-sandbox --release` | ~5 MB |
| `apohara-desktop` (Linux ELF) | `cd packages/desktop && bun run tauri:build` | **5.6 MB** ✅ |
| `apohara-desktop` (.deb) | same | 1.9 MB |
| `apohara-desktop` (AppImage) | same | 78 MB (webkit2gtk bundled) |
| `apohara-desktop` (.dmg, macOS) | CI matrix on `macos-latest` | (pending) |
| `apohara-desktop` (.msi, Windows) | CI matrix on `windows-latest` | (pending) |

The cross-OS matrix lives in
[`.github/workflows/desktop-release.yml`](.github/workflows/desktop-release.yml)
and fires on `v*` tag pushes; PRs touching `packages/desktop/` get a
smoke-build only (no artifact upload) so packaging regressions surface
before merge.

---

## 8. Test architecture

- **Rust**: `cargo test -p <crate> --lib`, then one `--test <bin>` at a
  time. Never bare `cargo test` — see `CLAUDE.md §8.1` for the OOM rule
  on the indexer's BERT load.
- **TypeScript**: `bun test tests/<file>.test.ts`. Tests that exercise
  fs paths use `mkdtemp(tmpdir())` for hermetic isolation.
- **E2E (visual)**: `bun run --filter @apohara/desktop e2e` runs
  Playwright against the live `:7331` dev server.
- **CI**: `.github/workflows/ci.yml` runs Bun 1.3.13 (pinned — 1.4.x
  regressed `fs.promises.appendFile` await timing, surfacing as ENOENT
  in EventLedger tests).

---

## 9. Pointers

- **Roadmap:** [`ROADMAP.md`](ROADMAP.md) — milestone-level state.
- **Engineering contract:** [`CLAUDE.md`](CLAUDE.md) — guardrails for
  every commit (surgical changes, gitnexus impact analysis, simplicity
  first).
- **GitNexus reference:** [`AGENTS.md`](AGENTS.md) — code-intelligence
  surface; auto-managed `<!-- gitnexus:start -->`–`<!-- gitnexus:end -->`
  block.
- **INV-15 paper:** [DOI 10.5281/zenodo.20114594](https://doi.org/10.5281/zenodo.20114594).

---

*Document anchored 2026-05-12 against commit `b58dbca`. Update in place
when capabilities land; never rewrite from scratch.*
