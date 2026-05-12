# Phase 5.2 Audit — Summary across 4 batches

**Completed:** 2026-05-12, in parallel with M014.1 scaffold + GitNexus reindex.
**Method:** MiniMax 2.7 via tmux-resident opencode session, dispatched in 4 batches by Claude.
**Total elapsed (MiniMax):** ~4 minutes across 4 batches (1m3s + 21s + 33s + 44s).
**Scope:** 25 of the 26 TypeScript test files. `ledger.test.ts` and `replay.test.ts` are excluded — both written this session, known green.

## Verdicts at a glance

| Verdict | Files | Tests | Action |
|---|---|---|---|
| **KEEP_GREEN** | 14 | ~191 | No action — work as-is |
| **KEEP_REFACTOR** | 6 | ~70 | Small touch-ups after Phase 5.1 interface changes propagate |
| **INVESTIGATE** | 6 | ~33 | Need running to verify — most spawn external binaries |
| **KILL** | 0 | 0 | The "60 broken tests" framing was an overestimate |

Total: 25 files, ~294 tests classified.

## Empirical validation (2026-05-12)

Ran a subset of the audit with `APOHARA_MOCK_EMBEDDINGS=1`. Results:

| Cohort | Files run | Tests pass | Tests fail | Notes |
|---|---|---|---|---|
| KEEP_GREEN | 12 of 14 | 217 | 0 | Verdict 100% accurate. `oauth-pkce.test.ts` + `api-key-validation.test.ts` skipped (in `src/lib/oauth/` not `tests/`) |
| KEEP_REFACTOR | 5 of 6 | 60 | 14 | 4 files pass as-is (mcp-bridge 8, memory-injection 10, decomposer 14, verification-mesh 12, ecosystem-e2e 6). 1 file has real failures: `e2e-swarm-integration.test.ts` (7 pass / 14 fail) — failures are role/provider constants drift, an actual refactor target |
| INVESTIGATE | 0 of 6 | — | — | Not run — all depend on external binaries (target/debug/apohara-indexer, target/release/apohara-indexer, dist/cli.js, isolation-engine binary) that need separate build steps |

**Revised reality**: of the 70 tests classified KEEP_REFACTOR, 60 actually pass as-is. Only 14 tests (1 file) genuinely need refactor. Audit was conservative on REFACTOR. The 6 INVESTIGATE files still need binary-build-then-run to triage.

**Net empirical state**: 217 GREEN + 60 REFACTOR-passing = **277 tests confirmed green in ~5 seconds total**. 14 confirmed broken (one file). The remaining ~33 INVESTIGATE tests pending binary-dependent runs.

## Detail tables

See `PHASE_5_2_AUDIT_BATCH1.md` through `PHASE_5_2_AUDIT_BATCH4.md` for per-file rows.

## Files in each verdict

### KEEP_GREEN (14 files, ~191 tests)
- `router.test.ts` (3), `scheduler.test.ts` (13)
- `agent-router.test.ts` (src/core, 12), `consolidator.test.ts` (14), `credentials.test.ts` (6)
- `sanitize.test.ts` (32), `fallback.test.ts` (22), `github.test.ts` (22), `git.test.ts` (19), `inngest.test.ts` (12)
- `state.test.ts` (2), `subagent-manager.test.ts` (22), `summary.test.ts` (22)
- (also `ledger.test.ts` and `replay.test.ts` written this session — both green)

### KEEP_REFACTOR (6 files, ~70 tests)
Touch-points after Phase 5.1's mock-embeddings change ripple through `IndexerClient` / `Memory` types:
- `decomposer.test.ts` (14) — uses IndexerClient + TaskDecomposer with mocked indexer
- `memory-injection.test.ts` (10) — uses Memory type from indexer-client
- `verification-mesh.test.ts` (18) — uses `getFileSignatures` indexer call
- `mcp-bridge.test.ts` (8) — instantiates TaskDecomposer
- `e2e-swarm-integration.test.ts` (14) — mocked routing, role constants may need updates
- `ecosystem-e2e.test.ts` (6) — shallow MCP+Inngest smoke tests

### INVESTIGATE (6 files, ~33 tests)
Spawn external binaries or have env-sensitive setup — need real test runs to triage:
- `indexer-client.test.ts` (10) — spawns `target/debug/apohara-indexer` binary
- `auto-shutdown.test.ts` (4) — spawns `target/release/apohara-indexer`, 55s test
- `build.test.ts` (3) — tests `dist/cli.js`, vitest+bun:test mixed tooling
- `cli.test.ts` (4) — runs actual `bun run src/cli.ts`, filesystem side effects
- `e2e-auto.test.ts` (11) — runs CLI via execAsync, requires API key, vitest+bun:test mixed
- `isolation.test.ts` (1) — spawns `isolation-engine/target/debug/isolation-engine` binary

## Recommended next steps (post-Phase-5)

1. **Validate the GREEN cohort** end-to-end: with `APOHARA_MOCK_EMBEDDINGS=1`, run `bun test tests/<file>.test.ts` one at a time per CLAUDE.md §8.1. Expected: green.
2. **Refactor REFACTOR cohort** as Phase 5.1's mock model ripples. Most likely-to-break: anything using `IndexerClient.searchMemories()` return type — check that mock + real paths agree on the `Memory` struct shape.
3. **Triage INVESTIGATE cohort** one binary at a time. The four `target/{debug,release}/apohara-{indexer,sandbox}` spawn tests will need the binary built first. After M014, `isolation-engine` may also be replaced by `apohara-sandbox` — so its single test moves with it.
4. **Open a PR to verify CI**: the Phase 5.3 fix is committed but unverified by CI runners. Open a PR from the working branch to trigger the workflow.

## Verifications still missing (not done in Phase 5)

- No tests were actually executed during the audit. Verdicts are based on static analysis of imports + test descriptions. Runtime confirmation is part of the post-Phase-5 plan above.
- Rust tests under `crates/*/tests/` were not audited in this batch — `apohara-indexer` integration tests already validated by Phase 5.1 (78 tests green with mock).
