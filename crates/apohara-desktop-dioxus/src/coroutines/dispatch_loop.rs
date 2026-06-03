//! `dispatch_loop` coroutine — owns the Run flow (W4.3 spawn+stream, W4.4
//! verify+diff).
//!
//! On `DispatchMsg::Run` it spawns each available provider CLI in its own git
//! worktree (R3: worktree before spawn), streams stdout into `SSE_EVENTS`,
//! captures the worktree `git diff`, runs the quality gates over it, picks the
//! winning diff into `CODE_DIFF`, and flips `RUNNING_STATUS` back to Idle.
//!
//! `on_line` runs on this coroutine's task (the `rx.recv().await` loop inside
//! `dispatch_streaming`), so writing `SSE_EVENTS` from it is runtime-safe.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use dioxus::prelude::*;
use futures_util::StreamExt;

use apohara_audit::{AuditEvent, AuditSink, EventKind};
use apohara_coordinator::{assign, Blade, Coordinator, DistributionPolicy, ReadyTask, TickOutcome};
use apohara_dispatch::api::{is_enabled, list_active_providers};
use apohara_dispatch::{
    build_master_plan, ClaimOutcome, ClaimRecord, ClaimStore, CliDriver, DispatchRequest,
    DispatchSchedulerStore, ReportOutcome, RunState, TaskGraph,
};
use apohara_types::intent::Intent;
use apohara_episodic::Episode;
use apohara_mcp::api::mcp_bootstrap_servers_inner;
use apohara_mcp::bootstrap::{EndpointDescriptor, EndpointServers};
use apohara_mcp::injection::{build_canonical_from_endpoint, inject_mcp_config, EndpointPorts, ProviderId};
use apohara_verification::{run_all_gates, AgentRole, GateInput};
use apohara_worktree::lifecycle::{self, CleanupReason, FailureReason, MergeResult};

use crate::state::code_diff::{self, Diff};
use crate::state::running_status::{set_status, RunStatus};
use crate::state::sse_events::{push_event, SseEvent};
use crate::state::tasks::{upsert_task, DagTask, TaskStatus};

/// Handle to the dispatch coroutine, published so the Run button can `.send()`.
pub static DISPATCH_TX: GlobalSignal<Option<Coroutine<DispatchMsg>>> = Signal::global(|| None);

/// Messages the dispatch loop accepts.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DispatchMsg {
    /// Run the given objective across the active providers.
    Run(String),
}

/// Mount the coroutine and publish its handle.
pub fn mount() {
    let tx = use_coroutine(|mut rx: UnboundedReceiver<DispatchMsg>| async move {
        while let Some(msg) = rx.next().await {
            match msg {
                DispatchMsg::Run(objective) => run_dispatch(objective).await,
            }
        }
    });
    use_effect(move || {
        *DISPATCH_TX.write() = Some(tx);
    });
}

/// One provider's run outcome, distilled to what the winner selection needs.
struct Candidate {
    provider_id: String,
    unified: String,
    files: Vec<String>,
    gates_passed: bool,
}

