# CLAUDE.md

> Project-level engineering contract. Extends `~/.claude/CLAUDE.md`.
> Living document. Co-evolves with use. Edit in place. Never rewrite.

---

## 0. Project Overview

**Apohara — the visual vibecoding orchestrator.** Multi-provider swarm + verification mesh + AMD MI300X local-first path via Apohara Context Forge (separate repo). North star: Repo of the Day → 5K stars → adquisición ($20–80M Vercept zone). See `ROADMAP.md` v2.0 for the milestone plan.

Indexed by GitNexus. Last analysis: 2972 symbols, 6099 relationships, 257 execution flows. May be stale after Roadmap 2.0 pivot — refresh with `npx gitnexus analyze` when GitNexus tools warn.

**Stack (locked 2026-05-11):**
- Frontend: **Tauri v2 + Bun.serve + React 19 + SSE** (replaces cancelled Ratatui plan). Single binary <15 MB.
- Orchestration core: TypeScript on Bun runtime. `src/core/` = decomposer / scheduler / verification-mesh / ledger Phase 4 / consolidator.
- Rust sidecars: `apohara-indexer` (tree-sitter + redb + Nomic BERT, ✅), `apohara-sandbox` (seccomp-bpf + namespaces, 🔴 M014).
- Optional GPU backend: **Apohara Context Forge** as HTTP sidecar (`SuarezPM/Apohara_Context_Forge`, parallel repo, INV-15 paper DOI 10.5281/zenodo.20114594).

Code intelligence: GitNexus MCP. Context runtime: lean-ctx MCP.

---

## 1. Memory Hierarchy

Precedence from most general to most specific:
1. `~/.claude/CLAUDE.md`. Global defaults. Behavioral floor.
2. **This file.** Project rules. Extends global.
3. `CLAUDE.local.md`. Private notes. Gitignored.
4. `<subdir>/CLAUDE.md`. Scoped rules.

This file extends global. It does not replace it.
On conflict, more specific wins.

---

## 2. Behavioral Guardrails. Non-negotiable.

### 2.1 Think Before Coding
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present all.
- If a simpler approach exists, say so first.
- If something is unclear, stop. Name what is confusing.
- Do not pick silently when ambiguity exists.

### 2.2 Simplicity First
- No features beyond what was asked.
- No abstractions for single-use code.
- No flexibility that was not requested.
- No error handling for impossible scenarios.
- If 200 lines could be 50, rewrite it.

### 2.3 Surgical Changes
- Touch only what the task requires.
- Do not improve adjacent code or formatting.
- Do not refactor things that are not broken.
- Match existing style, even if you disagree.
- Notice dead code. Mention it. Do not delete it.
- Every changed line must trace to the request.

### 2.4 Goal-Driven Execution
Transform tasks into verifiable goals.
- "Add validation" becomes "Write failing tests, then pass".
- "Fix the bug" becomes "Reproduce in test, then fix".
- "Refactor X" becomes "Tests pass before and after".

For multi-step tasks state plan as:
```
1. <Step> -> verify: <check>
2. <Step> -> verify: <check>
```

---

## 3. Verification Protocol

Before declaring any task done, run this checklist:
- [ ] Success criteria from section 2.4 met and observable.
- [ ] `gitnexus_detect_changes()` ran. Scope confirmed.
- [ ] Tests pass via `bun test`.
- [ ] Lint passes. Types check.
- [ ] Diff matches scope. No drive-by changes.
- [ ] Spec delta updated if behavior changed.
- [ ] No secrets, debug prints, or commented dead code added.
- [ ] Sources cited if external claims made.

---

## 4. Tooling Stack

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

### 4.1 APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

### 4.2 Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

### 4.3 Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.

---

## 5. Code Intelligence. GitNexus.

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

---

## 6. Context Runtime. lean-ctx.

<!-- lean-ctx -->
<!-- lean-ctx-claude-v2 -->
## lean-ctx — Context Runtime

Always prefer lean-ctx MCP tools over native equivalents:
- `ctx_read` instead of `Read` / `cat` (cached, 10 modes, re-reads ~13 tokens)
- `ctx_shell` instead of `bash` / `Shell` (90+ compression patterns)
- `ctx_search` instead of `Grep` / `rg` (compact results)
- `ctx_tree` instead of `ls` / `find` (compact directory maps)
- Native Edit/StrReplace stay unchanged. If Edit requires Read and Read is unavailable, use `ctx_edit(path, old_string, new_string)` instead.
- Write, Delete, Glob — use normally.

Full rules: @rules/lean-ctx.md

Verify setup: run `/mcp` to check lean-ctx is connected, `/memory` to confirm this file loaded.
<!-- /lean-ctx -->

