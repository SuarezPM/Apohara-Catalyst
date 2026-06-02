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

use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use dioxus::prelude::*;
use futures_util::StreamExt;

use apohara_dispatch::api::{is_enabled, list_active_providers};
use apohara_dispatch::{ClaimOutcome, ClaimStore, CliDriver, DispatchRequest, ReportOutcome};
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
}
