//! US-F1.7 — the automated dogfooding smoke for the F0+F1 BYOC mesh.
//!
//! This is the AUTOMATED half of the F1.7 manual gate: it proves the mesh
//! *primitives work TOGETHER* end-to-end, deterministically, with NO real
//! agent CLIs. (The human gate — Pablo running the real desktop and ACCEPTING
//! the diff — is in `docs/superpowers/runbooks/2026-06-02-f1.7-dogfooding-manual-gate.md`.)
//!
//! Why this test lives in `apohara-desktop-dioxus/tests/`: the desktop crate is
//! the one place that deps BOTH `apohara-dispatch` (claim / task-graph / mailbox)
//! AND `apohara-worktree` (lifecycle), so the cross-crate mesh integration can
//! only be exercised here.
//!
//! The four mesh invariants asserted (the F1.7 thesis):
//!   1. NO-DOUBLE-ASSIGNMENT — two heterogeneous blades claim two DISTINCT
//!      tasks; the cross-process atomic claim (F0.0) makes the loser of any
//!      contested task get `AlreadyClaimed`, never a second `Acquired`.
//!   2. COMMUNICATION — each blade drains the OTHER's poll message from its
//!      filesystem mailbox (F1.2).
//!   3. INTEGRATE-GREEN — the SINGLE serialized integrator (F1.6 `merge`,
//!      one HEAD writer) merges BOTH task branches sequentially; HEAD then
//!      holds both files, `git status --porcelain` is empty, `git fsck` clean.
//!   4. NO-HANG — the whole test returns fast (no real CLI to contend on the
//!      claude `~/.claude/` lock); see the closing assertion's comment.
//!
//! Blades are simulated as `tokio` tasks claiming from the SHARED on-disk
//! stores. Cross-process (separate-OS-process) contention was already proven
//! in F0.0's claim tests via real `flock(2)`; here the point is the *mesh
//! composition*, so same-process tasks over the same filesystem stores are the
//! right granularity (the stores are path-only handles by design).

use apohara_dispatch::{ClaimOutcome, ClaimStore, Mailbox, Message, TaskGraph, TaskNode};
use apohara_worktree::lifecycle::{self, MergeResult};
use std::path::{Path, PathBuf};
use std::process::Command;
use tempfile::TempDir;

/// Run a git subcommand in `dir` (sync — fixture setup, not the product path).
/// Panics on spawn failure so a broken fixture is loud. `expect` here is the
/// sanctioned test-only exception to the no-`unwrap`/`expect` guardrail.
fn git(dir: &Path, args: &[&str]) -> std::process::Output {
    Command::new("git")
        .arg("-C")
        .arg(dir)
        .args(args)
        .output()
        .expect("git spawn")
}

/// `git -C <dir> <args>` returning trimmed stdout.
fn git_stdout(dir: &Path, args: &[&str]) -> String {
    String::from_utf8_lossy(&git(dir, args).stdout)
        .trim()
        .to_string()
}

/// Init a repo with one base commit. The `.gitignore` MIRRORS the F1.6
/// lifecycle test's `init_repo` fixture: `.claude/worktrees/` (where
/// `lifecycle::create` checks worktrees out — otherwise it shows as `?? .claude/`
/// in the main repo's status) plus the per-worktree marker files
/// (`.apohara-meta.json` / `.apohara-lock`) so `git add -A` inside a worktree
/// stages only real work, not worktree-local noise.
///
/// One addition over the F1.6 fixture: `.apohara/` is also ignored. This mesh
/// test parks the SHARED stores (ClaimStore / TaskGraph / Mailbox, all rooted
/// at `<repo>/.apohara/...` per their API convention) inside the repo, so
/// `git status --porcelain` would otherwise report `?? .apohara/`. That
/// directory is runtime coordination state — never committed — exactly like
/// `.claude/worktrees/`, so ignoring it is the same discipline, not a fudge.
fn init_repo(dir: &Path) {
    git(dir, &["init", "--initial-branch=main"]);
    git(dir, &["config", "user.email", "t@t"]);
    git(dir, &["config", "user.name", "t"]);
    std::fs::write(
        dir.join(".gitignore"),
        ".claude/worktrees/\n.apohara/\n.apohara-meta.json\n.apohara-lock\n",
    )
    .expect("write .gitignore");
    std::fs::write(dir.join("base.txt"), "base\n").expect("write base.txt");
    git(dir, &["add", "."]);
    git(dir, &["commit", "-m", "init"]);
}

/// What a simulated blade did: the one task it won, the claim token it holds,
/// and the worktree it produced. Carried back out of the spawned task so the
/// no-double-assignment + integrate assertions run on the joined results.
#[derive(Debug)]
struct BladeRun {
    blade: String,
    task_id: String,
    #[allow(dead_code)] // Held to prove a token was minted; not re-validated here.
    token: String,
    worktree: PathBuf,
}

