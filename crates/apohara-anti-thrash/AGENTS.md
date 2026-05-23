# apohara-anti-thrash — Agent Guide

Strategy-rotation tracker that prevents the orchestrator from looping on the
same failing approach. Counts consecutive identical strategy IDs and demands
rotation after a configurable threshold (default 3).

## When to use

- Before issuing the next planner-suggested strategy: ask the tracker whether
  the candidate would repeat a recent run.
- After a strategy completes (success OR failure): record the outcome so the
  rotation count stays accurate.

## Pattern

```rust
use apohara_anti_thrash::{StrategyTracker, RotationVerdict};

let mut t = StrategyTracker::with_threshold(3);
t.record("retry-with-more-context", /* success= */ false);
match t.verdict_for("retry-with-more-context") {
    RotationVerdict::Allow => { /* still under threshold */ }
    RotationVerdict::Rotate { reason } => {
        // pick a different strategy; surface `reason` to the operator
    }
}
```

## What this crate is NOT

- Not the planner — it only rates *candidate* strategies the planner produced.
- Not a circuit breaker for providers — that's `src/core/orchestration/circuitBreaker.ts`.

## TS counterpart

`src/core/anti-thrash/` mirrors the same state machine on the TS side for the
dispatcher's in-process use. The two trackers do NOT share state — the Rust
side is for the daemon process, the TS side for the bun-served orchestrator.
