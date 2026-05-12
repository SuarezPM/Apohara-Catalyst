
▼ Modified Files
File               │Test   │it/  │Indexer Dependency           │Verdict │Reason                                                                      │    .claude/specs/tests/PHASE_5_2_AUD +27
Blocks │test │                             │        │                                                                            │    AGENTS.md                       +5 -5
CLAUDE.md                       +6 -6
agent-router.test. │12     │it() │No                           │KEEP_GRE│Pure routing logic with mocked config; no indexer/mem0 deps; vitest vs bun:
ts (src/core/)     │       │     │                             │EN      │test is tooling only

consolidator.test. │14     │test(│No                           │KEEP_GRE│Worktree state consolidation logic; no indexer/mem0 imports; tests exit
ts                 │       │)    │                             │EN      │codes and merge logic

auto-shutdown.test.│4      │test(│No direct import but spawns  │INVESTIG│Spawns actual target/release/apohara-indexer binary; 55s timeout test;
ts                 │       │)    │binary                       │ATE     │likely broken in CI without Phase 5.1 daemon fixes + built binary

credentials.test.ts│6      │it() │No                           │KEEP_GRE│Pure credential resolution unit tests; no indexer/mem0 involvement; tests
EN      │file/env fallback

verification-mesh. │18     │it() │Yes — imports IndexerClient, │KEEP_REF│Core mesh verification logic; indexer-coupled via getFileSignatures which
test.ts            │       │     │uses getFileSignatures       │ACTOR   │Phase 5.1 daemon OOM/inproc changes may alter
