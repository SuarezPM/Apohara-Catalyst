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

use apohara_dispatch::api::list_active_providers;
use apohara_dispatch::{CliDriver, DispatchRequest};
use apohara_verification::{run_all_gates, AgentRole, GateInput};
use apohara_worktree::lifecycle::{self, CleanupReason};

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
    let repo = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
    let providers: Vec<_> = list_active_providers()
        .into_iter()
        .filter(|p| p.available)
        .collect();

    let mut candidates: Vec<Candidate> = Vec::new();
    for p in providers {
        let task_id = format!("{}-{}", p.id, next_seq());
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

        let req = build_request(&p.binary_path, &workspace, &objective);
        let pid = p.id.clone();
        let outcome = CliDriver::dispatch_streaming(req, move |line| {
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

        // Best-effort cleanup of the per-task worktree; the diff is already
        // captured as text and applied to the main tree on Accept (W4.7).
        let _ = lifecycle::cleanup(&task_id, CleanupReason::Completed, &repo).await;
    }

    set_status(RunStatus::Verifying);
    if let Some(diff) = winning_diff(&candidates) {
        code_diff::set(diff);
    }
    set_status(RunStatus::Idle);
}

/// Build the `DispatchRequest` for a provider run. `provider_binary` is the
/// resolved CLI path (`ActiveProvider::binary_path`), spawned with `--print`.
fn build_request(provider_binary: &str, workspace: &str, objective: &str) -> DispatchRequest {
    DispatchRequest {
        provider_id: provider_binary.to_string(),
        workspace: workspace.to_string(),
        prompt: objective.to_string(),
        role: "coder".to_string(),
        runner_policy: "default".to_string(),
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
        let req = build_request("/usr/bin/claude", "/tmp/wt", "build a thing");
        assert_eq!(req.provider_id, "/usr/bin/claude");
        assert_eq!(req.workspace, "/tmp/wt");
        assert_eq!(req.prompt, "build a thing");
        assert_eq!(req.role, "coder");
        assert_eq!(req.runner_policy, "default");
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
}
