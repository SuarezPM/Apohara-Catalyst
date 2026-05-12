<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **Clarity-Code** (3983 symbols, 8547 relationships, 222 execution flows). Use the GitNexus MCP tools to understand code, assess impact, and navigate safely.

> If any GitNexus tool warns the index is stale, run `npx gitnexus analyze` in terminal first.

## Always Do

- **MUST run impact analysis before editing any symbol.** Before modifying a function, class, or method, run `gitnexus_impact({target: "symbolName", direction: "upstream"})` and report the blast radius (direct callers, affected processes, risk level) to the user.
- **MUST run `gitnexus_detect_changes()` before committing** to verify your changes only affect expected symbols and execution flows.
- **MUST warn the user** if impact analysis returns HIGH or CRITICAL risk before proceeding with edits.
- When exploring unfamiliar code, use `gitnexus_query({query: "concept"})` to find execution flows instead of grepping. It returns process-grouped results ranked by relevance.
- When you need full context on a specific symbol — callers, callees, which execution flows it participates in — use `gitnexus_context({name: "symbolName"})`.

## Never Do

- NEVER edit a function, class, or method without first running `gitnexus_impact` on it.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis.
- NEVER rename symbols with find-and-replace — use `gitnexus_rename` which understands the call graph.
- NEVER commit changes without running `gitnexus_detect_changes()` to check affected scope.

## Resources

| Resource | Use for |
|----------|---------|
| `gitnexus://repo/Clarity-Code/context` | Codebase overview, check index freshness |
| `gitnexus://repo/Clarity-Code/clusters` | All functional areas |
| `gitnexus://repo/Clarity-Code/processes` | All execution flows |
| `gitnexus://repo/Clarity-Code/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
|------|---------------------|
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
## Workflow SDD (Spec Driven Development)

For features of medium/high complexity:

1. **INIT**: Explore codebase with GitNexus, RepoMap, and semantic search.
2. **PROPOSAL**: Draft a brief spec with goal, scope, and risks.
3. **DESIGN**: Define architecture, affected files, and interfaces.
4. **TASKS**: Break into atomic parallelizable tasks.
5. **IMPL**: Execute each task with clean context.
6. **VERIFY**: Validate against original spec before closing.

**Auto-activation triggers**:
- More than 3 new files
- Changes across multiple modules
- Refactors with cross-cutting impact

The 7.0 stack uses this pattern to reduce hallucinations and enforce a formal spec phase before touching code.

## Knowledge Lint (via Engram)

Run every ~5 sessions or when asked:

1. **Contradictions** — `engram search "contradiction" --project Apohara`
2. **Stale data** — flag entries unused for 90+ days
3. **Orphans** — concepts with zero cross-references → suggest links
4. **Coverage gaps** — modules without Engram entries → suggest documenting

## Antigravity Integration

- Antigravity handles frontend/UI tasks in its own git worktree
- OpenCode handles backend/analysis in a separate worktree
- Both share MCP servers (GitNexus, Serena, Engram)
- Never edit the same file from both tools simultaneously
- Full workflow rules in OPENCODE.md
