• lean-ctx Connected
┌───────────────────┬───────┬─────┬───────────┬─────────┬─────────────────────────────────────────────────────────────────────────────────────────────┐    • serena Connected
│File               │Test   │it/  │Indexer/   │Verdict  │Reason                                                                                       │
│                   │Blocks │test │mem0 deps  │         │                                                                                             │    LSP
├───────────────────┼───────┼─────┼───────────┼─────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤    • typescript
│e2e-auto.test.ts   │11     │it() │No         │INVESTIGA│Runs actual CLI via execAsync; vitest+bun:test mixed; many tests skip without API key or     │    • biome
│                   │       │     │           │TE       │depend on env state; likely fragile in CI                                                    │
├───────────────────┼───────┼─────┼───────────┼─────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤    ▼ Modified Files
│e2e-swarm-         │14     │it() │No direct  │KEEP_REFA│Swarm integration tests with mocked routing; imports TaskDecomposer/agent-router; core role  │    .claude/specs/tests/PHASE_5_2_AUD +27
│integration.test.ts│       │     │           │CTOR     │constants may need updates with Phase 5.1                                                    │    .claude/specs/tests/PHASE_5_2_AUD +19
├───────────────────┼───────┼─────┼───────────┼─────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤    .claude/specs/tests/PHASE_5_2_AUD +32
│ecosystem-e2e.test.│6      │it() │No direct  │KEEP_REFA│Lightweight MCP+Inngest integration smoke tests; very shallow (just instantiates objects);   │    AGENTS.md                       +1 -1
│ts                 │       │     │           │CTOR     │Phase 5.1 MCP/Inngest changes may break shallow assertions                                   │    CLAUDE.md                       +2 -2
├───────────────────┼───────┼─────┼───────────┼─────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤    crates/apohara-sandbox/Cargo.toml +24
│isolation.test.ts  │1      │it() │No         │INVESTIGA│Spawns actual git worktree via IsolationEngine; depends on isolation-engine/target/debug/    │    crates/apohara-sandbox/src/error. +27
│                   │       │     │           │TE       │isolation-engine binary needing Phase 5.1 build                                              │    crates/apohara-sandbox/src/lib.rs +23
├───────────────────┼───────┼─────┼───────────┼─────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│state.test.ts      │2      │it() │No         │KEEP_GREE│Minimal StateMachine persistence tests; no indexer/mem0; pure filesystem behavior            │
│                   │       │     │           │N        │                                                                                             │
├───────────────────┼───────┼─────┼───────────┼─────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│subagent-manager.  │22     │it() │No         │KEEP_GREE│SubagentManager pure unit tests with mocked ProviderRouter; 120s timeout, retry/backoff,     │
│test.ts            │       │     │           │N        │dependency graph all mock-based                                                              │
├───────────────────┼───────┼─────┼───────────┼─────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│summary.test.ts    │22     │it() │No         │KEEP_GREE│SummaryGenerator tests with mocked ledger/state; no indexer/mem0; pure markdown generation   │
│                   │       │     │           │N        │logic                                                                                        │
├───────────────────┼───────┼─────┼───────────┼─────────┼─────────────────────────────────────────────────────────────────────────────────────────────┤
│CLOSE r538496bb1   │       │     │           │         │                                                                                             │
└───────────────────┴───────┴─────┴───────────┴─────────┴─────────────────────────────────────────────────────────────────────────────────────────────┘

