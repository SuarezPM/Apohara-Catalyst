• engram Connected
┌─────────────┬────────┬──────┬─────────────┬──────────┬──────────────────────────────────────────────────────────────────────────────────────────────┐    • github Connected
│File         │Test    │it/   │Indexer/mem0 │Verdict   │Reason                                                                                        │    • gitnexus Connected
│             │Blocks  │test  │deps         │          │                                                                                              │    • lean-ctx Connected
├─────────────┼────────┼──────┼─────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤    • serena Connected
│sanitize.    │32      │test()│No           │KEEP_GREEN│Pure redaction utility tests; no indexer/mem0 involvement                                     │
│test.ts      │        │      │             │          │                                                                                              │    LSP
├─────────────┼────────┼──────┼─────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤    • typescript
│fallback.    │22      │it()  │No           │KEEP_GREEN│Provider fallback/router logic; no indexer/mem0 imports; mock-based                           │    • biome
│test.ts      │        │      │             │          │                                                                                              │
├─────────────┼────────┼──────┼─────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤    ▼ Modified Files
│github.test. │22      │test()│No           │KEEP_GREEN│GitHub API client unit tests with mocked fetch; no indexer/mem0                               │    .claude/specs/tests/PHASE_5_2_AUD +27
│ts           │        │      │             │          │                                                                                              │    .claude/specs/tests/PHASE_5_2_AUD +19
├─────────────┼────────┼──────┼─────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤    AGENTS.md                       +5 -5
│git.test.ts  │19      │test()│No           │KEEP_GREEN│Pure git URL parsing/validation; no indexer/mem0; minimal test infra                          │    CLAUDE.md                       +6 -6
├─────────────┼────────┼──────┼─────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│build.test.ts│3       │it()  │No           │INVESTIGAT│Tests built dist/cli.js; vitest vs bun:test tooling mismatch; likely broken in CI without     │
│             │        │      │             │E         │Phase 5.1 build fixes                                                                         │
├─────────────┼────────┼──────┼─────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│cli.test.ts  │4       │it()  │No           │INVESTIGAT│Runs actual bun run src/cli.ts; vitest+bun:test mixed; tests CLI file-system side effects;    │
│             │        │      │             │E         │likely env-sensitive                                                                          │
├─────────────┼────────┼──────┼─────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│inngest.test.│12      │it()  │No           │KEEP_GREEN│Inngest client unit tests; no indexer/mem0; mock-based with simple assertions                 │
│ts           │        │      │             │          │                                                                                              │
├─────────────┼────────┼──────┼─────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│mcp-bridge.  │8       │it()  │No direct    │KEEP_REFAC│MCP client/registry interface tests; imports TaskDecomposer but only tests instantiation;     │
│test.ts      │        │      │             │TOR       │Phase 5.1 MCP server changes may affect                                                       │
├─────────────┼────────┼──────┼─────────────┼──────────┼──────────────────────────────────────────────────────────────────────────────────────────────┤
│CLOSE        │        │      │             │          │                                                                                              │
│r5346139e2   │        │      │             │          │                                                                                              │
└─────────────┴────────┴──────┴─────────────┴──────────┴──────────────────────────────────────────────────────────────────────────────────────────────┘

