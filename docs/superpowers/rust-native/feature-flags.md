# Apohara Rust-Native Feature Flags

Phase 1 ports defaults flipped to ON in G1.D.2 (Sprint 15 cierre).

| Flag | Crate | Default post-flip | Opt-out (TS legacy fallback) | Sprint enabled |
|---|---|---|---|---|
| APOHARA_RUST_DISPATCH | apohara-dispatch | ON | export `=0` | S12 |
| APOHARA_RUST_VERIFICATION | apohara-verification | ON | export `=0` | S13 |
| APOHARA_RUST_SAFETY | apohara-safety | ON | export `=0` | S13 |
| APOHARA_RUST_SPEC | apohara-spec | ON | export `=0` | S13 |
| APOHARA_RUST_MCP | apohara-mcp | ON | export `=0` | S14 |
| APOHARA_RUST_HOOKS | apohara-hooks | ON | export `=0` | S14 |
| APOHARA_RUST_DECOMPOSER | apohara-decomposer | ON | export `=0` | S14 |
| APOHARA_RUST_PROJECTOR | apohara-projector | ON | export `=0` | S14 |

Predicate: `env_value != Some("0")` — any value other than the literal `"0"` (including unset) is treated as ON.

TS legacy `src/core/*.ts` modules carry `@deprecated` JSDoc markers from G1.D.2 onwards. Full delete lands in Phase 2 S19 once UI rewrite (Dioxus) no longer routes through TS bridges.