async fn run_dispatch(objective: String) {
    // US-S1 (bake-off -> collaborative mesh): fork at the very top. The mesh
    // body is OPT-IN (`APOHARA_MESH=1`) and presupposes the Rust claim/integrate
    // path (`APOHARA_RUST_DISPATCH != 0`). When either is off the bake-off body
    // below runs byte-for-byte unchanged — a mesh regression cannot affect a
    // session that didn't opt in (pre-mortem Escenario 1, M1.1).
    if mesh_enabled(std::env::var("APOHARA_MESH").ok().as_deref())
        && is_enabled(std::env::var("APOHARA_RUST_DISPATCH").ok().as_deref())
    {
        run_dispatch_mesh(objective).await;
        return;
    }

    set_status(RunStatus::Dispatching);

    // Feature-similarity recall (NOT semantic): surface up to top-k past
    // episodes with similar goals so the UI/context sees prior outcomes. Plain
    // text injection, no model call. Best-effort — a fresh store recalls
    // nothing and any error is non-fatal.
    emit_recall_event(&objective);

    let repo = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let providers: Vec<_> = list_active_providers()
        .into_iter()
        .filter(|p| p.available)
        .collect();

    // US-F1.4: the dispatch loop now claims each task through the cross-process
    // file-lock (F0.0) before spawning. Only the CLAIM is gated by the same
    // `APOHARA_RUST_DISPATCH` flag as `api::rust_dispatch_inner` (default ON;
    // export =0 to skip claiming, the pre-F1.4 behavior). Per-binary spawn
    // serialization is NOT gated — `dispatch_streaming_serialized` always runs
    // (the 120s-hang guard is never opt-out).
    let claim_enabled = is_enabled(std::env::var("APOHARA_RUST_DISPATCH").ok().as_deref());
    // One store for the whole run, rooted at the repo's claims dir (F0.0
    // convention: `<repo>/.apohara/claims`). Heterogeneous blade processes
    // contend on the same directory, so the path must be repo-stable.
    let claims = ClaimStore::new(repo.join(".apohara").join("claims"));

    // US-F2.0b — force blades onto the mesh. Pre-mortem Escenario 1: an opaque
    // CLI has no native incentive to coordinate, so we (1) inject the live mesh
    // MCP config into each blade's config location and (2) augment the prompt
    // with explicit mesh-protocol instructions. Same `APOHARA_RUST_DISPATCH`
    // gate as the claim path (legacy path = bare prompt, no injection).
    //
    // Resolve the live endpoint ONCE per run (idempotent — F0.1 OnceCell returns
    // the same descriptor). We carry forward the flattened ports + the bearer
    // token so the per-blade injection needs no further bus calls. Best-effort:
    // if the bus is disabled (APOHARA_RUST_MCP=0) or bootstrap fails, log and
    // continue with `None` — the prompt augmentation still applies, only the MCP
    // config wiring is skipped. The run must NEVER abort over mesh wiring.
    let mesh_endpoint: Option<(EndpointPorts, String)> = if claim_enabled {
        match mcp_bootstrap_servers_inner().await {
            Ok(descriptor) => Some((descriptor_to_ports(&descriptor), descriptor.token)),
            Err(e) => {
                tracing::warn!("mesh endpoint unavailable (non-fatal): {e}; blades run without MCP mesh config");
                None
            }
        }
    } else {
        None
    };
    // The canonical config the blade's CLI consumes carries the apohara binary
    // it spawns for `apohara mcp serve <name>`. Resolve our own executable so
    // the blade re-invokes THIS build; fall back to the bare name on the PATH.
    let apohara_bin = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "apohara".to_string());

    // US-F1.6: incremental integration is gated by the same flag as the claim
    // (default ON; `APOHARA_RUST_DISPATCH=0` keeps the legacy text-diff→Accept
    // path). `base` is HEAD before any merge, so the post-run mesh diff is
    // `git diff <base> HEAD` (the integrated result). `any_integrated` flips
    // once a merge lands so we know to show the mesh instead of `winning_diff`.
    let integrate_enabled = claim_enabled;
    let base = if integrate_enabled { git_rev_parse_head(&repo) } else { None };
    let mut any_integrated = false;

    let mut candidates: Vec<Candidate> = Vec::new();
    for p in providers {
        let task_id = format!("{}-{}", p.id, next_seq());

        // Claim the task before doing any work. On contention (another blade
        // already holds it) skip this task cleanly — `AlreadyClaimed` is a
        // normal signal, not an error. A claim-store error is non-fatal: log
        // and proceed without a token (best-effort, never strand the run).
        let claim_token = if claim_enabled {
            match claims.try_claim(&task_id) {
                Ok(ClaimOutcome::Acquired { token }) => Some(token),
                Ok(ClaimOutcome::AlreadyClaimed) => {
                    tracing::info!(task_id, "task already claimed by another blade; skipping");
                    continue;
                }
                Err(e) => {
                    tracing::warn!(task_id, "claim failed (non-fatal): {e}");
                    None
                }
            }
        } else {
            None
        };

        upsert_task(DagTask {
            id: task_id.clone(),
            title: objective.clone(),
            status: TaskStatus::Dispatched,
            provider_id: Some(p.id.clone()),
            ..Default::default()
        });

        // R3: check out a per-task git worktree before spawning. Fall back to
        // the repo root if the worktree can't be created (e.g. not a git repo).
        let workspace = match lifecycle::create(&task_id, &repo).await {
            Ok(path) => path.to_string_lossy().into_owned(),
            Err(_) => repo.to_string_lossy().into_owned(),
        };

        // Per-blade CLAUDE_CONFIG_DIR isolation (US-F1.4): each blade gets its
        // own claude state under `<repo>/.apohara/blades/<blade_id>/.claude` so
        // concurrent blades never share auth/session/locks. NOT a HOME override
        // (auth/billing danger zone) — see `build_spawn_env`. The blade id is
        // the task id (one blade per dispatched task this run).
        let blade_config = repo
            .join(".apohara")
            .join("blades")
            .join(&task_id)
            .join(".claude")
            .to_string_lossy()
            .into_owned();

        // US-F2.0b — inject the live mesh MCP config into the location THIS
        // blade's CLI actually reads (claude → its isolated CLAUDE_CONFIG_DIR;
        // codex/opencode → the worktree), so the mesh tools are present before
        // the spawn. Best-effort: a missing endpoint or a non-roster provider is
        // logged and skipped — the run continues with the augmented prompt only.
        if let Some((ports, token)) = &mesh_endpoint {
            inject_mesh_config(&p.id, &workspace, &blade_config, &apohara_bin, token, ports).await;
        }

        // US-F2.0b — augment the objective with the mesh protocol so the blade
        // is TOLD to claim before touching files, check its inbox, hand off, and
        // report its result. The blade id is the task id (one blade per task).
        let prompt = mesh_protocol_prompt(&objective, &task_id, &task_id);
        let req = build_request(&p.binary_path, &workspace, &prompt, &task_id, &blade_config);
        let pid = p.id.clone();
        let token_thread = task_id.clone();
        // Serialized per-binary spawn (runSerialized): two dispatches of the
        // same CLI never run concurrently (the 120s-SIGKILL contention guard);
        // different binaries still parallelize.
        let outcome = CliDriver::dispatch_streaming_serialized(req, move |line| {
            // US-F2.4: capture cumulative token usage off the stream into the
            // process-global counter (absolute-not-delta, §0.14). A non-usage
            // line yields None — a cheap inline check, so the totals surfaced
            // by the dashboard/Statusline stop reading zero.
            if let Some(snap) = apohara_token_accounting::parse_usage_snapshot(&line) {
                apohara_token_accounting::api::record_absolute(&pid, &token_thread, snap);
            }
            push_event(SseEvent {
                kind: format!("stream:{pid}"),
                payload: line,
                ts: now_ms(),
            });
        })
        .await;

        let (unified, files) = git_diff(Path::new(&workspace));
        let output = outcome.as_ref().map(|o| o.output.clone()).unwrap_or_default();
        let gate = run_all_gates(&GateInput {
            task_role: AgentRole::Coder,
            persona: None,
            diff: unified.clone(),
            output,
        });
        let gates_passed = gate.blocks.is_empty() && outcome.as_ref().map(|o| o.success).unwrap_or(false);

        upsert_task(DagTask {
            id: task_id.clone(),
            title: objective.clone(),
            status: if gates_passed {
                TaskStatus::Done
            } else {
                TaskStatus::Failed
            },
            provider_id: Some(p.id.clone()),
            ..Default::default()
        });

        candidates.push(Candidate {
            provider_id: p.id.clone(),
            unified,
            files,
            gates_passed,
        });

        // Release the claim now that the result is in hand. Best-effort: a
        // `StaleToken` means a reaper already re-claimed this slot (the blade
        // was deemed stalled), so our result is no longer authoritative — log
        // and move on rather than overwriting the live claimer's outcome.
        if let Some(token) = claim_token {
            match claims.report_result(&task_id, &token) {
                Ok(ReportOutcome::Accepted) => {}
                Ok(ReportOutcome::StaleToken) => {
                    tracing::warn!(task_id, "claim token stale at report; result not recorded");
                }
                Err(e) => tracing::warn!(task_id, "report_result failed (non-fatal): {e}"),
            }
        }

        // US-F1.6: incremental integration. For a node whose gates passed,
        // commit its worktree work to the node's branch and merge it into HEAD
        // through the SINGLE serialized integrator (`lifecycle::merge` holds the
        // one-HEAD-writer lock). Done BEFORE cleanup — cleanup may remove the
        // worktree, and we need its committed branch to merge.
        //
        // Double-apply guard: on `Success` the change is already in HEAD, so we
        // do NOT also feed this diff to the Accept `git apply` path — the mesh
        // diff (computed post-loop) is what the pane shows. On `Conflict` the
        // merge already aborted (HEAD is clean); `preserve_on_fail` keeps the
        // node's work as a recovery BRANCH REF (the worktree dir is still cleaned
        // below) and the node is marked Failed.
        if integrate_enabled && gates_passed {
            if commit_worktree(&workspace, &task_id) {
                match lifecycle::merge(&task_id, &repo).await {
                    Ok(MergeResult::Success) => {
                        any_integrated = true;
                    }
                    Ok(MergeResult::Conflict { files }) => {
                        tracing::warn!(task_id, ?files, "merge conflict; preserving branch, node failed");
                        let _ = lifecycle::preserve_on_fail(&task_id, FailureReason::MergeConflict, &repo).await;
                        upsert_task(DagTask {
                            id: task_id.clone(),
                            title: objective.clone(),
                            status: TaskStatus::Failed,
                            provider_id: Some(p.id.clone()),
                            ..Default::default()
                        });
                    }
                    Err(e) => {
                        tracing::warn!(task_id, "integrate merge failed (non-fatal): {e}");
                    }
                }
            } else {
                // Nothing to commit → nothing to integrate; skip the merge.
                tracing::info!(task_id, "no worktree changes to integrate; skipping merge");
            }
        }

        // Best-effort cleanup of the per-task worktree. With integration on, the
        // work is already in HEAD; with the flag off, the diff is captured as
        // text and applied to the main tree on Accept (W4.7).
        let _ = lifecycle::cleanup(&task_id, CleanupReason::Completed, &repo).await;
    }

    set_status(RunStatus::Verifying);
    // US-F1.6: if anything integrated, the diff to surface is the MESH —
    // `git diff <base> HEAD` over the repo root (the combined integrated
    // result), tagged `provider_winner = "mesh"`. If nothing integrated (no
    // node passed, base == HEAD, or the flag is off), fall back to the legacy
    // per-provider `winning_diff` so the Accept→`git apply` path still works.
    let diff = base
        .as_deref()
        .filter(|_| any_integrated)
        .and_then(|base| mesh_diff(&repo, base))
        .or_else(|| winning_diff(&candidates));

    // End-of-run episodic capture (best-effort: log on error, never block the
    // run). Single-writer per run (one coroutine, after the provider loop);
    // cross-session contention is handled by the busy_timeout set in
    // open_episode_db. `winning_diff` borrows `&candidates`, so reading them
    // here is order-independent of the diff selection above.
    let episode = build_episode(&objective, &candidates, diff.as_ref(), now_ms() as i64);
    if let Err(e) = apohara_episodic::capture_episode(&episode) {
        tracing::warn!("episodic capture failed (non-fatal): {e}");
    }

    if let Some(diff) = diff {
        code_diff::set(diff);
    }
    set_status(RunStatus::Idle);
}

// ===================================================================
// US-S1 — Collaborative-mesh dispatch body (bake-off -> mesh transition)
// ===================================================================
//
// Plan: docs/superpowers/plans/2026-06-02-apohara-bakeoff-to-mesh-transition.md
//
// The mesh body PLANs a per-run file-disjoint DAG, then DRIVES it to completion
// via the F2.1 `Coordinator::tick` (deps-gated ready set + unified reaper) and
// the F2.2 `assign` (no-same-binary-parallel + anti-idle distribution), reusing
// the bake-off's spawn/gate/integrate primitives verbatim. D4-B on-demand loop:
// a self-contained `while not-drained { tick -> assign -> spawn -> integrate }`,
// structurally parallel to the bake-off's `for p in providers`, with ONE spawn
// site (`spawn_blade`). Default OFF (`mesh_enabled`).

/// Opt-IN mesh gate (US-S1) — the OPPOSITE default of [`is_enabled`]
/// (`APOHARA_RUST_DISPATCH`, opt-out). The mesh path is experimental, so it is
/// off unless explicitly `=1`. `Some("true")`/`Some("yes")` are NOT enabled —
/// only the literal `"1"`, mirroring the operator convention in the plan.
///
/// `pub(crate)` so the `utilization_watcher` (US-S2) reuses the EXACT predicate
/// — the mesh ready_count + background reaping must gate on the same flag.
pub(crate) fn mesh_enabled(env_value: Option<&str>) -> bool {
    env_value == Some("1")
}

/// Hard iteration cap for the on-demand drive loop (US-S1, M1.2). Default 600
/// (~10 min at ~1s/tick, >=2x the coordinator's 5-min reaper TTL), tunable via
/// `APOHARA_MESH_MAX_TICKS`. Anything unparseable or 0 folds to the default —
/// the bound is the backstop, the reaper is the normal exit.
fn mesh_max_ticks(env_value: Option<&str>) -> u64 {
    const DEFAULT_MAX_TICKS: u64 = 600;
    env_value
        .and_then(|v| v.parse::<u64>().ok())
        .filter(|&n| n > 0)
        .unwrap_or(DEFAULT_MAX_TICKS)
}

/// A unique per-run id for DAG namespacing (US-S1, Change 2). Each run's
/// `TaskGraph` (and its `done` set) lives under `<repo>/.apohara/tasks/<run-id>`
/// so a 2nd run on the same repo starts from a fresh, fully-claimable DAG (no
/// `done`-poisoning — pre-mortem Escenario 4). `now_ms` + a process-global
/// sequence guarantees uniqueness even for two runs in the same millisecond.
fn run_id() -> String {
    format!("run-{}-{}", now_ms(), next_seq())
}

/// Binary basename used as the serialization key, matching
/// `apohara_dispatch::cli_driver::binary_key` (`/usr/bin/claude` -> `claude`)
/// so the distribution budget here lines up with the runtime per-binary lock.
fn binary_key_of(binary_path: &str) -> String {
    Path::new(binary_path)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(binary_path)
        .to_string()
}