/// One simulated heterogeneous blade.
///
/// Loops over `graph.claimable(&store)` and tries `try_claim` on each candidate
/// until it ACQUIRES exactly one (the loser of a contested task gets
/// `AlreadyClaimed` from the F0.0 advisory lock and moves to the next). On a win
/// it: creates a worktree, writes its task's DISJOINT file + commits on the
/// worktree branch, then sends a "claimed <task>" poll message to the peer.
///
/// `disjoint_file` is the path this task owns. Disjoint paths are decomposed
/// MANUALLY here (not by the symbol-aware `conflict_matrix`) precisely because
/// the matrix needs an a-priori per-task file manifest that an opaque blade
/// cannot produce — that is the deliberate F1.7 design decision.
async fn run_blade(
    blade: String,
    peer: String,
    repo: PathBuf,
    store: ClaimStore,
    graph: TaskGraph,
    mailbox: Mailbox,
    disjoint_file_for: fn(&str) -> &'static str,
) -> BladeRun {
    // Try every currently-claimable task; stop at the first Acquired. Both
    // tasks are claimable up front (no deps), so two blades contend and the
    // loser is deflected to the other task — never a second win on the same id.
    let claimable = graph.claimable(&store).expect("claimable");
    let mut won: Option<(String, String)> = None;
    for task_id in claimable {
        match store.try_claim(&task_id).expect("try_claim") {
            ClaimOutcome::Acquired { token } => {
                won = Some((task_id, token));
                break;
            }
            // Peer beat us to this slot — that is the no-double-assignment
            // guarantee in action; try the next claimable task.
            ClaimOutcome::AlreadyClaimed => continue,
        }
    }
    let (task_id, token) = won.expect("blade must win exactly one task (2 tasks, 2 blades)");

    // Create an isolated worktree, write the task's disjoint file, commit on
    // the worktree's own branch. This is the per-blade isolation that, with the
    // serialized integrator, keeps blades from corrupting one another's HEAD.
    let worktree = lifecycle::create(&task_id, &repo).await.expect("create worktree");
    let file = disjoint_file_for(&task_id);
    std::fs::write(worktree.join(file), format!("from-{blade}\n")).expect("write disjoint file");
    git(&worktree, &["add", "-A"]);
    git(&worktree, &["commit", "-m", &format!("work {task_id}")]);

    // Communicate: tell the peer which task we claimed (poll-delivery mailbox).
    mailbox
        .send(Message {
            from: blade.clone(),
            to: peer,
            body: format!("claimed {task_id}"),
            ts: 1,
        })
        .expect("mailbox send");

    BladeRun {
        blade,
        task_id,
        token,
        worktree,
    }
}

/// Manual disjoint-path manifest (see `run_blade`'s doc): each task owns one
/// file, no overlap, so the two branches merge without a conflict.
fn disjoint_file_for(task_id: &str) -> &'static str {
    match task_id {
        "task-alpha" => "alpha.txt",
        "task-beta" => "beta.txt",
        other => panic!("unknown task id in fixture: {other}"),
    }
}

