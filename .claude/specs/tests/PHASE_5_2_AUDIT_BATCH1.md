
┌─────────────┬──────┬─────┬────────────────────────────────────────────┬───────┬─────────────────────────────────────────────────────────────────────┐    LSP
│File         │Test  │it/  │Indexer Dependency                          │Verdict│Reason                                                               │    • typescript
│             │Blocks│test │                                            │       │                                                                     │    • biome
├─────────────┼──────┼─────┼────────────────────────────────────────────┼───────┼─────────────────────────────────────────────────────────────────────┤
│decomposer.  │14    │it() │Yes — imports IndexerClient type; full      │KEEP_RE│Core business logic; mock-based but heavily coupled to IndexerClient │    Modified Files
│test.ts      │      │     │integration via TaskDecomposer + mocked     │FACTOR │interface which Phase 5.1 OOM/daemon fixes may alter                 │    AGENTS.md                       +5 -5
│             │      │     │indexer                                     │       │                                                                     │    CLAUDE.md                       +6 -6
├─────────────┼──────┼─────┼────────────────────────────────────────────┼───────┼─────────────────────────────────────────────────────────────────────┤
│router.test. │3     │it() │No                                          │KEEP_GR│Simple ProviderRouter + EventLedger unit tests with in-memory config;│
│ts           │      │     │                                            │EEN    │ no indexer deps                                                     │
├─────────────┼──────┼─────┼────────────────────────────────────────────┼───────┼─────────────────────────────────────────────────────────────────────┤
│indexer-     │10    │test(│Yes — direct IndexerClient import; spawns   │INVESTI│Full integration test that runs the real daemon; requires binary     │
│client.test. │      │)    │actual target/debug/apohara-indexer binary  │GATE   │built and daemon spawning; likely broken without OOM fixes in Phase  │
│ts           │      │     │                                            │       │5.1                                                                  │
├─────────────┼──────┼─────┼────────────────────────────────────────────┼───────┼─────────────────────────────────────────────────────────────────────┤
│memory-      │10    │test(│Yes — imports Memory type from indexer-     │KEEP_RE│Pure unit tests with mocked search; only uses the Memory type; core  │
│injection.   │      │)    │client                                      │FACTOR │format/injection logic is sound but type may evolve with Phase 5.1   │
│test.ts      │      │     │                                            │       │                                                                     │
├─────────────┼──────┼─────┼────────────────────────────────────────────┼───────┼─────────────────────────────────────────────────────────────────────┤
│scheduler.   │13    │it() │No                                          │KEEP_GR│ParallelScheduler + MockIsolationEngine; no IndexerClient involved;  │
│test.ts      │      │     │                                            │EEN    │should pass as-is                                                    │
├─────────────┼──────┼─────┼────────────────────────────────────────────┼───────┼─────────────────────────────────────────────────────────────────────┤
│CLOSE        │      │     │                                            │       │                                                                     │
│r530745da4   │      │     │                                            │       │                                                                     │
└─────────────┴──────┴─────┴────────────────────────────────────────────┴───────┴─────────────────────────────────────────────────────────────────────┘