/// Count in-flight (`Claimed`/`Running`) claims per binary_key for the `assign`
/// seed (US-S1, M2.1). Only nodes THIS run has dispatched are mapped (via
/// `node_binary`), so a claim from another run/blade is ignored. Pure — takes a
/// claim snapshot + the node->binary map, so it is unit-testable without a
/// store.
fn count_in_flight(
    records: &[ClaimRecord],
    node_binary: &HashMap<String, String>,
) -> HashMap<String, u32> {
    let mut out: HashMap<String, u32> = HashMap::new();
    for r in records {
        if !matches!(r.state, RunState::Claimed | RunState::Running) {
            continue;
        }
        if let Some(bin) = node_binary.get(&r.task_id) {
            *out.entry(bin.clone()).or_insert(0) += 1;
        }
    }
    out
}

/// Immutable per-run context shared by every [`spawn_blade`] call. Holds owned
/// clones (the stores are cheap path handles) so the drive loop can `.await`
/// each spawn inline without lifetime gymnastics.
struct MeshSpawnCtx {
    repo: PathBuf,
    /// Shared claim store at `<repo>/.apohara/claims` (NOT per-run — claims are
    /// keyed by node id and reaped by PID-liveness, so one root lets the
    /// claim_watcher / utilization_watcher see every run's claims).
    claims: ClaimStore,
    objective: String,
    apohara_bin: String,
    mesh_endpoint: Option<(EndpointPorts, String)>,
    /// US-S3 — optional mesh audit sink. The desktop owns `try_claim` and
    /// `lifecycle::merge` IN-PROCESS, so `ClaimAcquired` / `MergeCompleted` are
    /// emitted here. `None` degrades to no trail; emission is always best-effort
    /// (an audit failure NEVER aborts dispatch).
    audit: Option<AuditSink>,
}

/// US-S3 — emit a mesh audit record, best-effort. A `None` sink or a full queue
/// is swallowed: the audit trail is strictly additive and never on the dispatch
/// critical path. `target` is the node id; the payload carries only routing
/// metadata, NEVER tokens/keys/diff content (redaction discipline §0.4).
fn audit_mesh(sink: &Option<AuditSink>, kind: EventKind, actor: &str, target: &str) {
    if let Some(s) = sink {
        let _ = s.write(AuditEvent::mesh(kind, actor, target, serde_json::json!({})));
    }
}

/// Drive the collaborative mesh for `objective` (US-S1, D4-B on-demand loop).
async fn run_dispatch_mesh(objective: String) {
    set_status(RunStatus::Dispatching);
    emit_recall_event(&objective);

    let repo = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));

    // Per-run DAG namespace (Change 2): isolate this run's `done` set so a 2nd
    // run on the same repo is never poisoned by a prior run's completions.
    let rid = run_id();
    let graph = TaskGraph::new(repo.join(".apohara").join("tasks").join(&rid));
    // Claims stay at the SHARED root (keyed by node id, PID-reaped).
    let claims = ClaimStore::new(repo.join(".apohara").join("claims"));

    // PLAN: own-logic, zero-token decomposition into a file-disjoint DAG
    // (F3.1). `build_master_plan` persists nodes + deps and re-checks acyclicity
    // on each `add_node`. A planning failure ends the run cleanly (never a
    // half-driven loop).
    if let Err(e) = build_master_plan(&graph, &objective, &[]) {
        tracing::warn!("mesh planning failed (non-fatal): {e}; ending run");
        set_status(RunStatus::Idle);
        return;
    }

    // Roster: the available active providers become blades. `binary_key` keys
    // the no-same-binary-parallel budget (matches the runtime per-binary lock).
    let providers: Vec<_> = list_active_providers()
        .into_iter()
        .filter(|p| p.available)
        .collect();
    let roster: Vec<Blade> = providers
        .iter()
        .map(|p| Blade::new(p.id.clone(), binary_key_of(&p.binary_path)))
        .collect();
    let provider_bin: HashMap<String, String> = providers
        .iter()
        .map(|p| (p.id.clone(), p.binary_path.clone()))
        .collect();

    let env: HashMap<String, String> = std::env::vars().collect();
    let policy = DistributionPolicy::from_env(&env);
    let max_ticks = mesh_max_ticks(std::env::var("APOHARA_MESH_MAX_TICKS").ok().as_deref());

    // Resolve the live mesh endpoint ONCE (idempotent F0.1 OnceCell). Best-effort
    // (bus down -> blades still get the augmented prompt, only MCP wiring skips).
    let mesh_endpoint: Option<(EndpointPorts, String)> = match mcp_bootstrap_servers_inner().await {
        Ok(descriptor) => Some((descriptor_to_ports(&descriptor), descriptor.token)),
        Err(e) => {
            tracing::warn!("mesh endpoint unavailable (non-fatal): {e}; blades run without MCP mesh config");
            None
        }
    };
    let apohara_bin = std::env::current_exe()
        .map(|p| p.to_string_lossy().into_owned())
        .unwrap_or_else(|_| "apohara".to_string());

    // US-S3 — mesh audit sink for the in-process ClaimAcquired / MergeCompleted
    // records. Best-effort: a sink that can't open degrades to no trail.
    let audit = AuditSink::new(repo.join(".apohara").join("audit"), "mesh-desktop")
        .await
        .ok();

    let ctx = MeshSpawnCtx {
        repo: repo.clone(),
        claims: claims.clone(),
        objective: objective.clone(),
        apohara_bin,
        mesh_endpoint,
        audit,
    };

    // `base` is HEAD before any merge so the post-run mesh diff is the
    // integrated `git diff <base> HEAD` (US-F1.6, reused).
    let base = git_rev_parse_head(&repo);
    let mut any_integrated = false;

    let mut coordinator =
        Coordinator::new(DispatchSchedulerStore::from_parts(graph.clone(), claims.clone()));
    // node id -> binary_key for the in-flight seed (M2.1).
    let mut node_binary: HashMap<String, String> = HashMap::new();
    let mut ticks: u64 = 0;

    loop {
        if ticks >= max_ticks {
            tracing::warn!(max_ticks, "mesh drive loop hit MAX_TICKS; ending run (no infinite hang)");
            break;
        }
        ticks += 1;

        match coordinator.tick().await {
            TickOutcome::Dispatched { task_ids, .. } => {
                let ready: Vec<ReadyTask> = task_ids
                    .iter()
                    .map(|id| ReadyTask::new(id.clone(), Intent::Implement))
                    .collect();
                // Seed the per-binary in-flight load from the LIVE claim store
                // (M2.1) so a claim that landed last iteration is counted.
                let records = claims.list().unwrap_or_default();
                let in_flight = count_in_flight(&records, &node_binary);
                let assignments = assign(&ready, &roster, &policy, &in_flight);
                if assignments.is_empty() {
                    // No blade capacity for the ready work (e.g. no available
                    // providers). Don't spin to MAX_TICKS — end the run.
                    tracing::warn!(ready = ready.len(), "no blade capacity for ready mesh work; ending run");
                    break;
                }
                for a in assignments {
                    let Some(binary_path) = provider_bin.get(&a.provider_id).cloned() else {
                        tracing::warn!(provider = %a.provider_id, "assigned provider has no binary path; marking node done");
                        let _ = graph.mark_done(&a.task_id);
                        continue;
                    };
                    node_binary.insert(a.task_id.clone(), binary_key_of(&binary_path));
                    let integrated = spawn_blade(&ctx, &a.task_id, &a.provider_id, &binary_path).await;
                    if integrated {
                        any_integrated = true;
                    }
                    // v1: mark the node done once ATTEMPTED (pass OR fail) so the
                    // DAG drains and the node is never re-dispatched. No
                    // auto-retry (RetryReason exists but is unwired); a failed
                    // slice drains the DAG without contributing a diff. The mark
                    // is serialized HERE (single drive task), so concurrent
                    // graph.json writes are structurally impossible.
                    if let Err(e) = graph.mark_done(&a.task_id) {
                        tracing::warn!(task_id = %a.task_id, "mark_done failed (non-fatal): {e}");
                    }
                }
            }
            TickOutcome::StallDetected { task_ids } => {
                // The reaper just released a dead/stale claim. Loop so the freed
                // node is re-dispatched. Reap-on-exit (Change 1): we NEVER exit
                // while a dead-PID claim lingers — it surfaces HERE, not as NoOp.
                tracing::info!(?task_ids, "mesh: reaper released stale claim(s); re-ticking");
            }
            TickOutcome::NoOp => {
                // No ready work AND nothing stale to reap -> the DAG has drained.
                // A dead-PID claim would surface as StallDetected above (never
                // NoOp), so exiting here cannot strand a reapable claim.
                break;
            }
            TickOutcome::BlockedByCareful { .. } => {
                // Careful mode is unused on the mesh v1 path; treat as a stop.
                tracing::info!("mesh: careful mode blocked dispatch; ending run");
                break;
            }
        }
    }

    set_status(RunStatus::Verifying);
    // The mesh diff is the integrated `git diff <base> HEAD`, tagged "mesh".
    let diff = base
        .as_deref()
        .filter(|_| any_integrated)
        .and_then(|base| mesh_diff(&repo, base));

    // End-of-run episodic capture (best-effort). The mesh has no per-provider
    // `Candidate` list, so pass an empty slice — `build_episode` derives the
    // outcome from the selected diff (winner-selected / no-change).
    let episode = build_episode(&objective, &[], diff.as_ref(), now_ms() as i64);
    if let Err(e) = apohara_episodic::capture_episode(&episode) {
        tracing::warn!("episodic capture failed (non-fatal): {e}");
    }

    if let Some(diff) = diff {
        code_diff::set(diff);
    }
    set_status(RunStatus::Idle);
}

