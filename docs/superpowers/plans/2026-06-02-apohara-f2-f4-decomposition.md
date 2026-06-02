# Apohara BYOC — F2-F4 Story Decomposition

> Continuation of the F0+F1 vertical slice (DONE: commits `8b778d5..8960bf2`, 10/10 stories,
> 343 tests green, 4 adversarial code-reviews). Source plan: `2026-06-02-apohara-vision-realign-byoc-implementation.md` (rev7, deliberate APPROVED).
> Scope chosen by Pablo: full F0→F4. F2-F4 is explicitly **multi-session**.

This file decomposes the plan's high-level F2/F3/F4 phases into executable stories
with testable acceptance criteria, carrying forward the pre-mortem insights.

## ⚠️ Carry-forward follow-ups from F0+F1 (fold into the relevant F2 story)
- **F1.4 follow-up:** generalize per-blade isolation beyond `CLAUDE_CONFIG_DIR` to codex/opencode config-dir env vars (today only claude is isolated). → fold into **F2.0**/F2.2.
- **F1.1 follow-ups:** `release_if_still_stale` (conditional release re-checking staleness under the lock, closes the reaper TOCTOU wasted-work window); PID-reuse hardening via process start-time; reaper batch error-resilience (a corrupt record aborts the whole batch). → fold into **F2.1** (reaper unification).
- **F1.6 follow-up (project-wide NIT):** `repo_path.to_str().unwrap()` panics on non-UTF-8 paths; sweep to `Command::arg(OsStr)`.

---

## Fase 2 — Mesh completo + scheduler + push

### US-F2.0 — Mesh-protocol enforcement (DE-RISKING, do FIRST) ⭐
**Why first:** Pre-mortem Escenario 1 — an opaque CLI has NO native incentive to use the mesh; MCP-pull is *available* but not *forced*. If a blade never calls `claim_task`/`check_inbox`, the mesh is theoretical. This story makes it REAL.
- The blade spawn prompt (`DispatchRequest.prompt`, `cli_driver.rs:134` injection point) MUST explicitly instruct: "claim_task before touching any file; check_inbox every N steps; report_result when done". Inject the mesh MCP endpoint (port+token from F0.1 bootstrap) into each blade's MCP config via the existing injection adapters.
- A **PreToolUse hook** (via `apohara-hooks`/`apohara-hooks-server`) blocks a blade's file-write when it holds NO active claim for the task (protocol-by-convention reinforced by the hook).
- **Acceptance:** an integration test where a simulated blade that writes WITHOUT an active claim is BLOCKED by the hook; a blade that claims-then-writes succeeds. The spawn prompt provably contains the claim/check_inbox/report instructions. Observability: "writes-without-claim" counter (Escenario 1 detector).

### US-F2.1 — Wire apohara-coordinator with real storage (DAG scheduler)
- Replace the mock (`coordinator.rs:122` Coordinator, `:137` MockTask) with real storage behind a trait (incremental swap). The coordinator becomes the DAG scheduler over the F1.1 `TaskGraph`.
- Unify the F1.1 standalone reaper with the coordinator's `StallDetected` (`coordinator.rs:246`) now that the circular dependency F1.1↔F2.1 is resolved. Fold in the F1.1 reaper follow-ups (release_if_still_stale, PID start-time, batch resilience).
- **Acceptance:** `Coordinator::tick` over the real Shared Task List unblocks tasks whose deps resolved; the reaper releases stale claims through the unified path; no mock left in the live path. Test: deps-gated scheduling + stale-release over real storage.

### US-F2.2 — Configurable equitable distribution (anti-idle)
- Default affinity + balancing (reuse `auto_spawn::decide_auto_spawn`, `auto_spawn.rs:78`), configurable per project. MUST respect runSerialized (never 2 tasks/binary in parallel without the green non-contention gate). Option to promote the integrator to a dedicated roster blade.
- **Acceptance:** with unblocked work, no blade sits idle (anti-idle); the scheduler never assigns 2 same-binary tasks concurrently; distribution policy is project-configurable. Test: zero-idle-with-available-work + no same-binary-parallel.

