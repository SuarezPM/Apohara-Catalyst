# apohara-types — Agent Guide

Shared Rust↔TS types (§0.7 Single Source of Truth via `ts-rs`).

## Critical

- **NEVER edit `packages/apohara-shared/types.ts` by hand.** It is regenerated
  by `bun run generate-types`. Any manual edits are silently overwritten on
  the next codegen run.
- When you add `#[derive(TS)]` somewhere, run `bun run generate-types` AND
  commit the regenerated `packages/apohara-shared/types.ts` in the SAME
  commit. CI's `generate-types:check` blocks merges that drift.

## Pattern

```rust
use ts_rs::TS;
use serde::{Serialize, Deserialize};

#[derive(Debug, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../packages/apohara-shared/")]
pub struct MyShared { /* fields */ }
```

## Why this exists

Pre-`dfad239` the codegen binary was a stub that only wrote a header — every
`bun run generate-types` silently overwrote the SSoT with a no-op. The CI
check only proved the stub matched itself. The crate now ships a real
generator binary at `src/bin/generate_types.rs`; CI verifies the output
matches the committed file.

## What this crate is NOT

- Not the orchestration domain types — those live next to their owners.
- Not a runtime — pure types + derive macros, no behaviour.

## Testing

`cargo test -p apohara-types --lib --tests` — runs the codegen + diffs
against committed bindings.
