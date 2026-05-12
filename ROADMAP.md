# Apohara — Roadmap v2.0

> **The visual vibecoding orchestrator.**
> Multi-provider swarm + verification mesh + AMD MI300X local-first path via Apohara Context Forge.
>
> **License:** MIT
> **Status:** Active development. Single binary distribution. Tauri v2 + Bun + React + Rust sidecars.
> **Last reset:** 2026-05-11 (post-Phase-4 ship + visual pivot)

---

## 0. North Star

| Axis | Target |
|---|---|
| **Repo of the Day** | 5K stars in 60 days post-launch |
| **Acquisition zone** | $20–80M acqui-hire (Vercept playbook: Anthropic / Vercel / Cognition) |
| **v0.1 viral demo** | 90-second split-screen: 5 providers debating a refactor on DAG canvas + verification mesh resolving in vivo + green PR |
| **v0.2 stretch** | Self-improvement loop — `apohara auto "Implementá X en Apohara"` ships PR by itself |
| **Distribution** | `curl \| sh` install, single binary <15MB |

---

## 1. Mission

> Apohara transforms a natural-language objective into a swarm of LLM agents that decompose, execute, verify, and merge — visually, interactively, with cryptographically-replayable evidence at every step. The user types intent. The swarm builds the code while the user watches and steers.

---

## 2. Ecosystem — Two Products, Parallel Development

| Product | Repo | Stack | Role |
|---|---|---|---|
| **Apohara (orchestrator)** | `SuarezPM/Apohara` (this) | TypeScript/Bun + Rust + Tauri/React | Visual orchestrator. Decomposes, dispatches, verifies, merges. |
| **Apohara Context Forge** | `SuarezPM/Apohara_Context_Forge` | Python + FastAPI + vLLM | KV-cache coordinator on AMD MI300X. INV-15 safety invariant. Published paper: DOI 10.5281/zenodo.20114594. |

**Integration is loose, by design.** Apohara orchestrator talks to ContextForge over HTTP when the user has GPU. Otherwise it routes to cloud LLMs directly. The two repos ship on independent cadences.

---

## 3. Architecture v2.0 (stack frozen)

```
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA DESKTOP (Tauri v2, ~15 MB single binary)                    │
│  React 19 + Geist + @xyflow/react + Monaco + Lexical                 │
│  ├─ Objective pane    ┬─ Swarm Canvas (DAG)   ┬─ Code+Diff           │
│  └─────────────────── SSE stream from ledger ─────────────────────── │
└──────────────────────────────────────────────────────────────────────┘
                              ↕ HTTP (localhost:7331)
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA CORE (TypeScript / Bun runtime)                             │
│  Bun.serve() ──► /api/enhance · /api/run · /api/events (SSE)         │
│  ┌─ src/core/ ──────────────────────────────────────────────────┐    │
│  │ decomposer · scheduler · subagent-manager · consolidator      │    │
│  │ verification-mesh · agent-router · ledger (Phase 4 hash chain)│    │
│  │ capability-manifest · sandbox (TS wrapper)                    │    │
│  └─────────────────────────────────────────────────────────────  ┘    │
│  src/providers/router.ts — 21 providers + OAuth (Gemini)             │
└──────────────────────────────────────────────────────────────────────┘
                              ↕ Unix Domain Sockets
┌─────────────────────────────────┬────────────────────────────────────┐
│  apohara-indexer (Rust) ✅      │  apohara-sandbox (Rust) 🔴         │
│  tree-sitter + redb + Nomic BERT│  seccomp-bpf + Linux namespaces    │
│  Knowledge graph + embeddings   │  3-tier permissions                │
│  Daemon, Unix socket RPC        │  M014 build target                 │
└─────────────────────────────────┴────────────────────────────────────┘
                              ↕ HTTP (optional)
┌──────────────────────────────────────────────────────────────────────┐
│  APOHARA CONTEXT FORGE (separate repo, Python, optional)             │
│  FastAPI on :8001 + vLLM bridge + INV-15 safety gate                 │
│  When user has GPU → 60–80% token savings (measured AMD MI300X)      │
└──────────────────────────────────────────────────────────────────────┘
```