### US-F2.3 — Push-hooks (latency improvement, fulfills R13)
- Server→CLI channel via each CLI's hook-runtime (PreToolUse/Stop reinjecting shared context). The F1.2 poll `check_inbox` stays as the **permanent fallback** (push is opaque/per-CLI).
- Layer ack-before-clear on top of the F1.2 mailbox (the F1.2 drain-on-read tradeoff note).
- **Acceptance:** push delivers a message with latency < the poll interval; poll still works when push is unavailable for a blade. Test: push-delivery latency < poll + poll-fallback.

### US-F2.4 — Utilization dashboard
- Per-blade utilization (anti-idle measured live), wall-clock vs sequential estimate, gates, % acceptance, over `apohara-token-accounting`. Show blades excluded for not speaking MCP (F1.3). **Tokens-per-run + configurable budget/throttle** (Escenario 4 — economic viability of bootstrapping).
- **Acceptance:** dashboard shows zero idle while unblocked work exists; per-blade tokens-per-run surfaced; a budget cap throttles spawns. Audit log JSONL of claims/messages/merges (reuse `apohara-audit`, fchmod 0600).

---

## Fase 3 — Planner socrático + consenso

### US-F3.1 — Native Socratic planner → MASTER PLAN (DAG)
- Apohara's own Socratic engine (own logic, **zero tokens**) turns a prompt into a MASTER PLAN as a `TaskGraph` DAG with declared deps. This is where good orthogonal decomposition is born (Escenario 3: F1's value depends on F3's decomposition quality).
- **Acceptance:** given a prompt, the resulting DAG has ≥2 nodes with declared dependencies and 0 cycles (reuse the F1.1 `has_cycle` guard). Prefer file-disjoint decomposition (the manual F1.7 discipline, now automated where possible).

### US-F3.2 — Opt-in consensus mode (PLAN phase only)
- Consensus only in the PLAN phase (configurable: own logic by default + consensus opt-in, R9). ≥2 blades emit plan refinements; the final plan differs from the draft.
- **Acceptance:** in consensus mode, ≥2 blades emit refinements and the final plan ≠ the initial draft. Test: consensus alters the plan.

---

## Fase 4 — Capas de producto

### US-F4.1 — Per-blade × phase permissions
- plan = read-only, exec = write, review = human, enforced over `PermissionRequest` (R16: per-blade × per-phase).
- **Acceptance:** a blade in the PLAN phase cannot write (read-only enforced; a write attempt is rejected). Test: plan-phase write rejected.

### US-F4.2 — Persistent mesh memory
- `apohara-episodic` + `apohara-indexer` + persist the mesh context (decisions + handoffs) in sqlite (R15/16).
- **Acceptance:** after close+reopen, the mesh context recovers from sqlite and a NEW blade reads it. Test: persist→restart→recover.

### US-F4.3 — Context Forge compression (external sidecar via MCP)
- LLMLingua-2 compression of the shared context. **External Python sidecar** (`SuarezPM/Apohara_Context_Forge`, `apohara-context-forge/`), invoked **via MCP** (tool `get_optimized_context` — VERIFY the exact tool name in the sidecar's `mcp/server.py` before the test). NOT a Rust workspace lib. Escenario 4 lever (−44% shared context).
- **Acceptance:** ≥1 MCP call to the sidecar's compression tool with `tokens_saved > 0`.

### US-F4.4 — Opt-in guided mode + Vibecoding skin
- Guided mode (reuse `apohara-event-humanizer`) emits narration in parallel WITHOUT stalling dispatch (R14 hybrid: swarm works while Apohara explains, only if the user opted in). Vibecoding skin mounts over the same IDE Mode engine (R8: one engine, two densities — IDE-dense first).
- **Acceptance:** guided mode emits narration in parallel without slowing dispatch; the Vibecoding skin renders over the same engine.

---

## Execution notes
- Same discipline as F0+F1: explore → delegate to executor (omit `model` → inherits session opus) → independently verify (build/test/clippy, `--all-targets` on public-API signature changes) → adversarial code-review for concurrency/HEAD/auth-critical stories → atomic commit per story on `feat/apohara-catalyst`.
- Everything stays behind `APOHARA_RUST_DISPATCH` where it touches the live dispatch path; additive, no regression of the desktop v2 harness.
- F2.0 is the highest-leverage next story — without forced protocol usage, the F0+F1 mesh primitives stay theoretical when real blades run.