/// Run ONE mesh blade for `node_id` on `provider_id`/`binary_path` (US-S1). The
/// single spawn site: claim the DAG node id (D5 single identity) -> upsert the
/// `DagTask` -> worktree -> inject mesh MCP config -> augment the prompt ->
/// serialized dispatch -> gates -> report_result -> commit -> serialized merge.
/// Reuses the bake-off primitives verbatim; HEAD safety + conflict handling are
/// the existing `INTEGRATOR_LOCK` path. Returns whether the slice integrated.
async fn spawn_blade(
    ctx: &MeshSpawnCtx,
    node_id: &str,
    provider_id: &str,
    binary_path: &str,
) -> bool {
    // Claim the DAG node id (D5: node id == claim key == pane_key == mailbox
    // recipient). On contention skip cleanly; a claim-store error is non-fatal.
    let claim_token = match ctx.claims.try_claim(node_id) {
        Ok(ClaimOutcome::Acquired { token }) => {
            // US-S3 — audit the claim acquisition (best-effort; node id as
            // target, no token in the payload).
            audit_mesh(&ctx.audit, EventKind::ClaimAcquired, provider_id, node_id);
            Some(token)
        }
        Ok(ClaimOutcome::AlreadyClaimed) => {
            tracing::info!(node_id, "node already claimed by another blade; skipping spawn");
            return false;
        }
        Err(e) => {
            tracing::warn!(node_id, "claim failed (non-fatal): {e}");
            None
        }
    };

    upsert_task(DagTask {
        id: node_id.to_string(),
        title: ctx.objective.clone(),
        status: TaskStatus::Dispatched,
        provider_id: Some(provider_id.to_string()),
        ..Default::default()
    });

    // R3: per-node git worktree before spawning; fall back to the repo root.
    let workspace = match lifecycle::create(node_id, &ctx.repo).await {
        Ok(path) => path.to_string_lossy().into_owned(),
        Err(_) => ctx.repo.to_string_lossy().into_owned(),
    };

    // Per-blade CLAUDE_CONFIG_DIR isolation (US-F1.4) keyed by the node id.
    let blade_config = ctx
        .repo
        .join(".apohara")
        .join("blades")
        .join(node_id)
        .join(".claude")
        .to_string_lossy()
        .into_owned();

    if let Some((ports, token)) = &ctx.mesh_endpoint {
        inject_mesh_config(provider_id, &workspace, &blade_config, &ctx.apohara_bin, token, ports).await;
    }

    let prompt = mesh_protocol_prompt(&ctx.objective, node_id, node_id);
    let mut req = build_request(binary_path, &workspace, &prompt, node_id, &blade_config);
    // US-S4 — export the node's mesh phase so the CLI claim-guard denies
    // PLAN-phase mutations (read-only). EXEC/REVIEW fall through to claim-only.
    req.phase = Some(node_phase(node_id).to_string());
    let pid = provider_id.to_string();
    let token_thread = node_id.to_string();
    let outcome = CliDriver::dispatch_streaming_serialized(req, move |line| {
        if let Some(snap) = apohara_token_accounting::parse_usage_snapshot(&line) {
            apohara_token_accounting::api::record_absolute(&pid, &token_thread, snap);
        }
        push_event(SseEvent {
            kind: format!("stream:{pid}"),
            payload: line,
            ts: now_ms(),
        });
    })
    .await;

    let (unified, _files) = git_diff(Path::new(&workspace));
    let output = outcome.as_ref().map(|o| o.output.clone()).unwrap_or_default();
    let gate = run_all_gates(&GateInput {
        task_role: AgentRole::Coder,
        persona: None,
        diff: unified.clone(),
        output,
    });
    let gates_passed = gate.blocks.is_empty() && outcome.as_ref().map(|o| o.success).unwrap_or(false);

    upsert_task(DagTask {
        id: node_id.to_string(),
        title: ctx.objective.clone(),
        status: if gates_passed {
            TaskStatus::InVerification
        } else {
            TaskStatus::Failed
        },
        provider_id: Some(provider_id.to_string()),
        ..Default::default()
    });

    // Release the claim now the result is in hand (StaleToken => a reaper
    // re-claimed the slot; our result is no longer authoritative).
    if let Some(token) = claim_token {
        match ctx.claims.report_result(node_id, &token) {
            Ok(ReportOutcome::Accepted) => {}
            Ok(ReportOutcome::StaleToken) => {
                tracing::warn!(node_id, "claim token stale at report; result not recorded");
            }
            Err(e) => tracing::warn!(node_id, "report_result failed (non-fatal): {e}"),
        }
    }

    // Incremental integration through the SINGLE serialized integrator
    // (`INTEGRATOR_LOCK`). Mirrors the bake-off block verbatim; no new merge path.
    let mut integrated = false;
    if gates_passed {
        if commit_worktree(&workspace, node_id) {
            match lifecycle::merge(node_id, &ctx.repo).await {
                Ok(MergeResult::Success) => {
                    integrated = true;
                    // US-S3 — audit the integration (best-effort; node id as
                    // target, no diff content in the payload).
                    audit_mesh(&ctx.audit, EventKind::MergeCompleted, provider_id, node_id);
                    upsert_task(DagTask {
                        id: node_id.to_string(),
                        title: ctx.objective.clone(),
                        status: TaskStatus::Done,
                        provider_id: Some(provider_id.to_string()),
                        ..Default::default()
                    });
                }
                Ok(MergeResult::Conflict { files }) => {
                    tracing::warn!(node_id, ?files, "merge conflict; preserving branch, node failed");
                    let _ = lifecycle::preserve_on_fail(node_id, FailureReason::MergeConflict, &ctx.repo).await;
                    upsert_task(DagTask {
                        id: node_id.to_string(),
                        title: ctx.objective.clone(),
                        status: TaskStatus::Failed,
                        provider_id: Some(provider_id.to_string()),
                        ..Default::default()
                    });
                }
                Err(e) => {
                    tracing::warn!(node_id, "integrate merge failed (non-fatal): {e}");
                }
            }
        } else {
            tracing::info!(node_id, "no worktree changes to integrate; skipping merge");
        }
    }

    let _ = lifecycle::cleanup(node_id, CleanupReason::Completed, &ctx.repo).await;
    integrated
}

/// Recall past episodes for `objective` and push a `memory:recall` SSE event so
/// the UI/context sees prior outcomes. Best-effort: recall errors are logged,
/// an empty store emits nothing. This is **feature-similarity recall** (no
/// model) — plain text injection of past goals/outcomes.
fn emit_recall_event(objective: &str) {
    const RECALL_TOP_K: usize = 3;
    match apohara_episodic::recall_for_goal(objective, RECALL_TOP_K) {
        Ok(episodes) if !episodes.is_empty() => {
            push_event(SseEvent {
                kind: "memory:recall".to_string(),
                payload: format_recall_payload(&episodes),
                ts: now_ms(),
            });
        }
        Ok(_) => {} // fresh store / no similar episodes — nothing to surface
        Err(e) => tracing::warn!("episodic recall failed (non-fatal): {e}"),
    }
}