#[tokio::test]
async fn mesh_two_blades_claim_communicate_integrate_green() {
    // ---- 1. Temp git repo + base commit + the F1.6 `.gitignore` fixture. ----
    let repo_dir = TempDir::new().expect("tempdir");
    let repo = repo_dir.path().to_path_buf();
    init_repo(&repo);

    // ---- 2. Seed the TaskGraph with 2 MANUALLY pre-decomposed, ----
    // DISJOINT-path tasks. No deps between them, so BOTH are claimable up front
    // and the two blades genuinely contend. Manual decomposition is the F1.7
    // design decision (see `run_blade`): an opaque blade can't emit the
    // a-priori file manifest the symbol-aware `conflict_matrix` would need.
    let graph = TaskGraph::new(repo.join(".apohara").join("tasks"));
    graph
        .add_node(TaskNode {
            id: "task-alpha".into(),
            title: "write alpha.txt".into(),
            deps: vec![],
        })
        .expect("add task-alpha");
    graph
        .add_node(TaskNode {
            id: "task-beta".into(),
            title: "write beta.txt".into(),
            deps: vec![],
        })
        .expect("add task-beta");

    // ---- 3. Shared ClaimStore + Mailbox under the same repo `.apohara`. ----
    let store = ClaimStore::new(repo.join(".apohara").join("claims"));
    let mailbox = Mailbox::new(repo.join(".apohara").join("mailbox"));

    // ---- 4. Spawn 2 simulated heterogeneous blades as tokio tasks. ----
    // They share the SAME on-disk stores (path-only handles), so they race the
    // real claim/graph/mailbox files — the mesh composition under test.
    let claude = tokio::spawn(run_blade(
        "claude-sim".into(),
        "codex-sim".into(),
        repo.clone(),
        store.clone(),
        graph.clone(),
        mailbox.clone(),
        disjoint_file_for,
    ));
    let codex = tokio::spawn(run_blade(
        "codex-sim".into(),
        "claude-sim".into(),
        repo.clone(),
        store.clone(),
        graph.clone(),
        mailbox.clone(),
        disjoint_file_for,
    ));
    let run_a = claude.await.expect("claude-sim blade joined");
    let run_b = codex.await.expect("codex-sim blade joined");

    // ---- 5. NO-DOUBLE-ASSIGNMENT invariant. ----
    // The two blades claimed two DISTINCT tasks (never the same id twice), and
    // BOTH tasks got claimed. This is the F0.0 atomic-claim guarantee composed
    // with the F1.1 graph: had the claim raced, both would hold the same id.
    assert_ne!(
        run_a.task_id, run_b.task_id,
        "no-double-assignment: each blade must own a DISTINCT task, got {} and {}",
        run_a.task_id, run_b.task_id
    );
    let mut claimed = [run_a.task_id.as_str(), run_b.task_id.as_str()];
    claimed.sort_unstable();
    assert_eq!(
        claimed,
        ["task-alpha", "task-beta"],
        "both pre-decomposed tasks must be claimed exactly once"
    );
    // The claim store agrees: exactly two records, both non-claimable now (held).
    let records = store.list().expect("list claims");
    assert_eq!(records.len(), 2, "exactly two tasks were claimed");

    // ---- 6. COMMUNICATION invariant (poll delivery). ----
    // Each blade drains ITS inbox and finds the OTHER blade's "claimed <task>"
    // message — the F1.2 mailbox carried a message between heterogeneous blades.
    let claude_inbox = mailbox.check_inbox("claude-sim").expect("claude inbox");
    let codex_inbox = mailbox.check_inbox("codex-sim").expect("codex inbox");
    assert_eq!(claude_inbox.len(), 1, "claude-sim must receive codex-sim's message");
    assert_eq!(codex_inbox.len(), 1, "codex-sim must receive claude-sim's message");
    assert_eq!(claude_inbox[0].from, "codex-sim");
    assert_eq!(codex_inbox[0].from, "claude-sim");
    // The peer announced the task IT claimed — cross-check against the runs.
    let by_blade = |b: &str| -> &str {
        if run_a.blade == b {
            &run_a.task_id
        } else {
            &run_b.task_id
        }
    };
    assert_eq!(
        claude_inbox[0].body,
        format!("claimed {}", by_blade("codex-sim")),
        "claude-sim must hear which task codex-sim actually claimed"
    );
    assert_eq!(
        codex_inbox[0].body,
        format!("claimed {}", by_blade("claude-sim")),
        "codex-sim must hear which task claude-sim actually claimed"
    );

    // ---- 7. INTEGRATE-GREEN invariant. ----
    // The SINGLE serialized integrator merges BOTH branches into HEAD
    // sequentially (F1.6: one HEAD writer, abort-on-conflict). Disjoint files
    // ⇒ both succeed; HEAD ends with BOTH alpha.txt and beta.txt.
    let merge_a = lifecycle::merge(&run_a.task_id, &repo).await.expect("merge a");
    let merge_b = lifecycle::merge(&run_b.task_id, &repo).await.expect("merge b");
    assert!(
        matches!(merge_a, MergeResult::Success),
        "first merge must integrate green: {merge_a:?}"
    );
    assert!(
        matches!(merge_b, MergeResult::Success),
        "second merge must integrate green: {merge_b:?}"
    );

    // The mesh diff contains BOTH blades' disjoint contributions in HEAD.
    assert!(repo.join("alpha.txt").exists(), "alpha.txt missing from integrated HEAD");
    assert!(repo.join("beta.txt").exists(), "beta.txt missing from integrated HEAD");

    // Working tree clean — no half-merged residue from the serialized merges.
    assert!(
        git_stdout(&repo, &["status", "--porcelain"]).is_empty(),
        "repo must be clean after sequential integration"
    );
    // Object store intact — the single-HEAD-writer discipline left no corruption.
    let fsck = git(&repo, &["fsck", "--full"]);
    assert!(
        fsck.status.success(),
        "git fsck --full must be clean: {}",
        String::from_utf8_lossy(&fsck.stderr)
    );

    // Keep the worktree paths referenced so the BladeRun fields aren't dead and
    // the produced trees are observable for debugging.
    assert!(run_a.worktree.exists(), "blade A worktree should still exist");
    assert!(run_b.worktree.exists(), "blade B worktree should still exist");

    // ---- 8. NO-HANG invariant. ----
    // Reaching this line IS the assertion: the whole mesh round-trip returned.
    // The real-CLI 120 s hang comes from two concurrent `claude` children
    // contending on the shared `~/.claude/` session lock; here there is NO real
    // CLI (blades are tokio tasks) and each blade works in its OWN isolated
    // worktree, so nothing contends. In production, `cli_driver::runSerialized`
    // (FIFO per binary) + this per-blade worktree isolation are what keep the
    // real heterogeneous blades from reproducing that hang.
}
