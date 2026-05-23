# apohara-coordinator — Agent Guide

Semantic conflict coordinator. Decides whether two parallel agents' file-edit
intents collide — line-range overlaps, structural conflicts, dependency
crosswiring — without delegating to git's textual merge.

## Responsibility

- Hold the *intent* graph of in-flight tasks (who plans to touch which file +
  which line range).
- Answer `would_conflict(intent_a, intent_b)` synchronously so the dispatcher
  can serialize at *plan* time, before any worktree has done irreversible work.
- Slim delegate: state ownership lives in `src/core/orchestration/` on the TS
  side; this crate is the verifier + decision oracle, not the system of record.

## Pattern

```rust
use apohara_coordinator::{Intent, SemanticCoordinator};

let mut c = SemanticCoordinator::new();
let a = Intent::edit("src/lib.rs", 100..150);
let b = Intent::edit("src/lib.rs", 200..220);
assert!(!c.would_conflict(&a, &b)); // non-overlapping ranges
let c2 = Intent::edit("src/lib.rs", 140..210);
assert!(c.would_conflict(&a, &c2));  // overlap
```

## What this crate is NOT

- Not a 3-way merge engine — git already does that.
- Not an LSP — it doesn't parse file ASTs; only declared intents are inspected.
- Not the worktree manager — see `apohara-worktree` for lifecycle.

## Testing

Pure Rust, no I/O, no syscalls. Property tests with `proptest` cover the
range-arithmetic edge cases.
