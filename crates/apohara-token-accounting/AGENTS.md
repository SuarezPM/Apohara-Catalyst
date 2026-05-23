# apohara-token-accounting — Agent Guide

Token + cost accounting per thread + per provider. Tracks **absolute** counts
(prompt, completion, total) per ledger event, never deltas — §0.14 made this
a discipline after early implementations lost counts on event-storms.

## Pattern

```rust
use apohara_token_accounting::{Accountant, OutcomeRecord};

let mut a = Accountant::new();
a.record(OutcomeRecord {
    thread_id: "thread-42".into(),
    provider: "claude-code-cli".into(),
    prompt_tokens: 1200,
    completion_tokens: 480,
    cost_usd: 0.012,
});
let snap = a.snapshot();
println!("{} cost ${:.4}", snap.thread_total("thread-42"), snap.total_cost());
```

## Critical

- **Absolutes > deltas** (§0.14). Always record the new total, not a delta.
- Per-thread + per-provider rollups are independent — the same outcome bumps
  BOTH counters.
- Snapshots are immutable; subscribers can compare snapshots safely.

## What this crate is NOT

- Not the rate-limiter — see `src/core/providers/` for cooldown/backoff logic.
- Not a billing system — costs are informational; no payments touched here.

## Testing

Pure Rust + property tests for the rollup arithmetic.