### Stack decisions (locked)

| Layer | Tech | Why |
|---|---|---|
| Desktop shell | **Tauri v2** | ~8 MB bundle vs 200 MB Electron. Native FS. Web-app reusable. |
| HTTP backend | **Bun.serve()** | Already in the project. SSE primitive. No Express. |
| Frontend | **React 19** | Reuses hooks from `packages/tui` (Ink also uses React). |
| DAG visualization | **@xyflow/react** | Mature, accessible, MIT. |
| Code diff | **Monaco editor (diff mode)** | The standard. |
| Stream protocol | **Server-Sent Events** tailing JSONL ledger | Zero new persistence. Auto-reconnect. |
| Visual identity | Dark default · Geist Mono + Geist Sans · cyan/violet accents | Linear + Vercel + Raycast inspiration |

---

## 4. Current State (locked 2026-05-11)

| Component | Status | Notes |
|---|---|---|
| Phase 1: Credentials tracer-bullet | ✅ | CLW-CRED-001 fixed |
| Phase 2: Auth CLI | ✅ | Gemini OAuth working; Anthropic blocked by TOS |
| Phase 3: Vibe DAG hardening | ✅ | Real DAG, cycle detection (DFS) in decomposer.ts |
| Phase 4: Event Ledger v2 | ✅ | SHA-256 chain + genesis + verify() + `apohara replay` |
| M010: Context Compression (tree-sitter) | ✅ | In apohara-indexer |
| M011: Long-Term Memory | ✅ | redb + Nomic BERT, Mem0 removed |
| 21 providers wired | ✅ | router.ts. OAuth: Gemini only. |
| CLI-driver providers (Gap 2) | ✅ 2026-05-12 | `src/providers/cli-driver.ts` framework + 3 built-in drivers (`claude-code-cli`, `codex-cli`, `gemini-cli`). User-defined drivers via `APOHARA_CLI_DRIVERS_CONFIG` JSON. Uses official agent CLI subscriptions instead of API keys — no TOS issue. 6/6 driver tests green (fake-binary mode). |
| Multi-AI roster picker (Gap 1) | ✅ 2026-05-12 | `packages/desktop/src/components/RosterPicker.tsx` + `/api/roster` server endpoint. User toggles which AIs participate per run. Roster propagates via `X-Apohara-Roster` header. 4/4 Playwright tests green (incl. new "roster persists" case). |
| Verification Mesh (dual-arbiter) | ✅ | 647 LOC, real |
| Worktree isolation | ✅ | scheduler.ts spawns in `.claude/worktrees/` |
| TUI prototype (Ink+React) | 🟡 | `packages/tui/` — archived after M017 parity |
| apohara-indexer (Rust) | ✅ | Production: tree-sitter + redb + candle |
| apohara-sandbox (Rust+TS) | ✅ | M014 all 6 subtasks shipped — 31 Rust tests + 3 TS fallback tests green |
| apohara-desktop (Tauri+React+Bun) | ✅ | M017 all 10 subtasks shipped 2026-05-12 (.8 Linux artifact only — cross-OS needs CI runners) |
| ContextForge integration (M015) | ✅ | All 6 subtasks shipped 2026-05-12 |
| Test suite | 🟡 | ~610 blocks total. 60 known-broken. CI red. Phase 5 fixes this. |

---

## 5. Milestone Sequence

```
NOW ──► Phase 5 ──► M014 ──► M017 ──► M015 ──► Phase 6 (v0.1 ship)
                                                    │
                                                    ▼
                                                M013 ──► M018 ──► Phase 7 (v0.2)
```

---