/// Render recalled episodes as a plain-text block (no model). Pure fn so it is
/// unit-testable. Each line is `feature-similarity recall: <goal> -> <outcome>`.
fn format_recall_payload(episodes: &[Episode]) -> String {
    episodes
        .iter()
        .map(|e| format!("feature-similarity recall: {} -> {}", e.goal, e.outcome))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Build an [`Episode`] from a finished run's candidates + the selected diff.
/// Pure function (no I/O) so it is unit-testable. Maps each candidate's
/// `gates_passed` bool → a verdict string and collects the provider ids; takes
/// the winning-diff summary from the selected [`Diff`] (provider winner + file
/// count), since `Candidate` carries no per-gate verdict blocks.
fn build_episode(
    objective: &str,
    candidates: &[Candidate],
    diff: Option<&Diff>,
    timestamp: i64,
) -> Episode {
    let providers: Vec<String> = candidates.iter().map(|c| c.provider_id.clone()).collect();
    let gate_verdicts: Vec<String> = candidates
        .iter()
        .map(|c| {
            if c.gates_passed {
                "passed".to_string()
            } else {
                "failed".to_string()
            }
        })
        .collect();
    let (winning_diff_summary, outcome) = match diff {
        Some(d) => (
            format!("{} changed {} file(s)", d.provider_winner, d.files_changed.len()),
            "winner-selected".to_string(),
        ),
        None => (String::new(), "no-change".to_string()),
    };
    Episode {
        id: format!("run-{timestamp}"),
        goal: objective.to_string(),
        timestamp,
        providers,
        winning_diff_summary,
        gate_verdicts,
        outcome,
    }
}

/// Build the `DispatchRequest` for a provider run. `provider_binary` is the
/// resolved CLI path (`ActiveProvider::binary_path`), spawned with `--print`.
/// `prompt` is the mesh-protocol-augmented objective (US-F2.0b) when dispatch is
/// live, the bare objective on the legacy path. `task_id` doubles as the pane
/// key (one pane per dispatched task) and the task identifier exported to the
/// spawned CLI's agent-hooks env, so live hook events correlate back to this run
/// (Stage 2.6). `blade_config` is the per-blade isolated `CLAUDE_CONFIG_DIR`
/// (US-F1.4) so concurrent blades never share claude auth/session/lock state.
fn build_request(
    provider_binary: &str,
    workspace: &str,
    prompt: &str,
    task_id: &str,
    blade_config: &str,
) -> DispatchRequest {
    DispatchRequest {
        provider_id: provider_binary.to_string(),
        workspace: workspace.to_string(),
        prompt: prompt.to_string(),
        role: "coder".to_string(),
        runner_policy: "default".to_string(),
        pane_key: task_id.to_string(),
        task_id: Some(task_id.to_string()),
        // The per-task worktree lives at `workspace`; use its path as the
        // worktree id so hook events can be traced to the right checkout.
        worktree_id: Some(workspace.to_string()),
        // Per-blade claude state isolation; injected onto the spawn env as
        // CLAUDE_CONFIG_DIR (NOT HOME — auth/billing zone) by `build_spawn_env`.
        config_isolation: Some(blade_config.to_string()),
        // The bake-off carries no mesh phase; the mesh body sets it on the
        // request after this builder (US-S4) so the CLI claim-guard can deny
        // PLAN-phase writes.
        phase: None,
    }
}

/// US-S4 — map a master-plan node id to its mesh phase string (`plan`/`exec`/
/// `review`), exported as `APOHARA_PHASE` for the CLI claim-guard. The planner
/// knows each node's phase by id: `plan` is read-only PLAN, `impl-*`/`implement`
/// are the write phase EXEC, and `integrate`/`verify`/`review*` are the
/// human-gated REVIEW. An unrecognized id defaults to `exec` (the permissive
/// write phase) so the guard never spuriously denies an unknown node.
fn node_phase(node_id: &str) -> &'static str {
    if node_id == "plan" {
        "plan"
    } else if node_id == "integrate" || node_id == "verify" || node_id.starts_with("review") {
        "review"
    } else {
        // `impl-*`, `implement`, and any unknown id -> the write phase.
        "exec"
    }
}

/// US-F2.0b — wrap `objective` with explicit BYOC mesh-protocol instructions so
/// an opaque blade is TOLD to coordinate (pre-mortem Escenario 1). Pure fn (no
/// I/O) so it is unit-testable. The blade learns it is one of several
/// heterogeneous collaborators working a SLICE (not the whole objective), and
/// the literal mesh tool names it must call: `claim_task` BEFORE touching any
/// file, `check_inbox` to coordinate, `send_message` to hand off, and
/// `report_result` (with its claim token) when done.
fn mesh_protocol_prompt(objective: &str, blade_id: &str, task_id: &str) -> String {
    format!(
        "You are blade \"{blade_id}\", one of several heterogeneous AI agents \
collaborating on a shared objective through the Apohara mesh. You are NOT working \
alone, and your task is a SLICE of the objective — not the whole thing.\n\
\n\
MESH PROTOCOL (mandatory — use the `apohara.mesh` MCP tools):\n\
1. BEFORE touching any file, call `claim_task` with taskId \"{task_id}\" and \
blade \"{blade_id}\". If it returns acquired=false, another blade already owns \
this slice — call `get_tasks`, pick an unclaimed one, and claim that instead.\n\
2. Keep the claim token from `claim_task`; you need it to report your result.\n\
3. Every few steps, call `check_inbox` with blade \"{blade_id}\" to coordinate \
with the other blades and avoid duplicating their work.\n\
4. Use `send_message` to hand off context or signal a dependency to another \
blade; use `release_task` if you cannot complete your slice.\n\
5. When your slice is done, call `report_result` with taskId \"{task_id}\", your \
claim token, and success=true (or false on failure).\n\
\n\
OBJECTIVE:\n{objective}"
    )
}

/// US-F2.0b — flatten an [`EndpointDescriptor`]'s present server ports into the
/// stable-ordered [`EndpointPorts`] that `build_canonical_from_endpoint`
/// consumes. Pure fn (no I/O) so it is unit-testable. Pushes each present
/// `(name, port)` in the fixed ledger/runs/indexer/settings/mesh order — only
/// the keys that exist in the descriptor (e.g. `mesh` after F2.0a).
fn descriptor_to_ports(descriptor: &EndpointDescriptor) -> EndpointPorts {
    let mut ports = EndpointPorts::new();
    let s: &EndpointServers = &descriptor.servers;
    if let Some(p) = &s.ledger {
        ports.push("ledger", p.port);
    }
    if let Some(p) = &s.runs {
        ports.push("runs", p.port);
    }
    if let Some(p) = &s.indexer {
        ports.push("indexer", p.port);
    }
    if let Some(p) = &s.settings {
        ports.push("settings", p.port);
    }
    if let Some(p) = &s.mesh {
        ports.push("mesh", p.port);
    }
    ports
}

/// US-F2.0b — compute the directory `inject_mcp_config` must target for a
/// provider so the config lands where the blade's CLI ACTUALLY reads it. Pure fn
/// (no I/O) so it is unit-testable — the testable seam for the per-provider path
/// math. `blade_config` is the F1.4 `CLAUDE_CONFIG_DIR`
/// (`<repo>/.apohara/blades/<task>/.claude`).
///
///   - claude-code-cli reads `$CLAUDE_CONFIG_DIR/mcp.json`, and `inject_claude`
///     writes `<target>/.claude/mcp.json`. So the target is the PARENT of
///     `blade_config` (`<repo>/.apohara/blades/<task>`) → the config lands at
///     exactly `$CLAUDE_CONFIG_DIR/mcp.json`. If `blade_config` somehow has no
///     parent, fall back to it directly (never the host's real `~/.claude`).
///   - codex-cli / opencode-go have no CLAUDE_CONFIG_DIR isolation; they read
///     workspace-local config, so the target is the worktree `workspace`.
fn inject_target(provider: ProviderId, workspace: &str, blade_config: &str) -> PathBuf {
    match provider {
        ProviderId::ClaudeCodeCli => Path::new(blade_config)
            .parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from(blade_config)),
        ProviderId::CodexCli | ProviderId::OpencodeGo => PathBuf::from(workspace),
    }
}

/// US-F2.0b — best-effort injection of the live mesh MCP config for one blade.
/// Maps the roster id → [`ProviderId`]; a non-roster id is logged and skipped
/// (no injection). Builds the canonical config from the live endpoint `ports` +
/// the bearer `token` (both captured once per run), then writes it to the
/// provider-correct target ([`inject_target`]). Any failure (unknown provider,
/// write error) is logged and swallowed so the run never aborts over mesh
/// wiring; the blade still gets the augmented prompt.
///
/// Auth/isolation discipline (US-F1.4): the target is ALWAYS the blade's
/// isolated config dir or the worktree — never the host's real `~/.claude` /
/// `~/.codex`. No secrets are passed beyond the loopback bus's own bearer token.
async fn inject_mesh_config(
    provider_id: &str,
    workspace: &str,
    blade_config: &str,
    apohara_bin: &str,
    token: &str,
    ports: &EndpointPorts,
) {
    let Some(provider) = ProviderId::try_from_str(provider_id) else {
        tracing::info!(provider_id, "not a mesh-capable provider; skipping MCP injection");
        return;
    };
    let canonical = build_canonical_from_endpoint(apohara_bin, token, ports);
    let target = inject_target(provider, workspace, blade_config);
    match inject_mcp_config(provider, &canonical, &target).await {
        Ok(res) => {
            tracing::info!(provider_id, path = %res.config_path.display(), "mesh MCP config injected");
        }
        Err(e) => {
            tracing::warn!(provider_id, "mesh MCP config injection failed (non-fatal): {e}");
        }
    }
}

/// Capture the working-tree diff at `workspace` as `(unified, files_changed)`.
/// Returns empty strings/lists when there's nothing to diff or git is absent.
fn git_diff(workspace: &Path) -> (String, Vec<String>) {
    let unified = Command::new("git")
        .arg("-C")
        .arg(workspace)
        .arg("diff")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    let files = Command::new("git")
        .arg("-C")
        .arg(workspace)
        .arg("diff")
        .arg("--name-only")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|l| l.to_string())
                .collect()
        })
        .unwrap_or_default();
    (unified, files)
}

/// `git -C <repo> rev-parse HEAD` → the current commit, or `None` when git is
/// absent / the repo has no commits. Captured before integration so the mesh
/// diff can be taken against it (US-F1.6).
fn git_rev_parse_head(repo: &Path) -> Option<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["rev-parse", "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())?;
    let head = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if head.is_empty() {
        None
    } else {
        Some(head)
    }
}

