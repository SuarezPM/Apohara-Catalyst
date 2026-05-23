# apohara-worktree — Agent Guide

Git worktree lifecycle: create, lock, release, garbage-collect. Consolidates
the previous `isolation-engine` crate (not yet renamed in branch metadata).
Each parallel agent gets its own worktree so concurrent edits don't race on
the same working tree.

## Pattern

```rust
use apohara_worktree::{WorktreeManager, WorktreeRequest};

let mgr = WorktreeManager::open(repo_root)?;
let wt = mgr.create(WorktreeRequest {
    name: "swift-falcon-a3f9c2",
    base_branch: "main",
})?;
// ... agent does work in wt.path() ...
mgr.release(&wt.id())?; // best-effort; safe to call twice
```

## Critical

- **One worktree per agent task.** Sharing worktrees between agents
  re-introduces the contention the per-worktree pattern was added to
  eliminate.
- **Env isolation** is mandatory — see `apohara-sandbox` and the §0.4 env
  sanitizer. A worktree-scoped env is built per spawn.
- **Lock + leak detection** — `mgr.list_stale(now)` reports worktrees whose
  PID is dead but the meta file still exists. Run it at session end.

## What this crate is NOT

- Not the orchestrator — that decides which task gets a worktree.
- Not git itself — calls out to `git worktree` for the heavy lifting; this
  crate is the contract layer on top.

## Past incidents

`fs.watch` on Linux only fires for the TEMP filename when the writer does
atomic-rename (CLAUDE.md). The worktree's meta/lock writers use atomic
rename — consumers MUST treat every fs.watch event as "rescan", not "named
file appeared".

## Testing

`cargo test -p apohara-worktree --test isolation_serial` — runs each test
in its own tempdir, no concurrency, no shared state.