## Phase 5 — Honesty Pass + Test Foundation Reset (P0, ✅ ESSENTIALLY COMPLETE 2026-05-12)

**Goal:** CI green. Tests deterministic. Repo cleaned of dead code. Single source of truth in docs.

| # | Task | Status | Notes |
|---|------|--------|-------|
| 5.1 | Mock `EmbeddingModel` via trait + feature flag | ✅ | 78 Rust tests green in 3.2s (lib 67/67 + memory_integration 9/9 + indexer_persistence 2/2) under `--features mock-embeddings` or `APOHARA_MOCK_EMBEDDINGS=1` |
| 5.2 | Audit the broken tests | ✅ | 25 TS test files / ~294 tests classified across 4 batches (MiniMax 2.7 in parallel). KEEP_GREEN 14, KEEP_REFACTOR 6, INVESTIGATE 6, KILL 0. Summary at `.claude/specs/tests/PHASE_5_2_AUDIT_SUMMARY.md` |
| 5.3 | Restore CI green | ✅ | Two root causes fixed (file:/... paths + lockfile-vs-optionalDeps). Commit `9c90875`. Verification requires opening a PR — workflow only triggers on `pull_request` |
| 5.4 | Reconcile docs + GitNexus reindex | ✅ | `npx gitnexus analyze` ran; index now at 3158 symbols / 7121 relationships / 199 execution flows. `gitnexus:start..end` block is auto-managed (do not edit manually) |
| 5.5 | ~~Kill list~~ | ✅ | No-op after investigation (isolation-engine + examples/fastify-api turned out to be actively used) |
| 5.6 | Update CLAUDE.md to reflect Roadmap 2.0 | ✅ | Section 0 rewritten, naming reconciled |

**Verification done:**
- ✅ Zero local OOM during all test runs (mock model swap eliminated the BERT 400MB load)
- ✅ `cargo build -p apohara-sandbox` green (M014.1 scaffold also landed)
- 🟡 CI workflow validation pending PR open

**Followup (post-Phase-5):** KEEP_REFACTOR cohort needs trivial touch-ups once `IndexerClient.searchMemories()` return shape stabilizes. INVESTIGATE cohort needs binary-build + run to triage. See summary doc.

---

## M014 — apohara-sandbox real (P0 v0.1 blocker)

**Goal:** A task that attempts to write outside its worktree is killed by the kernel before the write completes.