/// Commit the worktree's work to its branch so the serialized integrator has a
/// commit to merge (US-F1.6). Stages everything (`git add -A`) then commits with
/// an `apohara: <task_id>` message. Returns `false` when there is nothing to
/// commit (clean tree) — the caller then skips the merge (no work to integrate).
fn commit_worktree(workspace: &str, task_id: &str) -> bool {
    let ws = Path::new(workspace);
    let add = Command::new("git").arg("-C").arg(ws).args(["add", "-A"]).output();
    if !matches!(&add, Ok(o) if o.status.success()) {
        tracing::warn!(task_id, "git add -A failed in worktree; integration may be incomplete");
    }
    let out = Command::new("git")
        .arg("-C")
        .arg(ws)
        .args(["commit", "-m", &format!("apohara: {task_id}")])
        .output();
    // `git commit` exits non-zero on "nothing to commit" — treat that (and any
    // git error) as "no work to integrate" rather than a hard failure.
    matches!(out, Ok(o) if o.status.success())
}

/// The MESH diff: `git -C <repo> diff <base> HEAD` (unified) plus its
/// `--name-only` file list, tagged `provider_winner = "mesh"` (US-F1.6). `None`
/// when the diff is empty (e.g. `base == HEAD`) so the caller can fall back to
/// the per-provider `winning_diff`.
fn mesh_diff(repo: &Path, base: &str) -> Option<Diff> {
    let unified = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["diff", base, "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default();
    if unified.is_empty() {
        return None;
    }
    let files_changed = Command::new("git")
        .arg("-C")
        .arg(repo)
        .args(["diff", "--name-only", base, "HEAD"])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .map(|l| l.to_string())
                .collect()
        })
        .unwrap_or_default();
    Some(Diff {
        unified,
        files_changed,
        provider_winner: "mesh".to_string(),
    })
}

/// Select the diff to surface: prefer a provider whose gates passed with a
/// non-empty diff; else the first non-empty diff. `None` if nothing changed.
fn winning_diff(candidates: &[Candidate]) -> Option<Diff> {
    let best = candidates
        .iter()
        .find(|c| c.gates_passed && !c.unified.is_empty())
        .or_else(|| candidates.iter().find(|c| !c.unified.is_empty()))?;
    Some(Diff {
        unified: best.unified.clone(),
        files_changed: best.files.clone(),
        provider_winner: best.provider_id.clone(),
    })
}

