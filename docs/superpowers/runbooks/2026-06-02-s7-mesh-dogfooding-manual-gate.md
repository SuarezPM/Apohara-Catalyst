# S7 — Mesh Dogfooding Manual Gate (real CLIs)

> The **master acceptance criterion** of the bake-off → collaborative-mesh
> transition (vision spec L77): point the LIVE mesh path at a clone/branch of a
> real repo, run an objective, and confirm ≥2 heterogeneous blades produce
> **real, integrated, gate-green** changes a human can review.
>
> The hermetic half is automated (`crates/apohara-desktop-dioxus/tests/dogfooding_mesh.rs::mesh_pipeline_plan_assign_integrate_to_green_diff`). THIS runbook is the
> real-CLI half — heavy (real `claude`/`codex`/`opencode` + the desktop
> runtime + your judgement), so it is NOT in CI. Run it before recommending
> `APOHARA_MESH` for default.

## Preconditions

- At least 2 of the active providers resolve on `PATH` and are logged in:
  `claude` (claude-code-cli), `codex` (codex-cli), `opencode` (opencode-go).
  Check with `apohara doctor`.
- A throwaway clone/branch to dogfood on (the mesh writes real commits to HEAD):
  ```sh
  git clone <repo> /tmp/apohara-dogfood && cd /tmp/apohara-dogfood
  git switch -c mesh-dogfood
  ```

## Run

1. Launch the desktop with the mesh flag ON (it is OFF by default — the bake-off
   is the default path):
   ```sh
   cd /tmp/apohara-dogfood
   APOHARA_MESH=1 APOHARA_RUST_DISPATCH=1 \
     cargo run -p apohara-desktop-dioxus
   # WEBKIT_DISABLE_DMABUF_RENDERER=1 if the webview misrenders on Wayland.
   ```
   Optional knobs: `APOHARA_MESH_MAX_TICKS=<n>` (default 600),
   `APOHARA_CONSENSUS=1` (opt-in plan refinement), `APOHARA_BLADE_CAPACITY=<n>`.

2. Type an objective that NAMES ≥2 disjoint surfaces so the planner fans out
   (e.g. `improve error handling in src/foo.rs and add a test in tests/bar.rs`).
   Press Run (the IDE-mode Run button → `DISPATCH_TX` → `run_dispatch_mesh`).

3. Watch the surfaces light up from the LIVE signals (no fixtures):
   - **Graph / DAG** — the per-run master plan: `plan` → `impl-*` (one per
     surface) → `integrate`.
   - **Board / Kanban** — each `impl-*` card moves Ready → In Progress →
     Verifying → Done, tagged with the runner that claimed it (the node-id
     claim records via `claim_watcher`).
   - **Active Providers rail** — `{ready}/N` + per-runner health, fed by the
     `utilization_watcher`'s real `ready_count` (S2); idle blades with ready
     work surface `zero_idle_ok = false`.

## The gate (what you are accepting)

PASS requires ALL of:

- [ ] **≥2 heterogeneous blades** claimed DISTINCT `impl-*` slices (no
      double-assignment; distinct runner tags on the Board cards).
- [ ] The mesh diff (CodeDiffPane, tagged `mesh`) is **non-empty** and is the
      **integrated** `git diff <base> HEAD` — both slices present, no conflict
      residue. `git status --porcelain` is clean; `git fsck --full` is clean.
- [ ] The change is **gate-green** and a real, reviewable improvement — you would
      accept this diff into the branch.
- [ ] A 2nd Run on the SAME repo dispatches a FRESH `plan` (no silent empty-diff
      no-op — the per-run DAG namespacing, Change 2).
- [ ] **PLAN-phase read-only held** (S4): the `plan` blade never mutated files
      (any write attempt was refused with exit 2 by the CLI claim-guard).
- [ ] The audit trail exists: `<repo>/.apohara/audit/mesh-desktop-*.jsonl` (0600)
      carries `claim_acquired` + `merge_completed`; `mesh-mcp-*.jsonl` carries
      `message_sent`. No secrets/tokens/bodies in any payload.

## On PASS

Record the run (objective, providers, diff summary) and only THEN consider the
separate, explicit decision to graduate `APOHARA_MESH` toward default — that
decision is out of scope for the transition plan (OQ5).

## On FAIL

- Empty diff on the 1st run → check the planner fanned out (objective named ≥2
  surfaces); a thin DAG falls back to a single `implement` slice (Escenario 3).
- Empty diff on the 2nd run → would be `done`-poisoning (Escenario 4); the
  per-run subdir should prevent it — file a regression if seen.
- A blade hangs → `runSerialized` (per-binary FIFO) + the reaper should recover;
  the loop is bounded by `MAX_TICKS`. Capture `<repo>/.apohara/claims` + logs.