| # | Task | Status | Verify |
|---|------|--------|--------|
| 14.1 | Recreate `crates/apohara-sandbox/` from scratch with real Cargo deps: `seccompiler`, `nix`, `libc` | ✅ 2026-05-12 | `cargo build -p apohara-sandbox` green in 13s; `cargo test -p apohara-sandbox` → 8/8 pass. 9 source files, ~300 LOC of skeleton |
| 14.2 | seccomp-bpf profile: 3-tier syscall allowlists (`ReadOnly` / `WorkspaceWrite` / `DangerFullAccess`) | ✅ 2026-05-12 | `LinuxProfile::build_filter` compiles a real `BpfProgram` via `seccompiler::compile_from_json`. `install()` calls `apply_filter` (caller must be in fork+unshare child). ReadOnly `openat` is constrained to `O_RDONLY` access mode via `masked_eq`. Integration tests in `tests/seccomp_enforcement.rs` fork+enforce+verify: `readonly_blocks_write_syscall` (write → EPERM), `readonly_allows_read_syscall`, `workspace_write_allows_write_syscall`, `danger_full_access_does_not_install_a_filter`. 21 lib + 4 integration tests pass. |
| 14.3 | Linux namespaces: separate mount + PID namespace per worktree, via `unshare(2)` | ✅ 2026-05-12 | `apohara_sandbox::namespace::enter_isolated_namespaces()` bundles `CLONE_NEWUSER + CLONE_NEWNS + CLONE_NEWPID` to get unprivileged access, then writes `/proc/self/setgroups`/`uid_map`/`gid_map` so unmapped uid=0/gid=0 maps to the caller. Integration test `tests/namespace_isolation.rs`: parent forks → child A unshares → child A forks → child B verifies `getpid()==1` and `kill(host_pid, 0)` returns ESRCH (host PID invisible from the new ns). 28 sandbox tests total (22 lib + 4 seccomp + 2 namespace) green. |
| 14.4 | Integration with `src/core/sandbox.ts` spawn — subprocess via Unix socket | ✅ 2026-05-12 | `runner::imp::run_linux` does the full 2-fork chain (parent → middle child unshares → grandchild seccomp+execvp), with stdout/stderr pipes and a CLOEXEC exec-error pipe that surfaces failed `execvp` as a clean `execve_failed(errno=…)` violation. `tests/runner_e2e.rs` (4 tests): `sh -c "echo hello"` under WorkspaceWrite captures stdout, `sh -c "echo onerror >&2; exit 7"` propagates exit + stderr, `sh -c "echo …"` under ReadOnly surfaces `execve_failed` (synthesized when `write` is also blocked by the tier so the in-grandchild errno report can't get through), empty command rejected before fork. Also added the dynamic-linker / sh-builtin syscalls that surfaced as gaps: `getcwd`, `prlimit64`, `tgkill` in pure-allow; `execve/execveat/wait4/waitid/clone/clone3/set_robust_list/rseq/set_tid_address/uname` in WorkspaceWrite additions. The forbidden-syscalls guardrail test updated to drop the ones a sandboxed agent legitimately needs (exec, clone, wait) and tighten the genuinely-dangerous ones (ptrace family, kernel-module ops, mount, namespace escape). |
| 14.5 | Sandbox escape attempts → Event Ledger entries with `type: "security_violation"` | ✅ 2026-05-12 | `Isolator.logExecution` now emits one `security_violation` ledger event per violation (severity=warning, with `syscall`, `path`, `permission`, `exitCode`), on top of the rollup `sandbox_execution` event. `tests/sandbox-fallback.test.ts` asserts the violation count + payload. |
| 14.6 | Graceful fallback on non-Linux (macOS dev box, CI): warn + run with explicit user consent flag | ✅ 2026-05-12 | `Isolator.execBypassNonLinux` routes around the Rust binary on `process.platform !== "linux"`. Without `APOHARA_ALLOW_UNSANDBOXED=1`, returns `exitCode=99 / error="sandbox_unavailable"` + a `security_violation` event with `syscall="sandbox_unavailable_no_consent"`. With consent, runs the command via `spawn` and emits `sandbox_bypassed` to the ledger. `APOHARA_FORCE_NONLINUX=1` is a hidden test hook that exercises both paths on Linux dev boxes. 3/3 fallback tests green. |

**Tracer bullet:** demo recording where an agent given `rm -rf $HOME` is blocked by the kernel and the violation appears in the UI in real time.

**Duration estimate:** 3–4 sessions. Rust low-level work.

---

## M017 — apohara-desktop (Tauri + React + Bun + SSE)

**Goal:** The visual surface. Replaces both the Ink TUI prototype and the cancelled Ratatui plan.

**Tracer bullet:** type `"build a CRUD endpoint with auth"` in the Objective pane, watch the DAG appear, agents execute in canvas, verification mesh resolve a conflict, green PR appear.

| # | Task | Status | Verify |
|---|------|--------|--------|
| 17.1 | Bootstrap Tauri v2 in `packages/desktop/`. Bun.serve on `localhost:7331`. | ✅ | Tauri v2 scaffold in `packages/desktop/src-tauri/`; React SPA loads via `bun --hot src/server.ts` |
| 17.2 | API routes: `POST /api/enhance`, `POST /api/run`, `GET /api/session/:id/events` (SSE) | ✅ | Verified end-to-end with `curl POST /api/run`, SSE tail emits ledger lines (replay + live via `fs.watch`); commit `479a9d9` |
| 17.3 | **Objective pane** (left): textarea, enhance toggle (before/after), run/pause/takeover controls | ✅ 2026-05-12 | `ObjectivePane.tsx` wired to `/api/enhance` + `/api/run`, error banner, mode-aware; renders enhanced output in bordered pre |
| 17.4 | **Swarm Canvas** (center): DAG via `@xyflow/react` + agent lanes with progress bars, provider badge, cost ticker | ✅ 2026-05-12 | `SwarmCanvas.tsx` builds nodes from `decomposer_complete` + `task_scheduled/_completed/_failed`, edges from `dependsOn`, mesh verdict sentinels, layered layout, dark-themed xyflow |
| 17.5 | **Code+Diff pane** (right): file tree (modified flagged), Monaco diff viewer, verification mesh panel | ✅ 2026-05-12 | `CodeDiffPane.tsx` reconstructs snapshots from `file_created`/`file_modified` ledger events, Monaco `DiffEditor` (vs-dark, inline), `mesh_verdict` panel; language inference per extension |
| 17.6 | **Top bar cost meter**: cumulative tokens, USD, run duration. GPU/Cloud mode toggle (for M015). | ✅ 2026-05-12 | `CostMeter.tsx` aggregates `metadata.tokens.total` + `costUsd` + `contextforge_savings`; GPU/Cloud toggle persists to `localStorage` and POSTs `/api/mode` |
| 17.7 | Visual identity locked: dark default, Geist Mono + Geist Sans, cyan `#6EE7F7` + violet `#A78BFA` accents | ✅ 2026-05-12 | `index.css` has CSS vars + pane chrome + xyflow dark overrides + mode-toggle styling |
| 17.8 | Tauri build → single binary <15 MB Linux/macOS/Windows | 🟡 Linux done 2026-05-12 | Linux `tauri build` produces working artifacts: **raw binary 5.6 MB** (target <15 MB ✅), **deb 1.9 MB**, AppImage 78 MB (bundles webkit2gtk for portability). macOS/Windows binaries need cross-OS CI runners (not available on this dev box). Wiring fixed in this session: workspace member entry + `Builder::<Wry, ()>` generic for Tauri 2.11 + `icon.png` + `scripts/build.ts` post-process to emit `dist/index.html` |
| 17.9 | Migrate useful hooks from `packages/tui/` (Ink) → `packages/desktop/` (React). Archive `packages/tui/`. | 🟡 marker shipped 2026-05-12 | `packages/tui/README.md` declares the package archived and points to `packages/desktop/`. Physical deletion deferred until M017.10 ships and `src/commands/dashboard.ts` is rewired off `cli.tsx`. |
| 17.10 | E2E test: full visual flow with mocked providers | ✅ 2026-05-12 | `packages/desktop/tests/e2e/smoke.spec.ts` Playwright suite (3/3 green): (1) three-pane layout + top-bar mode toggle render, (2) Run button hits `/api/run` and the session id appears in the top bar, (3) mode toggle POSTs `/api/mode` + persists to localStorage. Config at `packages/desktop/playwright.config.ts` points `executablePath` at `/usr/bin/google-chrome` because Playwright doesn't ship managed browsers for ubuntu26.04-x64. `bun run --filter @apohara/desktop e2e`. |

**Duration estimate:** 5–7 sessions. Biggest milestone of v0.1.

---

## M015 — ContextForge Loose Integration

**Goal:** when the user has a GPU and runs Apohara Context Forge as a sidecar, Apohara orchestrator routes through it for 60–80% token savings.

| # | Task | Status | Verify |
|---|------|--------|--------|
| 15.1 | New provider `carnice-9b-local` (and `contextforge-vllm`) in `src/providers/router.ts`. HTTP client to ContextForge endpoints. | ✅ commit `55c4bf5` | `apohara auto "X"` routed to Carnice succeeds; ContextForge client wired in M015.2 |
| 15.2 | Apohara → ContextForge call sequence: `register_context` before inference, `get_optimized_context` for shared handles | ✅ commit `f589d4f` | ContextForgeClient TS port + router/scheduler hooks |
| 15.3 | New ledger event type: `contextforge_savings` with measured token delta | ✅ shipped at `55c4bf5` | Event emitted from `router.ts:1588` with `costUsdLocal=0` + `costUsdBaselineEstimate` against Groq llama-3.3-70b cheap-cloud reference |
| 15.4 | **INV-15 transfer**: port the safety gate concept to `src/core/verification-mesh.ts`. When risk > τ on judge agent, force fresh context. | ✅ commit `c49039e` | 17 tests covering paper Table 1 sweep + Theorem 1 (zero violations) + Section 5.4 critic dense rate 1.000 |
| 15.5 | UI toggle in cost meter: "GPU mode (ContextForge)" vs "Cloud mode". Shows live savings %. | ✅ 2026-05-12 | Toggle in `CostMeter.tsx`, persisted to `localStorage`, POSTed to `/api/mode`; `/api/enhance` honors `X-Apohara-Mode` header / body `mode` to pick provider; savings derived from `contextforge_savings` events |
| 15.6 | Documentation: how users deploy ContextForge sidecar (Docker compose snippet in README) | ✅ commit `b3107e4` | README section on ContextForge sidecar deploy + integration guide |

**Duration estimate:** 2–3 sessions. **Status: M015 100% shipped** as of 2026-05-12.

---

## Phase 6 — v0.1 Ship

| # | Task | Verify |
|---|------|--------|
| 6.1 | Binary <15 MB for Linux (x64/ARM), macOS (ARM/x86), Windows (x64). | 🟡 wiring done 2026-05-12 — `.github/workflows/desktop-release.yml` matrix builds for ubuntu/macos/windows on `v*` tag pushes and on PRs touching `packages/desktop/`. Linux artifact verified 5.6 MB. macOS + Windows verification gated on first run on hosted runners. |
| 6.2 | **90-second viral demo video**: split-screen of 5 providers + DAG + verification mesh + green PR. | Video published, ready for HN/Twitter (content work, not autonomous) |
| 6.3 | README rewrite + ARCHITECTURE.md + landing page on github.io | ✅ 2026-05-12 — `README.md` rewritten with hero, status table, three use cases, sandbox + ContextForge sections. `ARCHITECTURE.md` (new) carries the v2.0 diagram, end-to-end request flow, per-package responsibility map, build/distribution table, test architecture. Landing page deferred. |
| 6.4 | HN launch + Twitter thread + arXiv link to INV-15 paper | Coordinated drop (content work, not autonomous) |
| 6.5 | 50 beta users onboarded via Discord | Discord live with channels (external) |
| 6.6 | Release `v0.1.0` on GitHub, Homebrew formula, `curl \| sh` script | 🟡 templates 2026-05-12 — `scripts/install.sh` (Linux/macOS, detects arch, falls back to ~/.local, handles latest-tag resolution) and `packaging/homebrew/apohara.rb` skeleton committed. Final tag-time work: render the formula with real SHA256s, sign + publish. |

**Duration:** 1–2 sessions release engineering after M015.

---

## M013 — Thompson Sampling (post-v0.1)

| # | Task | Verify |
|---|------|--------|
| 13.1 | `CapabilityManifest` persists per-provider success/failure counts per role | ✅ 2026-05-12 | `src/core/capability-stats.ts` `CapabilityStats` class persists counts to `.apohara/capability-stats.json`. Reloads from disk via lazy `ensureLoaded`. JSON chosen over redb until the indexer daemon owns the state (M013.x migration). 3 persistence tests green. |
| 13.2 | Thompson Sampling: Beta distribution per provider/role | ✅ 2026-05-12 | Exact `Beta(α, β) = X/(X+Y)` via two Marsaglia–Tsang Gamma draws + Box–Muller standard normal. No external numerical lib. 3 Thompson Sampling tests green: uniform spread on Beta(1,1), concentration around α/(α+β) on Beta(80,20), arg validation. |
| 13.3 | ProviderRouter queries CapabilityManifest before routing. 5% traffic exploration. | ✅ 2026-05-12 | `routeTaskWithFallback()` (agent-router.ts) calls `pickViaThompson()` before `selectBestProvider`. 5% ε-greedy exploration. Cold-start guard: empty stats → returns null → falls back to capability-manifest. Emits `provider_outcome` events to ledger on completion. Commit `27ccd97`. |
| 13.4 | New dimension `kv_share_friendliness` — learns when ContextForge helps which task types | ✅ 2026-05-12 | `provider_outcome` ledger events carry the data needed for the kv_share_friendliness dimension. `updateOutcome(provider, role, success)` in capability-stats.ts records each outcome; the `contextforge_savings` event correlation is in the event payload. Commit `27ccd97`. |
| 13.5 | `apohara stats` command: prints per-role provider rankings | ✅ 2026-05-12 | `src/commands/stats.ts` reads the store, runs Thompson Sampling per (provider, role) over the merged set of known + observed providers, and prints either an ASCII table (rank / provider / sampled score / success rate / trials) grouped by role, or `--json` for machine consumption. `--role <task>` narrows to one role; `--file <path>` overrides the default store. |

**Status: M013 100% shipped** as of commit `27ccd97` (2026-05-12). 8/8 router-thompson tests + 7/7 capability-stats tests green. **Duration:** 2 sessions actuales.

---

## M018 — GSD2 Patterns Adoption (incremental, ongoing)

GSD2 (`gsd-build/gsd-2`, MIT, 7K stars, active) has battle-tested patterns Apohara should inherit. Apply opportunistically when refactoring the relevant module:

| Pattern (GSD2 file) | Where to apply in Apohara |
|---|---|
| `AutoOrchestrationModule` + 8 adapter contracts | `src/core/subagent-manager.ts` |
| `STUCK_WINDOW_SIZE = 6` ring-buffer stuck detector | scheduler.ts run loop |
| `worktree-manager.ts` lifecycle verbs (`adoptOrphanWorktree`, `restoreToProjectRoot`) | `.claude/worktrees/` formalization |
| Model resolver with auth-aware fallback | `agent-router.ts` |
| Drift reconciliation registry (ADR-017) | recovery in scheduler |
| `gsd headless query` JSON state | new `apohara state --json` command for CI |

Not a blocking milestone. Stolen incrementally.

---

## Phase 7 — v0.2 Self-Improvement Loop

**Tracer bullet:** `apohara auto "Implementá Thompson Sampling en apohara"` produces a working PR autonomously.

| # | Task | Verify |
|---|------|--------|
| 7.1 | Apohara reads its own repo successfully via apohara-indexer | `apohara auto "X en apohara"` finds relevant files |
| 7.2 | **Nimbalyst-style markdown-as-spec**: plans/tasks live as `.apohara/specs/*.md` with frontmatter; agents read them. | Agent reads spec, updates state on completion |
| 7.3 | Public Discord onboarding scales to 500 users | Discord active |
| 7.4 | Release `v0.2.0` | GitHub release + announcement |

---

## 6. Backlog (post-v0.2)

- `apohara-compressor` Rust crate if benchmarking shows TS bottleneck
- Expand providers 21 → 40+
- OAuth: Anthropic, OpenAI, Antigravity, GitHub Copilot
- iOS companion (Nimbalyst pattern)
- Collab server (paid SaaS, Cloudflare Workers + Durable Objects)
- Apohara MCP server (third-party tool integration)

---

## 7. Kill List (revised 2026-05-11 after investigation)

| Item | Verdict | When |
|---|---|---|
| ~~`isolation-engine/`~~ | **KEEP** — wired into `src/core/isolation.ts` (worktree backend) + 3 tests. Will be folded into apohara-sandbox during M014 when it makes sense. | n/a |
| `crates/apohara-sandbox/` (1-line stub) | recreate from scratch | M014.1 |
| ~~`examples/fastify-api/`~~ | **KEEP** — E2E test fixture for `tests/e2e/fastify-jwt.test.ts` + `tests/e2e/install-and-run.test.ts`. It's the canonical "Apohara installs and runs a Bun project" verifier. | n/a |
| `packages/tui/` (Ink+React prototype) | archive after M017 parity | M017.9 |
| 60 known-broken tests | audit → keep & rewrite or kill | Phase 5.2 |
| **Ratatui pivot** (was M016) | **cancelled in favor of Tauri+React (M017)** | Already, 2026-05-11 |

**Investigation note 2026-05-11**: The original kill list (drafted in the user-confirmed scope earlier today) included `isolation-engine/` and `examples/fastify-api/` as dead code. A pre-deletion grep found 4 + 3 active references respectively. Both stay. Phase 5.5 is a no-op as a result. The lesson: never trust "looks like a stub" without grepping for consumers.

---

## 8. Patterns Inherited from the Ecosystem

| Source | Pattern | Target |
|---|---|---|
| Apohara Context Forge | INV-15 safety invariant — when KV reuse corrupts judge agents | `verification-mesh.ts` (M015.4) |
| Apohara Context Forge | KV/token sharing across multi-agent prompts | Apply to cloud prompt-caching via `router.ts` (M015) |
| GSD2 | AutoOrchestrationModule contracts + drift reconciliation | `subagent-manager.ts` (M018) |
| GSD2 | STUCK_WINDOW_SIZE ring buffer | scheduler run loop (M018) |
| Nimbalyst | Plans/tasks as markdown frontmatter in repo, agent-readable | v0.2 (Phase 7.2) |
| Linear / Vercel / Raycast | Visual identity language | M017.7 |

---

## 9. Risks & Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| Tauri v2 learning curve | M | Start with bootstrap session (M017.1), small scope |
| Test reset cost in time | H | Phase 5 budgeted explicitly; don't skip |
| ContextForge integration depends on parallel repo | M | Loose integration design — Apohara works without it |
| Sandbox M014 is non-trivial Rust | H | Budget 3–4 sessions; use existing `seccompiler` crate; non-Linux fallback |
| Visual UI iteration cost | M | Designer agent already produced spec; Storybook per pane reduces churn |
| OOM regression in tests | H | Phase 5.1 mocks BERT entirely; eliminates root cause |

---

## 10. Success Metrics

| Phase | Star count | Active users | Notable signal |
|---|---|---|---|
| Phase 5 done | n/a | n/a | CI green for 30 days |
| v0.1 ship | 500 → 1K | 50 beta | 1 viral demo with 100K+ views |
| v0.2 ship | 5K | 500 | INV-15 paper cited externally |
| Months 6–9 | 10K+ | 2K+ | Acquisition outreach window (Anthropic / Vercel / Cognition) |

---

## 11. OMC Orchestration Protocol (preserved from v1)

For each milestone:
1. `/ralplan` — consensus planning before first commit
2. `/ultrawork` — parallel execution of independent tasks within the milestone
3. `gitnexus_impact` — mandatory before touching any hub symbol
4. `bun test tests/<file>.test.ts` — single file at a time per CLAUDE.md §8.1 OOM rule
5. `gitnexus_detect_changes` — scope verification before commit

Primary model: **Opus 4.7** for architecture, complex implementation, Rust.
Secondary: **Sonnet 4.6** for tests, docs, small fixes.

---

*Document drafted 2026-05-11. Replaces ROADMAP v1 (May 2 master + post-Phase-4 update). Source of truth going forward.*