fn next_seq() -> u64 {
    static SEQ: AtomicU64 = AtomicU64::new(0);
    SEQ.fetch_add(1, Ordering::Relaxed)
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_request_uses_binary_and_print_fields() {
        // `build_request` now passes its `prompt` arg through verbatim (the
        // caller does the US-F2.0b augmentation); this test feeds an
        // already-augmented string and asserts it survives unchanged.
        let augmented = mesh_protocol_prompt("build a thing", "claude-1", "claude-1");
        let req = build_request(
            "/usr/bin/claude",
            "/tmp/wt",
            &augmented,
            "claude-1",
            "/repo/.apohara/blades/claude-1/.claude",
        );
        assert_eq!(req.provider_id, "/usr/bin/claude");
        assert_eq!(req.workspace, "/tmp/wt");
        assert_eq!(req.prompt, augmented);
        assert!(req.prompt.contains("build a thing"));
        assert_eq!(req.role, "coder");
        assert_eq!(req.runner_policy, "default");
        // Hook correlation: task_id doubles as pane key, worktree id = workspace.
        assert_eq!(req.pane_key, "claude-1");
        assert_eq!(req.task_id.as_deref(), Some("claude-1"));
        assert_eq!(req.worktree_id.as_deref(), Some("/tmp/wt"));
        // US-F1.4: per-blade CLAUDE_CONFIG_DIR isolation is carried on the
        // request (injected post-sanitization, never as a HOME override).
        assert_eq!(
            req.config_isolation.as_deref(),
            Some("/repo/.apohara/blades/claude-1/.claude")
        );
    }

    #[test]
    fn winning_diff_prefers_passing_provider() {
        let candidates = vec![
            Candidate {
                provider_id: "a".into(),
                unified: "diff-a".into(),
                files: vec!["a.rs".into()],
                gates_passed: false,
            },
            Candidate {
                provider_id: "b".into(),
                unified: "diff-b".into(),
                files: vec!["b.rs".into()],
                gates_passed: true,
            },
        ];
        let diff = winning_diff(&candidates).expect("a winner");
        assert_eq!(diff.provider_winner, "b");
        assert_eq!(diff.unified, "diff-b");
    }

    #[test]
    fn winning_diff_falls_back_to_first_nonempty() {
        let candidates = vec![
            Candidate {
                provider_id: "a".into(),
                unified: String::new(),
                files: vec![],
                gates_passed: false,
            },
            Candidate {
                provider_id: "b".into(),
                unified: "diff-b".into(),
                files: vec![],
                gates_passed: false,
            },
        ];
        let diff = winning_diff(&candidates).expect("a winner");
        assert_eq!(diff.provider_winner, "b");
    }

    #[test]
    fn winning_diff_none_when_no_changes() {
        let candidates = vec![Candidate {
            provider_id: "a".into(),
            unified: String::new(),
            files: vec![],
            gates_passed: true,
        }];
        assert!(winning_diff(&candidates).is_none());
    }

    #[test]
    fn build_episode_maps_candidates_and_winning_diff() {
        let candidates = vec![
            Candidate {
                provider_id: "claude-code-cli".into(),
                unified: "diff-a".into(),
                files: vec!["a.rs".into()],
                gates_passed: false,
            },
            Candidate {
                provider_id: "codex-cli".into(),
                unified: "diff-b".into(),
                files: vec!["b.rs".into(), "c.rs".into()],
                gates_passed: true,
            },
        ];
        let diff = winning_diff(&candidates);
        let ep = build_episode("add a feature", &candidates, diff.as_ref(), 7);
        assert_eq!(ep.goal, "add a feature");
        assert_eq!(ep.timestamp, 7);
        assert_eq!(ep.providers, vec!["claude-code-cli", "codex-cli"]);
        // gates_passed bool → verdict string, positionally per candidate.
        assert_eq!(ep.gate_verdicts, vec!["failed", "passed"]);
        // winning_diff_summary comes from the selected Diff (codex-cli, 2 files).
        assert_eq!(ep.winning_diff_summary, "codex-cli changed 2 file(s)");
        assert_eq!(ep.outcome, "winner-selected");
    }

    #[test]
    fn format_recall_payload_uses_feature_similarity_language() {
        let episodes = vec![
            Episode {
                id: "a".into(),
                goal: "fix login bug".into(),
                timestamp: 1,
                providers: vec![],
                winning_diff_summary: String::new(),
                gate_verdicts: vec![],
                outcome: "winner-selected".into(),
            },
            Episode {
                id: "b".into(),
                goal: "add cache layer".into(),
                timestamp: 2,
                providers: vec![],
                winning_diff_summary: String::new(),
                gate_verdicts: vec![],
                outcome: "no-change".into(),
            },
        ];
        let payload = format_recall_payload(&episodes);
        // Language MUST be "feature-similarity recall", never "semantic".
        assert!(payload.contains("feature-similarity recall"));
        assert!(!payload.to_lowercase().contains("semantic"));
        assert_eq!(
            payload,
            "feature-similarity recall: fix login bug -> winner-selected\n\
             feature-similarity recall: add cache layer -> no-change"
        );
    }

    #[test]
    fn build_episode_no_change_when_no_winner() {
        let candidates = vec![Candidate {
            provider_id: "claude-code-cli".into(),
            unified: String::new(),
            files: vec![],
            gates_passed: false,
        }];
        let diff = winning_diff(&candidates);
        assert!(diff.is_none());
        let ep = build_episode("no-op goal", &candidates, diff.as_ref(), 9);
        assert_eq!(ep.outcome, "no-change");
        assert_eq!(ep.winning_diff_summary, "");
        assert_eq!(ep.gate_verdicts, vec!["failed"]);
    }

    #[test]
    fn git_diff_captures_working_tree_change() {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = dir.path();
        let run = |args: &[&str]| {
            Command::new("git")
                .arg("-C")
                .arg(repo)
                .args(args)
                .output()
                .expect("git");
        };
        run(&["init", "-q"]);
        run(&["config", "user.email", "t@t"]);
        run(&["config", "user.name", "t"]);
        std::fs::write(repo.join("f.txt"), "one\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-q", "-m", "init"]);
        std::fs::write(repo.join("f.txt"), "two\n").unwrap();

        let (unified, files) = git_diff(repo);
        assert!(unified.contains("-one"), "unified should show the change: {unified}");
        assert!(unified.contains("+two"));
        assert_eq!(files, vec!["f.txt".to_string()]);
    }

    /// Helper: init a repo with one base commit and return its dir handle.
    fn init_repo_with_commit() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("tempdir");
        let repo = dir.path();
        let run = |args: &[&str]| {
            Command::new("git").arg("-C").arg(repo).args(args).output().expect("git");
        };
        run(&["init", "-q"]);
        run(&["config", "user.email", "t@t"]);
        run(&["config", "user.name", "t"]);
        std::fs::write(repo.join("base.txt"), "base\n").unwrap();
        run(&["add", "."]);
        run(&["commit", "-q", "-m", "init"]);
        dir
    }

    #[test]
    fn git_rev_parse_head_returns_commit() {
        let dir = init_repo_with_commit();
        let head = git_rev_parse_head(dir.path()).expect("HEAD after a commit");
        assert_eq!(head.len(), 40, "full sha expected: {head}");
        assert!(head.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn git_rev_parse_head_none_when_not_a_repo() {
        let dir = tempfile::tempdir().expect("tempdir");
        assert!(git_rev_parse_head(dir.path()).is_none());
    }

    #[test]
    fn commit_worktree_commits_changes_and_reports_false_when_clean() {
        let dir = init_repo_with_commit();
        let ws = dir.path().to_string_lossy().into_owned();
        // Dirty tree → commits and returns true.
        std::fs::write(dir.path().join("new.txt"), "work\n").unwrap();
        assert!(commit_worktree(&ws, "task-x"), "should commit the new file");
        // The commit message follows the `apohara: <task_id>` convention.
        let msg = Command::new("git")
            .arg("-C")
            .arg(dir.path())
            .args(["log", "-1", "--pretty=%s"])
            .output()
            .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
            .unwrap();
        assert_eq!(msg, "apohara: task-x");
        // Clean tree → nothing to commit → false (caller then skips the merge).
        assert!(!commit_worktree(&ws, "task-x"), "clean tree should report false");
    }

    #[test]
    fn mesh_diff_spans_base_to_head_and_tags_mesh() {
        let dir = init_repo_with_commit();
        let repo = dir.path();
        let base = git_rev_parse_head(repo).expect("base");
        // Two commits on top of base (simulating two integrated nodes).
        let run = |args: &[&str]| {
            Command::new("git").arg("-C").arg(repo).args(args).output().expect("git");
        };
        std::fs::write(repo.join("a.txt"), "from-a\n").unwrap();
        run(&["add", "-A"]);
        run(&["commit", "-q", "-m", "apohara: a"]);
        std::fs::write(repo.join("b.txt"), "from-b\n").unwrap();
        run(&["add", "-A"]);
        run(&["commit", "-q", "-m", "apohara: b"]);

        let diff = mesh_diff(repo, &base).expect("mesh diff base..HEAD");
        assert_eq!(diff.provider_winner, "mesh");
        assert!(diff.unified.contains("from-a"), "mesh should include a.txt: {}", diff.unified);
        assert!(diff.unified.contains("from-b"), "mesh should include b.txt: {}", diff.unified);
        let mut files = diff.files_changed.clone();
        files.sort();
        assert_eq!(files, vec!["a.txt".to_string(), "b.txt".to_string()]);
    }

    #[test]
    fn mesh_diff_none_when_base_equals_head() {
        let dir = init_repo_with_commit();
        let repo = dir.path();
        let head = git_rev_parse_head(repo).expect("head");
        // base == HEAD → empty diff → None (caller falls back to winning_diff).
        assert!(mesh_diff(repo, &head).is_none());
    }

    // ---- US-F2.0b: mesh prompt augmentation + injection target math ----

    #[test]
    fn mesh_protocol_prompt_embeds_objective_tools_and_ids() {
        let prompt = mesh_protocol_prompt("ship the feature", "codex-cli-3", "codex-cli-3");
        // The original objective is preserved verbatim.
        assert!(prompt.contains("ship the feature"), "objective must survive: {prompt}");
        // The literal mesh tool names the blade must call are present.
        assert!(prompt.contains("claim_task"), "must name claim_task");
        assert!(prompt.contains("check_inbox"), "must name check_inbox");
        assert!(prompt.contains("report_result"), "must name report_result");
        // The blade/task ids are threaded in so the blade claims the right slice.
        assert!(prompt.contains("codex-cli-3"), "must carry the blade/task id");
        // The "claim before touching files" instruction is explicit.
        assert!(
            prompt.to_lowercase().contains("before touching any file"),
            "must instruct claim-before-edit: {prompt}"
        );
        // The blade is told it works a SLICE, not the whole objective.
        assert!(prompt.contains("SLICE"), "must frame the work as a slice");
    }

    #[test]
    fn descriptor_to_ports_includes_mesh_and_present_keys() {
        use apohara_mcp::bootstrap::{EndpointPort, EndpointServers};
        let descriptor = EndpointDescriptor {
            token: "tok".into(),
            servers: EndpointServers {
                ledger: Some(EndpointPort { port: 4001 }),
                runs: None,
                indexer: None,
                settings: None,
                mesh: Some(EndpointPort { port: 4099 }),
            },
            started_at: 0,
        };
        let ports = descriptor_to_ports(&descriptor);
        let names: Vec<&str> = ports.iter().map(|(n, _)| n.as_str()).collect();
        // Only the present keys appear, in the fixed order; `mesh` is included.
        assert_eq!(names, vec!["ledger", "mesh"]);
        let mesh_port = ports.iter().find(|(n, _)| n == "mesh").map(|(_, p)| *p);
        assert_eq!(mesh_port, Some(4099), "mesh port must round-trip");
    }

    #[test]
    fn inject_target_claude_is_blade_config_parent() {
        // claude reads $CLAUDE_CONFIG_DIR/mcp.json and inject_claude writes
        // <target>/.claude/mcp.json, so the target must be the PARENT of the
        // CLAUDE_CONFIG_DIR — landing the config at exactly $CLAUDE_CONFIG_DIR.
        let blade_config = "/repo/.apohara/blades/claude-1/.claude";
        let target = inject_target(ProviderId::ClaudeCodeCli, "/tmp/wt", blade_config);
        assert_eq!(target, PathBuf::from("/repo/.apohara/blades/claude-1"));
        // The resulting write path is exactly $CLAUDE_CONFIG_DIR/mcp.json.
        assert_eq!(
            target.join(".claude").join("mcp.json"),
            PathBuf::from(blade_config).join("mcp.json")
        );
    }

    #[test]
    fn inject_target_codex_and_opencode_are_the_workspace() {
        // No CLAUDE_CONFIG_DIR isolation: codex/opencode read workspace-local
        // config, so the target is the worktree — NEVER the host ~/.codex.
        let blade_config = "/repo/.apohara/blades/x/.claude";
        let codex = inject_target(ProviderId::CodexCli, "/tmp/wt", blade_config);
        assert_eq!(codex, PathBuf::from("/tmp/wt"));
        let opencode = inject_target(ProviderId::OpencodeGo, "/tmp/wt", blade_config);
        assert_eq!(opencode, PathBuf::from("/tmp/wt"));
    }

    // ---- US-S1: collaborative-mesh dispatch body ----

    #[test]
    fn mesh_enabled_is_opt_in() {
        // OPT-IN: only the literal "1" enables the mesh (opposite default of
        // `is_enabled`, which is opt-OUT). Anything else stays on the bake-off.
        assert!(mesh_enabled(Some("1")));
        assert!(!mesh_enabled(None));
        assert!(!mesh_enabled(Some("0")));
        assert!(!mesh_enabled(Some("true")));
        assert!(!mesh_enabled(Some("")));
    }

    #[test]
    fn mesh_max_ticks_defaults_and_parses() {
        assert_eq!(mesh_max_ticks(None), 600, "default backstop");
        assert_eq!(mesh_max_ticks(Some("5")), 5, "explicit override");
        assert_eq!(mesh_max_ticks(Some("0")), 600, "0 folds to default (never a 0-tick loop)");
        assert_eq!(mesh_max_ticks(Some("garbage")), 600, "unparseable folds to default");
    }

    #[test]
    fn binary_key_of_takes_basename() {
        // Must match `cli_driver::binary_key` so the distribution budget lines
        // up with the runtime per-binary serialization lock.
        assert_eq!(binary_key_of("/usr/bin/claude"), "claude");
        assert_eq!(binary_key_of("codex"), "codex");
    }

    #[test]
    fn count_in_flight_counts_live_tracked_claims_only() {
        let mut node_binary = HashMap::new();
        node_binary.insert("impl-a".to_string(), "claude".to_string());
        node_binary.insert("impl-b".to_string(), "codex".to_string());
        let records = vec![
            ClaimRecord {
                task_id: "impl-a".into(),
                state: RunState::Claimed,
                token: Some("t".into()),
                claimed_at_ms: None,
                heartbeat: None,
            },
            // Released -> not in-flight, must NOT be counted.
            ClaimRecord {
                task_id: "impl-b".into(),
                state: RunState::Released,
                token: None,
                claimed_at_ms: None,
                heartbeat: None,
            },
            // Not in our node->binary map (another run/blade) -> ignored.
            ClaimRecord {
                task_id: "foreign".into(),
                state: RunState::Running,
                token: Some("t".into()),
                claimed_at_ms: None,
                heartbeat: None,
            },
        ];
        let m = count_in_flight(&records, &node_binary);
        assert_eq!(m.get("claude"), Some(&1));
        assert_eq!(m.get("codex"), None, "released claim is not in-flight");
        assert_eq!(m.values().sum::<u32>(), 1, "foreign claim is ignored");
    }

    #[test]
    fn mesh_assign_no_same_binary_parallel_at_capacity_one() {
        // The mesh roster + assign must never place two impl-* slices on the
        // same binary at capacity 1 (the runSerialized invariant, asserted via
        // the Assignment records).
        let roster = vec![
            Blade::new("claude-code-cli", "claude"),
            Blade::new("codex-cli", "codex"),
        ];
        let ready = vec![
            ReadyTask::new("impl-a", Intent::Implement),
            ReadyTask::new("impl-b", Intent::Implement),
        ];
        let out = assign(&ready, &roster, &DistributionPolicy::default(), &HashMap::new());
        assert_eq!(out.len(), 2);
        let bins: std::collections::HashSet<&str> = out
            .iter()
            .map(|a| match a.provider_id.as_str() {
                "claude-code-cli" => "claude",
                "codex-cli" => "codex",
                other => other,
            })
            .collect();
        assert_eq!(bins.len(), 2, "two impl-* must not share a binary at capacity 1");
    }

    /// Drive ONE tick the way `run_dispatch_mesh` does — claim each dispatched
    /// node, report its result, and mark it done (the store-side effect of
    /// `spawn_blade`) — returning the dispatched ids. Lets the integration tests
    /// assert the deps-gated DISPATCH ORDER over the real on-disk stores without
    /// spawning CLIs (the impure spawn is covered by the Story #7 e2e).
    async fn drive_once(
        coord: &mut Coordinator<DispatchSchedulerStore>,
        graph: &TaskGraph,
        claims: &ClaimStore,
    ) -> Vec<String> {
        match coord.tick().await {
            TickOutcome::Dispatched { task_ids, .. } => {
                for id in &task_ids {
                    if let ClaimOutcome::Acquired { token } = claims.try_claim(id).unwrap() {
                        claims.report_result(id, &token).unwrap();
                    }
                    graph.mark_done(id).unwrap();
                }
                task_ids
            }
            other => panic!("expected Dispatched, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn mesh_plan_drives_deps_gated_order_over_real_storage() {
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        let graph = TaskGraph::new(repo.join(".apohara").join("tasks").join("run-test-1"));
        let claims = ClaimStore::new(repo.join(".apohara").join("claims"));
        // 2 path tokens -> plan + 2 impl-* + integrate.
        let ids = build_master_plan(&graph, "update src/auth.rs and src/db.rs", &[]).unwrap();
        assert_eq!(ids.len(), 4, "plan + 2 impl-* + integrate");
        assert_eq!(ids[0], "plan");

        let mut coord =
            Coordinator::new(DispatchSchedulerStore::from_parts(graph.clone(), claims.clone()));

        // Tick 1: only `plan` (impl-* gated on plan; integrate gated on impls).
        assert_eq!(drive_once(&mut coord, &graph, &claims).await, vec!["plan".to_string()]);
        // Tick 2: both impl-* now ready (plan done).
        let t2 = drive_once(&mut coord, &graph, &claims).await;
        assert_eq!(t2.len(), 2, "both disjoint impl slices dispatch in parallel");
        assert!(t2.iter().all(|id| id.starts_with("impl-")));
        // Tick 3: integrate (all impls done).
        assert_eq!(
            drive_once(&mut coord, &graph, &claims).await,
            vec!["integrate".to_string()]
        );
        // Tick 4: drained.
        assert!(matches!(coord.tick().await, TickOutcome::NoOp), "DAG drained");
    }

    #[tokio::test]
    async fn second_mesh_run_is_not_done_poisoned() {
        // Change 2 / Escenario 4: per-run DAG subdirs + shared claims mean a 2nd
        // run on the same repo starts fresh — NOT a silent empty-diff no-op.
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        let claims = ClaimStore::new(repo.join(".apohara").join("claims"));

        // Run 1 under its own subdir; drive it fully done.
        let g1 = TaskGraph::new(repo.join(".apohara").join("tasks").join("run-1"));
        let ids1 = build_master_plan(&g1, "improve the thing", &[]).unwrap();
        for id in &ids1 {
            if let ClaimOutcome::Acquired { token } = claims.try_claim(id).unwrap() {
                claims.report_result(id, &token).unwrap();
            }
            g1.mark_done(id).unwrap();
        }
        assert!(ids1.iter().all(|id| g1.is_done(id).unwrap()), "run-1 fully done");

        // Run 2 on the SAME repo, fresh subdir -> fresh DAG, nothing done.
        let g2 = TaskGraph::new(repo.join(".apohara").join("tasks").join("run-2"));
        build_master_plan(&g2, "improve the thing", &[]).unwrap();
        let mut coord =
            Coordinator::new(DispatchSchedulerStore::from_parts(g2.clone(), claims.clone()));
        match coord.tick().await {
            TickOutcome::Dispatched { task_ids, .. } => {
                assert_eq!(task_ids, vec!["plan".to_string()], "2nd run dispatches plan, not empty");
            }
            other => panic!("2nd run must dispatch plan (no done-poisoning), got {other:?}"),
        }
    }

    #[tokio::test]
    async fn mesh_reap_on_exit_releases_dead_pid_claim() {
        // Reap-on-exit (Change 1): a node whose blade died mid-claim (dead PID)
        // surfaces as StallDetected (the drive loop re-ticks on it), so the loop
        // can never exit with the slot still Claimed. We assert the component
        // property the loop relies on: tick reaps the dead-PID claim + frees it.
        let dir = tempfile::tempdir().unwrap();
        let repo = dir.path();
        let graph = TaskGraph::new(repo.join(".apohara").join("tasks").join("run-x"));
        let claims = ClaimStore::new(repo.join(".apohara").join("claims"));
        build_master_plan(&graph, "do a thing", &[]).unwrap();

        // A blade claims `plan` then "dies": an impossible pid reads as dead.
        let token = match claims.try_claim("plan").unwrap() {
            ClaimOutcome::Acquired { token } => token,
            other => panic!("expected to claim plan, got {other:?}"),
        };
        claims.heartbeat("plan", &token, u32::MAX, 1_000, None).unwrap();

        let mut coord =
            Coordinator::new(DispatchSchedulerStore::from_parts(graph.clone(), claims.clone()));
        // Huge TTL so ONLY the dead-PID signal can reap (isolates the probe).
        coord.set_stall_timeout_ms(u64::MAX / 2);

        match coord.tick().await {
            TickOutcome::StallDetected { task_ids } => {
                assert!(task_ids.contains(&"plan".to_string()), "dead-PID claim reaped");
            }
            other => panic!("expected StallDetected (loop re-ticks, never exits with the slot Claimed), got {other:?}"),
        }
        assert!(!claims.has_active_claim("plan").unwrap(), "reaped slot must be free");
    }

    #[tokio::test]
    async fn audit_mesh_emits_claim_and_merge_records_0600_no_secrets() {
        // US-S3 — the desktop-owned claim + merge call sites produce a JSONL
        // audit file (0600) with ClaimAcquired + MergeCompleted carrying the
        // node id as target, and NO secrets in the payload.
        let dir = tempfile::tempdir().unwrap();
        let audit_dir = dir.path().join("audit");
        let sink = AuditSink::new(&audit_dir, "mesh-desktop").await.unwrap();
        let sink = Some(sink);

        audit_mesh(&sink, EventKind::ClaimAcquired, "claude-code-cli", "impl-src-auth-rs");
        audit_mesh(&sink, EventKind::MergeCompleted, "claude-code-cli", "impl-src-auth-rs");
        // Let the async writer task drain the queue to disk.
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;

        let mut path = None;
        for entry in std::fs::read_dir(&audit_dir).unwrap() {
            let p = entry.unwrap().path();
            if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                path = Some(p);
            }
        }
        let path = path.expect("a mesh audit jsonl file was written");

        // 0600 perms (owner-only) on the audit log.
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
            assert_eq!(mode, 0o600, "audit log must be owner-only (0600)");
        }

        let content = std::fs::read_to_string(&path).unwrap();
        let kinds: Vec<String> = content
            .lines()
            .filter_map(|l| serde_json::from_str::<serde_json::Value>(l).ok())
            .map(|v| v["kind"].as_str().unwrap_or("").to_string())
            .collect();
        assert!(kinds.iter().any(|k| k == "claim_acquired"), "ClaimAcquired present");
        assert!(kinds.iter().any(|k| k == "merge_completed"), "MergeCompleted present");
        // The node id is the target; no token/secret keys in the payload.
        assert!(content.contains("impl-src-auth-rs"), "node id is the audit target");
        for needle in ["token", "secret", "api_key", "ANTHROPIC", "OPENAI"] {
            assert!(!content.contains(needle), "audit payload must not carry `{needle}`");
        }
    }

    #[test]
    fn audit_mesh_with_none_sink_is_a_noop() {
        // Best-effort: a None sink must not panic and must be a silent no-op
        // (audit is never on the dispatch critical path).
        audit_mesh(&None, EventKind::ClaimAcquired, "p", "n");
    }

    #[test]
    fn node_phase_maps_plan_exec_review() {
        // US-S4 — the planner's node ids map to mesh phases for APOHARA_PHASE.
        assert_eq!(node_phase("plan"), "plan", "the plan node is read-only PLAN");
        assert_eq!(node_phase("impl-src-auth-rs"), "exec", "impl slices are the write phase");
        assert_eq!(node_phase("implement"), "exec", "linear-fallback implement is EXEC");
        assert_eq!(node_phase("integrate"), "review", "integrate is human-gated REVIEW");
        assert_eq!(node_phase("verify"), "review", "verify is REVIEW");
        // Unknown id defaults to the permissive write phase (no spurious deny).
        assert_eq!(node_phase("whatever"), "exec");
    }
}