---

## 7. Spec-Driven Workflow

### 7.1 Loop
Every non-trivial change follows this loop:
1. **Propose** before code. Align on intent.
2. **Spec** the delta. Capture requirements that change.
3. **Design** the technical approach.
4. **Tasks** broken into verifiable steps.
5. **Implement** task by task.
6. **Verify** against spec and section 3 checklist.
7. **Archive** to history.

### 7.2 Project Scaffold
```
.claude/
├── specs/                  # Living requirements per capability
│   └── <capability>/
│       └── spec.md
├── changes/                # In-progress proposals
│   └── <change-id>/
│       ├── proposal.md
│       ├── design.md
│       ├── tasks.md
│       └── specs/          # Spec deltas
├── archive/                # Completed changes, dated
└── skills/                 # GitNexus skill files. Already in use.
```

### 7.3 Requirement Format
Every spec uses SHALL statements with scenarios.

```markdown
### Requirement: <Name>
The system SHALL <observable behavior>.

#### Scenario: <Case>
- GIVEN <precondition>
- WHEN <action>
- THEN <expected outcome>
```

### 7.4 Brownfield Rule
Specs get created as needed. Not all upfront.
Generate specs only for areas under active change.
Existing GitNexus index covers code archaeology.

### 7.5 Integration with GitNexus
Before writing a proposal, run `gitnexus_query` for context.
Reference affected symbols and processes in `proposal.md`.
Run `gitnexus_impact` for each target symbol.
Quote blast radius in `design.md`.

---

## 8. Safety Rules. Hard limits.

- Never commit secrets, keys, tokens, credentials.
- Never run destructive commands without explicit confirmation.
- Never edit a symbol without `gitnexus_impact` first.
- Never ignore HIGH or CRITICAL risk warnings.
- Never rename symbols with find-and-replace.
- Never push to main without explicit instruction.
- Never disable tests to make a build pass.
- Never invent data to fill a gap. Say it is missing.
- Never bypass `bun test` before declaring done.

### 8.1 apohara-indexer test execution. OOM hazard.

The `apohara-indexer` crate loads a ~400 MB BERT model. `cargo test` runs test binaries in parallel by default; each binary that touches the indexer loads its own model copy. On this machine (15 GB RAM + 11 GB zram) this has caused 4+ system-wide OOM crashes (logged 2026-05-11).

- NEVER run bare `cargo test` or `cargo test -p apohara-indexer` (spawns lib + integration binaries in parallel).
- NEVER run `bun test` if the suite transitively spawns the indexer daemon.
- Run one test binary at a time: `cargo test -p apohara-indexer --lib`, then `--test memory_integration`, then `--test indexer_persistence`.
- The inter-process flock in `indexer.rs::shared_model()` holds for process lifetime to serialize binaries end-to-end. Do not weaken it. Do not move it out of `#[cfg(test)]`.
- In `embeddings.rs` unit tests, always route model access through `crate::indexer::shared_model()`. Never call `EmbeddingModel::new()` directly in a `#[test]`.

---

## 9. Co-evolution Rules

This file is living configuration.
- If an instruction repeats more than twice in chat, promote it here.
- Edit in place. Never rewrite from scratch.
- Auto-managed blocks have markers. Do not edit between markers manually.
- `<!-- gitnexus:start -->` to `<!-- gitnexus:end -->` is owned by GitNexus.
- `<!-- lean-ctx -->` to `<!-- /lean-ctx -->` is owned by lean-ctx.
- Review monthly. Prune dead rules.
- When a rule misfires, refine it. Do not delete blindly.

---

## 10. Open Items

**Naming reconciled (2026-05-11).** Project is Apohara everywhere. Old "Apohara" references in the GitNexus index are residual from earlier sessions — reindex with `npx gitnexus analyze` to refresh.

**Roadmap 2.0 active.** See `ROADMAP.md` for milestone plan: Phase 5 (test foundation reset) → M014 (sandbox real) → M017 (Tauri+React desktop) → M015 (ContextForge integration) → Phase 6 (v0.1 ship) → M013 (Thompson Sampling) → Phase 7 (v0.2 self-improvement).

**Phase pivot history:**
- v1 ROADMAP (May 2026) planned Ratatui Rust terminal renderer for the TUI. **Cancelled 2026-05-11.** Replaced by Tauri v2 + React (M017) — visual GUI, not terminal, per the user's product direction.
- v1 ROADMAP planned multiple Rust crates (`apohara-shell`, `apohara-compressor`, `apohara-providers`). Only `apohara-indexer` is real; `apohara-sandbox` to be built in M014; others moved to post-v0.2 backlog.
