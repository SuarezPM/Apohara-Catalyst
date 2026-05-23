# Apohara Catalyst Sprint 7.5 — Cleanup Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los gaps reales antes del rebrand Catalyst. Wiring de 18-20 standalone primitives + fix 3 TS errors pre-existing + borrar 30 fails legacy v1 + §0.33 crash reports + SKILL.md Apohara como Claude Code skill.

**Architecture:** 5 grupos de tareas TDD bite-sized, paralelizables a 4 implementers Opus (archivos disjuntos). Cada tarea cierra con commit con paths inline (regla earned Sprint 4). Branch destino: `feat/apohara-catalyst` (deriva de `feat/apohara-ultimate` post-Sprint-7).

**Tech Stack:** Bun 1.3.13 + TypeScript 5+ + Rust stable + bun:sqlite + bun:test + cargo test (OOM-safe per-binary).

---

## Estructura del Sprint 7.5

### 5 grupos

| Grupo | Tema | # tareas | Esfuerzo | Implementer |
|---|---|---:|---:|---|
| **G7.5.A** | Wiring 18-20 standalone primitives | ~10 | 2 días | 1 |
| **G7.5.B** | Fix 3 TS errors pre-existing | 3 | 0.5 día | 2 |
| **G7.5.C** | Delete legacy v1 dead code (30 fails) | 1 | 0.5 día | 3 |
| **G7.5.D** | §0.33 crash reports local-first | 3 | 0.5 día | 4 |
| **G7.5.E** | SKILL.md Apohara as Claude Code skill | 2 | 0.5 día | 4 (paraleliza con G7.5.D) |

**Total**: ~19 tareas, ~3-4 días con 4 implementers paralelos.

---

## Setup (antes de Wave)

- [ ] **Setup 1: Crear branch desde Ultimate post-Sprint-7**

```bash
git checkout feat/apohara-ultimate
git checkout -b feat/apohara-catalyst
```

- [ ] **Setup 2: Verificar base verde**

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/ tests/cli/`
Expected: **1240 pass / 0 fail / 213 files**

Run: `bunx tsc --noEmit 2>&1 | tail -5`
Expected: 3 pre-existing errors (`McpServer.ts:67×2`, `watcher.ts:53`)

Run: `cargo build --workspace --exclude apohara-indexer 2>&1 | tail -5`
Expected: success (apohara-indexer excluded por OOM hazard, será removed en Sprint 8)

---

## G7.5.A — Wiring standalone primitives (~10 tareas, 2 días)

**Outcome esperado**: Los ~18-20 primitives entregados en Sprints 5-6 como build-then-integrate ahora están consumidos por producción. Cero modules huérfanos.

### Task G7.5.A.1: Wire `buildSystemPrompt` en BaseAgentProvider.spawn

**Files:**
- Modify: `src/core/providers/BaseAgentProvider.ts:80-130` (aprox — inspeccionar `spawn` method)
- Modify: `tests/core/providers/baseAgentProvider.test.ts` (extender)

- [ ] **Step 1: Failing integration test**

Crear test en `tests/core/providers/baseAgentProvider.test.ts`:

```typescript
import { expect, test } from "bun:test";
import { BaseAgentProvider } from "../../../src/core/providers/BaseAgentProvider";
import { ClaudeCodeProtocol } from "../../../src/core/providers/protocols/ClaudeCodeProtocol";
import { buildSystemPrompt } from "../../../src/core/providers/prompt-builders";

test("BaseAgentProvider.spawn passes buildSystemPrompt output to protocol.createSession", async () => {
  const protocol = new ClaudeCodeProtocol();
  let capturedSystemPrompt: string | undefined;
  const originalCreate = protocol.createSession.bind(protocol);
  protocol.createSession = async (opts) => {
    capturedSystemPrompt = opts.systemPrompt;
    return originalCreate(opts);
  };
  const provider = new (class extends BaseAgentProvider {
    get id() { return "claude-code-cli" as const; }
    get displayName() { return "Claude"; }
    get roles() { return ["coder"] as const; }
    get protocol() { return protocol; }
  })();
  try {
    await provider.spawn({ workspacePath: "/tmp", prompt: "test", role: "coder" });
    expect(capturedSystemPrompt).toBeDefined();
    expect(capturedSystemPrompt!).toContain("coder");
  } catch (err) {
    if ((err as Error).message.includes("ENOENT")) return;
    throw err;
  }
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `bun test tests/core/providers/baseAgentProvider.test.ts -t "buildSystemPrompt"`
Expected: FAIL — `capturedSystemPrompt` is undefined (BaseAgentProvider no llama buildSystemPrompt).

- [ ] **Step 3: Wire buildSystemPrompt en BaseAgentProvider.spawn**

Modificar `src/core/providers/BaseAgentProvider.ts` — agregar import + invocación:

```typescript
import { buildSystemPrompt } from "./prompt-builders";

export abstract class BaseAgentProvider {
  // ... existing code ...

  async spawn(opts: { workspacePath: string; prompt: string; role: AgentRole; env?: Record<string, string> }): Promise<SpawnedSession> {
    const systemPrompt = buildSystemPrompt({
      providerId: this.id,
      role: opts.role,
      capabilities: this.capabilities ?? {},
    });
    return this.protocol.createSession({
      workspacePath: opts.workspacePath,
      systemPrompt,
      env: opts.env,
    });
  }
}
```

- [ ] **Step 4: Run test → PASS**

Run: `bun test tests/core/providers/baseAgentProvider.test.ts -t "buildSystemPrompt"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(providers): wire buildSystemPrompt en BaseAgentProvider.spawn (G7.5.A.1)

G5.A.3 entregó buildSystemPrompt como standalone module sin
consumer. Ahora BaseAgentProvider.spawn lo invoca antes de pasar
opts a protocol.createSession. Los 3 protocols (Claude/Codex/
OpenCode) reciben systemPrompt construido con role + capabilities.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/providers/BaseAgentProvider.ts tests/core/providers/baseAgentProvider.test.ts
```

### Task G7.5.A.2: Wire `projectToUiCards` + `projectToSearchRows` en TaskBoard + indexer

**Files:**
- Modify: `packages/desktop/src/components/TaskBoard.tsx` — usar `projectToUiCards`
- Modify: `crates/apohara-indexer/src/lib.rs` — usar `projectToSearchRows` para ingest (o equivalente TS bridge)
- Create: `tests/integration/projector-wiring.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { projectToUiCards, projectToSearchRows } from "../../src/core/projector/transcript-transformer";

test("projectToUiCards transforms raw ledger entries to UI cards", () => {
  const ledgerEntries = [
    { kind: "task_scheduled", taskId: "t1", title: "Add JWT auth", scheduledAt: 1000 },
    { kind: "task_completed", taskId: "t1", completedAt: 2000, durationMs: 1000 },
  ];
  const cards = projectToUiCards(ledgerEntries);
  expect(cards.length).toBe(1);
  expect(cards[0].id).toBe("t1");
  expect(cards[0].state).toBe("done");
  expect(cards[0].durationMs).toBe(1000);
});

test("projectToSearchRows produces FTS5-indexable rows", () => {
  const ledgerEntries = [
    { kind: "task_scheduled", taskId: "t1", title: "Add JWT auth", prompt: "implement JWT" },
  ];
  const rows = projectToSearchRows(ledgerEntries);
  expect(rows.length).toBe(1);
  expect(rows[0].taskId).toBe("t1");
  expect(rows[0].searchableText).toContain("JWT");
});
```

- [ ] **Step 2: Run test → PASS** (módulo ya existe G5.F.1)

Verify projector module exists with expected exports:
```bash
grep -E "projectToUiCards|projectToSearchRows" src/core/projector/transcript-transformer.ts
```

- [ ] **Step 3: Wire en TaskBoard.tsx**

Inspeccionar `packages/desktop/src/components/TaskBoard.tsx`. Reemplazar reparsing manual del ledger por:

```typescript
import { projectToUiCards } from "../../../src/core/projector/transcript-transformer";
// ...
const cards = useMemo(() => projectToUiCards(ledgerEntries), [ledgerEntries]);
```

- [ ] **Step 4: Wire en indexer ingest path**

`crates/apohara-indexer/src/lib.rs` — agregar bridge TS (via Bun spawn) o directamente leer projected rows del ledger. **Nota**: si Sprint 8 va a reemplazar el indexer con sqlite-vec, este wiring puede ser temporal. Documentar como TODO en commit.

- [ ] **Step 5: Run integration test + browser smoke**

Run: `bun test tests/integration/projector-wiring.test.ts`
Expected: PASS

Manual smoke: start dev server, seed-demo, verify kanban renderiza con cards.

- [ ] **Step 6: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(projector): wire projectToUiCards + projectToSearchRows (G7.5.A.2)

G5.F.1 entregó two-tier canonical projection. Ahora TaskBoard.tsx
usa projectToUiCards en lugar de reparsing manual del ledger.
Indexer ingest path consume projectToSearchRows (temporal pre-Sprint-8
sqlite-vec swap).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" packages/desktop/src/components/TaskBoard.tsx crates/apohara-indexer/src/lib.rs tests/integration/projector-wiring.test.ts
```

### Task G7.5.A.3: Wire `diffPatch` + `applyPatch` en SSE dispatcher

**Files:**
- Modify: `packages/desktop/src/server.ts` (route SSE handler) — usar `diffPatch` en lugar de full state re-send
- Modify: `packages/desktop/src/store/listeners/sseListener.ts` — usar `applyPatch` en client
- Create: `tests/integration/sse-json-patch.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { diffPatch, applyPatch } from "../../src/core/projector/json-patch-stream";

test("diffPatch produces RFC6902 patches between two states", () => {
  const before = { tasks: { t1: { state: "ready" } } };
  const after = { tasks: { t1: { state: "running" } } };
  const patches = diffPatch(before, after);
  expect(patches.length).toBe(1);
  expect(patches[0]).toEqual({ op: "replace", path: "/tasks/t1/state", value: "running" });
});

test("applyPatch reverses diffPatch deterministically", () => {
  const before = { tasks: { t1: { state: "ready" } } };
  const after = { tasks: { t1: { state: "running" }, t2: { state: "ready" } } };
  const patches = diffPatch(before, after);
  const result = applyPatch(before, patches);
  expect(result).toEqual(after);
});
```

- [ ] **Step 2: Run test → PASS** (modulo G5.F.3 ya entregado)

- [ ] **Step 3: Wire SSE server-side**

Inspect `packages/desktop/src/server.ts` SSE route. Cuando estado cambia:
- Almacenar último state enviado en memoria per-client
- Calcular `diffPatch(lastSentState, currentState)` 
- Send patches via SSE event `state-patch`
- Update lastSentState

- [ ] **Step 4: Wire SSE client-side**

`packages/desktop/src/store/listeners/sseListener.ts` — recibir `state-patch` event, aplicar `applyPatch` al store atom.

- [ ] **Step 5: Smoke + commit**

Run integration test + manual browser smoke (verify network tab muestra patches incrementales, no full state).

```bash
git commit -m "$(cat <<'EOF'
feat(sse): wire diffPatch/applyPatch streaming (G7.5.A.3)

G5.F.3 entregó JSON-Patch RFC 6902 streaming. SSE server-side
ahora envía patches incrementales en lugar de re-send full state.
Client-side aplica con applyPatch (idempotente sobre re-deliver).
Reduce bandwidth + render churn.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" packages/desktop/src/server.ts packages/desktop/src/store/listeners/sseListener.ts tests/integration/sse-json-patch.test.ts
```

### Task G7.5.A.4: Replace `runReconcilerTick` legacy con `runReconcilerPasses`

**Files:**
- Modify: `packages/desktop/src/server.ts:18` (call site legacy)
- Create: `tests/integration/reconciler-passes-wiring.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { runReconcilerPasses } from "../../src/core/dispatch/reconciler";

test("runReconcilerPasses executes multi-pass reconciliation", async () => {
  const ctx = { ledgerPath: "/tmp/test-ledger.jsonl", workspace: "/tmp", sessionId: "test" };
  const result = await runReconcilerPasses(ctx);
  expect(result.passes).toBeGreaterThanOrEqual(1);
  expect(result.actions).toBeDefined();
});
```

- [ ] **Step 2: Wire en server.ts**

Replace `runReconcilerTick(ctx)` calls con `runReconcilerPasses(ctx)`. G5.B.2 ya entregó la versión multi-pass.

- [ ] **Step 3: Smoke + commit**

```bash
git commit -m "$(cat <<'EOF'
refactor(dispatch): wire runReconcilerPasses, drop runReconcilerTick legacy (G7.5.A.4)

G5.B.2 entregó runReconcilerPasses (multi-pass + blocked aging).
server.ts:18 todavía llamaba al legacy runReconcilerTick. Replace
ahora — multi-pass detecta stalls + ages blocked tasks correctamente.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" packages/desktop/src/server.ts tests/integration/reconciler-passes-wiring.test.ts
```

### Task G7.5.A.5: Wire `BlockedReason` classifier en provider event ingestion

**Files:**
- Modify: `src/core/providers/protocols/AgentProtocol.ts` (event handler base) — clasificar blocked events
- Modify: `src/core/dispatch/state.ts` — usar BlockedReason en transitions
- Create: `tests/integration/blocked-reason-wiring.test.ts`

- [ ] **Step 1: Failing test + impl + commit**

Pattern: protocol event con `kind: "blocked"` ahora pasa por `classifyBlocked(event)` (G5.B.3) y emite transition con BlockedReason específico (PermissionDenied, NetworkError, AuthExpired, etc.).

```bash
git commit -m "$(cat <<'EOF'
feat(dispatch): wire BlockedReason classifier en protocol events (G7.5.A.5)

G5.B.3 entregó BlockedReason enum + classifier. Provider events
con kind: "blocked" ahora pasan por classifyBlocked → emite
transition con BlockedReason específico. State machine tiene la
info necesaria para hacer retry decision inteligente.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/providers/protocols/AgentProtocol.ts src/core/dispatch/state.ts tests/integration/blocked-reason-wiring.test.ts
```

### Task G7.5.A.6: Wire `continuation` + `retry-semantics` + `teammate-idle` + `careful-mode` al Coordinator

**Files:**
- Modify: `crates/apohara-coordinator/src/coordinator.rs` (tick implementation)
- Modify: `crates/apohara-coordinator/src/lib.rs` (pub use of new modules)
- Create: `crates/apohara-coordinator/tests/continuation_wiring.rs`

- [ ] **Step 1-5: Wire los 4 modules entregados en G5.B al Coordinator tick**

```bash
git commit -m "$(cat <<'EOF'
feat(coordinator): wire continuation/retry/teammate-idle/careful-mode (G7.5.A.6)

G5.B.4/.8/.9/.10 entregaron 4 modules. Coordinator tick ahora
consulta los 4 en decision-making:
- continuation: re-use context vs fresh spawn
- retry-semantics: backoff strategy per failure kind
- teammate-idle: dispatch a agent disponible si current está saturated
- careful-mode: skip dispatch si Freeze/Careful state activo

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" crates/apohara-coordinator/src/coordinator.rs crates/apohara-coordinator/src/lib.rs crates/apohara-coordinator/tests/continuation_wiring.rs
```

### Task G7.5.A.7: Wire hooks compact-reinjection + additionalContext + learnings-dump + context-warnings al apohara-hooks-server

**Files:**
- Modify: `crates/apohara-hooks-server/src/server.rs` — handler que invoca los 4 modules TS
- Modify: `src/core/hooks/compact-reinjection.ts` — exportar handler para llamadas desde Rust (via bridge)
- Create: `crates/apohara-hooks-server/tests/wiring.rs`

- [ ] **Step 1-5: Wire G5.C.1/.3/.5/.6 modules al hooks server route**

```bash
git commit -m "$(cat <<'EOF'
feat(hooks-server): wire compact-reinjection + additionalContext + learnings-dump + context-warnings (G7.5.A.7)

G5.C entregó 4 modules de hooks coordination. Ahora apohara-hooks-server
los invoca cuando recibe Pre/PostCompact / additionalContext-request /
learnings-dump / context-warnings events de los CLIs.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" crates/apohara-hooks-server/src/server.rs src/core/hooks/compact-reinjection.ts crates/apohara-hooks-server/tests/wiring.rs
```

### Task G7.5.A.8: Wire `composeWorktreeEnv` al spawn path

**Files:**
- Modify: `src/providers/cli-driver.ts` — invoke composeWorktreeEnv antes de sanitizeEnv
- Create: `tests/integration/worktree-env-wiring.test.ts`

- [ ] **Step 1-5: Wire G5.C.4 (composeWorktreeEnv) al spawn**

`composeWorktreeEnv` carga `.env` del worktree + filtra blocklist + agrega forced markers. Ahora `cli-driver.ts` lo invoca antes de `sanitizeEnv` (§0.4 ordering preserved).

```bash
git commit -m "$(cat <<'EOF'
feat(safety): wire composeWorktreeEnv al spawn path (G7.5.A.8)

G5.C.4 entregó composeWorktreeEnv. Spawn path ahora carga el .env
del worktree (defense in depth con DEFAULT_BLOCKLIST de §0.4
envSanitizer). Forced markers (APOHARA_*) van al final del merge,
inmutables vs malicious .env.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/providers/cli-driver.ts tests/integration/worktree-env-wiring.test.ts
```

### Task G7.5.A.9: Wire `auto-approval` + `guardrail-flags` + `line-framed` + `tracker-adapter` a permissions + protocols

**Files:**
- Modify: `src/core/safety/permissionService.ts` — invocar auto-approval heuristic
- Modify: `src/core/safety/permissionGuard.ts` (G5.D.2) — usar guardrail-flags
- Modify: `src/core/providers/protocols/*Protocol.ts` — usar line-framed sanitizer en stdout/stderr
- Modify: `crates/apohara-anti-thrash/src/lib.rs` — usar tracker-adapter
- Create: tests integration

- [ ] **Step 1-5: Wire G5.G modules a permissions + protocols**

```bash
git commit -m "$(cat <<'EOF'
feat(safety+protocols): wire auto-approval + guardrail-flags + line-framed + tracker-adapter (G7.5.A.9)

G5.G entregó 4 modules:
- auto-approval: permissionService consulta antes de prompt UI
- guardrail-flags: permissionGuard ingesta flags self-describing
- line-framed: protocols sanitizan stdout/stderr (ANSI + C0 + UTF-8 cap)
- tracker-adapter: anti-thrash usa peek() para dashboard humanizer

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/safety/permissionService.ts src/core/safety/permissionGuard.ts src/core/providers/protocols/ClaudeCodeProtocol.ts src/core/providers/protocols/CodexProtocol.ts src/core/providers/protocols/OpenCodeProtocol.ts crates/apohara-anti-thrash/src/lib.rs tests/integration/safety-protocols-wiring.test.ts
```

### Task G7.5.A.10: Wire `canonicalize_recursive` + `DanglingSymlink` Rust extras al sandbox

**Files:**
- Modify: `crates/apohara-sandbox/src/runner/imp.rs` — usar canonicalize_recursive (G5.G.3) para path validation
- Create: `crates/apohara-sandbox/tests/canonicalize_wiring.rs`

- [ ] **Step 1-5: Wire pathsafety extras al sandbox runner**

```bash
git commit -m "$(cat <<'EOF'
feat(sandbox): wire canonicalize_recursive + DanglingSymlink (G7.5.A.10)

G5.G.3 expandió apohara-pathsafety con canonicalize_recursive
(hop-by-hop walk) + DanglingSymlink/SymlinkLoop/EscapesRoot
errores específicos. Ahora apohara-sandbox runner usa esto antes
de spawn — rejecta paths con ../ rebote, dangling symlinks, loops.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" crates/apohara-sandbox/src/runner/imp.rs crates/apohara-sandbox/tests/canonicalize_wiring.rs
```

---

## G7.5.B — Fix 3 TS errors pre-existing (0.5 día)

### Task G7.5.B.1: Fix `McpServer.ts:67` narrowing (2 errors)

**Files:**
- Modify: `src/core/mcp/base/McpServer.ts:67`

- [ ] **Step 1: Inspect current state**

Read `src/core/mcp/base/McpServer.ts:60-80`. Esperar pattern:
```typescript
const config: { host: string; port: number } = {
  host: this.config?.host,   // string | undefined → narrowing fail
  port: this.config?.port,   // number | undefined → narrowing fail
};
```

- [ ] **Step 2: Fix con defaults explícitos**

```typescript
const config = {
  host: this.config?.host ?? "127.0.0.1",
  port: this.config?.port ?? 0,
};
```

O bien narrowing con guard:
```typescript
if (!this.config?.host || !this.config?.port) {
  throw new Error("McpServer config missing host/port");
}
const config = { host: this.config.host, port: this.config.port };
```

- [ ] **Step 3: Run tsc → verify 0 errors en McpServer.ts**

Run: `bunx tsc --noEmit 2>&1 | grep McpServer`
Expected: empty (0 errors)

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(mcp): McpServer.ts:67 narrowing — defaults + guard (G7.5.B.1)

Pre-existing TS error: string | undefined / number | undefined no
asignable a string / number. Defaults explícitos (127.0.0.1 + port 0
kernel-assigned) preservan behavior current.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/mcp/base/McpServer.ts
```

### Task G7.5.B.2: Fix `watcher.ts:53` chokidar onlyFiles property

**Files:**
- Modify: `src/core/spec/watcher.ts:53`

- [ ] **Step 1: Inspect**

Read `src/core/spec/watcher.ts:45-60`. Esperar:
```typescript
const watcher = chokidar.watch(specPath, {
  ignored: /node_modules/,
  awaitWriteFinish: true,
  onlyFiles: true,  // ← TS2353: not in BasicOpts type
});
```

- [ ] **Step 2: Drop `onlyFiles` property**

chokidar 5 ignora la opción en runtime, ya no es válida. Eliminar la línea.

- [ ] **Step 3: Verify tests existentes siguen verde**

Run: `bun test tests/core/spec/`
Expected: PASS (los 6 watcher tests existentes mantienen behavior)

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
fix(spec): drop watcher.ts onlyFiles option — chokidar 5 ignores it (G7.5.B.2)

Pre-existing TS error TS2353: onlyFiles no existe en chokidar 5's
BasicOpts type. La opción siempre fue ignorada en runtime (los 6
watcher tests existentes pasan sin ella). Drop limpia el typecheck.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/spec/watcher.ts
```

### Task G7.5.B.3: Verify 0 TS errors total

- [ ] **Step 1: Run tsc**

Run: `bunx tsc --noEmit 2>&1 | tail -10`
Expected: **empty output** (0 errors).

Si quedan errors, identificar y fix en commits adicionales (no se anticipan otros pre-existing).

- [ ] **Step 2: Commit verification**

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore(types): 0 TypeScript errors confirmed (G7.5.B.3)

Post-G7.5.B.1 + G7.5.B.2 fixes, bunx tsc --noEmit returns clean.
Los 3 pre-existing errors documentados en CLAUDE.md eliminados.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## G7.5.C — Delete legacy v1 dead code (0.5 día, 1 mega-tarea)

### Task G7.5.C.1: Borrar 5 archivos legacy v1 + sus tests

**Files to delete (con `git rm`):**
- `src/agent-router.ts` + tests
- `src/capability-manifest.ts` + tests  
- `src/config/validation.ts` + tests
- `src/subagent-manager.ts` + tests
- `src/providers/router.ts` (legacy) + tests

- [ ] **Step 1: Verify no consumers en src/core/* o packages/desktop/***

```bash
for f in agent-router capability-manifest config/validation subagent-manager providers/router; do
  echo "=== $f ===" 
  grep -rln "from.*$f\|import.*$f" src/core/ packages/desktop/ tests/ 2>/dev/null | grep -v "^src/$f" | head -5
done
```

Expected: empty (sin consumers). Si aparece consumer, abortar — NO borrar (escalate).

- [ ] **Step 2: Borrar archivos + tests**

```bash
git rm src/agent-router.ts tests/src/agent-router.test.ts 2>/dev/null
git rm src/capability-manifest.ts tests/src/capability-manifest.test.ts 2>/dev/null
git rm src/config/validation.ts tests/src/config/validation.test.ts 2>/dev/null
git rm src/subagent-manager.ts tests/src/subagent-manager.test.ts 2>/dev/null
git rm src/providers/router.ts tests/src/providers/router.test.ts 2>/dev/null
```

Verify: `git status` muestra ~10 files deleted.

- [ ] **Step 3: Run suite — verify -30 fails desaparecen**

Run: `bun test src tests 2>&1 | tail -5`
Expected: fails dropped from ~30 (pre-cleanup) to ~0 (post-cleanup).

- [ ] **Step 4: Commit**

```bash
git commit -m "$(cat <<'EOF'
chore(cleanup): delete legacy v1 dead code (G7.5.C.1)

Borra 5 archivos sin consumer post-Stage-11:
- src/agent-router.ts (Agent Router legacy)
- src/capability-manifest.ts (Capability Manifest legacy)
- src/config/validation.ts (Config Validation legacy)
- src/subagent-manager.ts (SubagentManager legacy)
- src/providers/router.ts (legacy router pre-CLI-wrappers-only)

+ sus tests. Verificado: grep -rln cross-codebase no encontró
consumers. 30 fails legacy desaparecen de suite.

Recoverable via git history si reaparece use case (unlikely —
v1.0 Catalyst es CLI-wrappers-only, estos modules eran del
HTTP/OAuth path original deprecated).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## G7.5.D — §0.33 Crash reports local-first (0.5 día, 3 tareas)

### Task G7.5.D.1: `installId.ts` — UUID v4 generado en first-run

**Files:**
- Create: `src/core/crash-reports/installId.ts`
- Create: `tests/core/crash-reports/install-id.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getOrCreateInstallId } from "../../../src/core/crash-reports/installId";

let originalHome: string | undefined;
let fakeHome: string;
beforeEach(async () => {
  originalHome = process.env.HOME;
  fakeHome = await mkdtemp(join(tmpdir(), "apohara-installid-"));
  process.env.HOME = fakeHome;
});
afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await rm(fakeHome, { recursive: true, force: true });
});

test("first call creates UUID v4 + persists", async () => {
  const id = await getOrCreateInstallId();
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("subsequent calls return same UUID", async () => {
  const id1 = await getOrCreateInstallId();
  const id2 = await getOrCreateInstallId();
  expect(id1).toBe(id2);
});
```

- [ ] **Step 2: Run test → FAIL** (module not found)

- [ ] **Step 3: Implement**

```typescript
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { randomUUID } from "node:crypto";

const idPath = () => join(process.env.HOME ?? homedir(), ".apohara", "install-id");

export async function getOrCreateInstallId(): Promise<string> {
  const path = idPath();
  try {
    const existing = await readFile(path, "utf-8");
    const trimmed = existing.trim();
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(trimmed)) {
      return trimmed;
    }
  } catch { /* fall through */ }
  const fresh = randomUUID();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, fresh, { mode: 0o600 });
  return fresh;
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(crash-reports): install-id UUID v4 persisted (G7.5.D.1, §0.33)

Local-first anonymous install identifier. UUID v4 strict regex
validation. Persisted en ~/.apohara/install-id con mode 0600. No
telemetry data, no opt-in tracking — solo identificador anónimo
para de-duplicate crash reports si user envía múltiples.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/crash-reports/installId.ts tests/core/crash-reports/install-id.test.ts
```

### Task G7.5.D.2: `jsonl.ts` — append-only crash report log

**Files:**
- Create: `src/core/crash-reports/jsonl.ts`
- Create: `tests/core/crash-reports/jsonl.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendCrashReport, loadCrashReports } from "../../../src/core/crash-reports/jsonl";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "apohara-crash-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("appendCrashReport writes JSONL line", async () => {
  const path = join(dir, "crash.jsonl");
  await appendCrashReport(path, {
    ts: 1000,
    installId: "test-uuid",
    message: "Test error",
    stack: "stack trace here",
    context: { sprint: "7.5" },
  });
  const content = await readFile(path, "utf-8");
  const parsed = JSON.parse(content.trim());
  expect(parsed.message).toBe("Test error");
});

test("loadCrashReports returns ordered list", async () => {
  const path = join(dir, "crash.jsonl");
  await appendCrashReport(path, { ts: 1000, installId: "a", message: "m1", stack: "", context: {} });
  await appendCrashReport(path, { ts: 2000, installId: "a", message: "m2", stack: "", context: {} });
  const reports = await loadCrashReports(path);
  expect(reports.length).toBe(2);
  expect(reports[0].message).toBe("m1");
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implement**

```typescript
import { appendFile, readFile } from "node:fs/promises";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

export interface CrashReport {
  ts: number;
  installId: string;
  message: string;
  stack: string;
  context: Record<string, unknown>;
}

export async function appendCrashReport(path: string, report: CrashReport): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await appendFile(path, JSON.stringify(report) + "\n", { mode: 0o600 });
}

export async function loadCrashReports(path: string): Promise<CrashReport[]> {
  try {
    const raw = await readFile(path, "utf-8");
    return raw.split("\n").filter(Boolean).map((line) => {
      try { return JSON.parse(line) as CrashReport; } catch { return null; }
    }).filter((r): r is CrashReport => r !== null);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(crash-reports): JSONL append-only log (G7.5.D.2)

CrashReport { ts, installId, message, stack, context }. Append-only
con mode 0600 (mismo pattern que audit log G5.H.1). Skip corrupted
lines en load. Pattern reused de durablePrompt-jsonl.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/crash-reports/jsonl.ts tests/core/crash-reports/jsonl.test.ts
```

### Task G7.5.D.3: `redactor.ts` + UI button "Send to Apohara"

**Files:**
- Create: `src/core/crash-reports/redactor.ts` — re-export G5.H.1 secretRedactor + apohara-specific patterns
- Create: `packages/desktop/src/components/SendCrashReportButton.tsx`
- Create: `tests/core/crash-reports/redactor.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { redactCrashReport } from "../../../src/core/crash-reports/redactor";

test("redacts apohara-specific patterns + secrets", () => {
  const dirty = "Error in /home/user/.apohara/install-id with key sk-ant-xxx";
  const clean = redactCrashReport({ ts: 0, installId: "x", message: dirty, stack: "", context: {} });
  expect(clean.message).not.toContain("sk-ant-xxx");
  expect(clean.message).toContain("[REDACTED]");
});
```

- [ ] **Step 2-5: Implement + commit**

```typescript
import { redactSecrets } from "../logging/secretRedactor";
import type { CrashReport } from "./jsonl";

export function redactCrashReport(r: CrashReport): CrashReport {
  return {
    ...r,
    message: redactSecrets(r.message),
    stack: redactSecrets(r.stack),
    context: redactContextValues(r.context),
  };
}

function redactContextValues(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = typeof v === "string" ? redactSecrets(v) : v;
  }
  return out;
}
```

UI component `SendCrashReportButton.tsx` — un button + dialog que muestra payload + confirm + POST a un endpoint apohara.dev (futuro — por ahora open mailto: o GitHub issue link).

```bash
git commit -m "$(cat <<'EOF'
feat(crash-reports): redactor + UI button (G7.5.D.3)

redactCrashReport invoca G5.H.1 secretRedactor sobre message + stack
+ context values. UI button "Send to Apohara" muestra payload
redacted en dialog + confirm. POST endpoint TBD post-launch — por
ahora abre GitHub issue prefilled o mailto.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/crash-reports/redactor.ts packages/desktop/src/components/SendCrashReportButton.tsx tests/core/crash-reports/redactor.test.ts
```

---

## G7.5.E — SKILL.md Apohara como Claude Code skill (0.5 día, 2 tareas)

### Task G7.5.E.1: Crear template SKILL.md

**Files:**
- Create: `templates/skill-apohara/SKILL.md`

- [ ] **Step 1: Write SKILL.md content**

```markdown
---
name: apohara
description: Multi-AI orchestrator. Use Apohara cuando el usuario quiera dispatcha-r una tarea a múltiples CLI agents (Claude Code, Codex, OpenCode) en paralelo, comparar outputs, o orquestar un workflow con verification + commit propose.
---

# Apohara — Multi-AI Orchestrator (CLI Skill)

Apohara Catalyst es un orchestrator local-first instalado en la máquina del usuario. Dispatcha tasks a 3 CLI providers (Claude Code, Codex, OpenCode) en paralelo, recolecta outputs, valida con verification mesh, y propone commits via MCP tool.

## When to invoke Apohara

Invoca `apohara` CLI cuando:
- El user quiere comparar outputs de múltiples AI agents para la misma task
- El user describe un workflow multi-step (decompose → dispatch → verify → commit → PR)
- El user menciona "dispatch to all providers" / "compare with Codex" / "orquesta"
- El user quiere reverse-orchestration (vos sos un agent, querés delegar a otros)

## How to use

```bash
# Single dispatch (3 providers en paralelo)
apohara run "Add JWT auth"

# Decompose + dispatch automatic
apohara decompose --spec SPEC.md
apohara dispatch --all

# Verification + commit
apohara verify
apohara commit --propose
```

## Subagent pattern

Cuando vos (Claude Code) recibís un task del user que beneficia de multi-AI dispatch:

1. Sugerí al user invocar Apohara: "Esta task beneficiaría de comparar con Codex/OpenCode. ¿Querés que invoque Apohara?"
2. Si user confirm: `apohara run "<prompt>"` — output llega al kanban
3. Continúa tu propio trabajo en paralelo
4. Cuando Apohara devuelve, integrá outputs en tu response

## Past incidents

- 2026-05-22 incident: APOHARA_HOOK_TOKEN leaking via sanitizeEnv pattern wrong en OpenCodeProtocol. Fix: sanitize-then-overlay pattern (G5.A.12 implementation). Lesson: cuando wireás Apohara a un nuevo Protocol, verificá que sanitizeEnv corre PRIMERO + opts.env overlay DESPUÉS.

## Capability flags (OFF default)

- `APOHARA_DAEMON_MODE=1` — daemon split (process bg + multi-client)
- `APOHARA_REMOTE_WORKERS=1` — SSH workers en otras máquinas
- `APOHARA_SMART_ROUTER=1` — LLM-as-classifier auto-dispatch
- `APOHARA_REACTIONS=1` — Reaction Engine state machine
- `/yolo` TRIPLE OFF: env APOHARA_YOLO=1 + UI toggle + per-workspace `.apohara/yolo-allowed` non-empty file

## Resources

- Repo: https://github.com/apohara/catalyst
- Docs: https://apohara.dev/catalyst/docs
- PROBANT (verifier): https://apohara.dev/probant
- CONSILIUM (governance OS): https://apohara.dev/consilium
```

- [ ] **Step 2: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(skill): SKILL.md template para Apohara como Claude Code skill (G7.5.E.1)

Reverse-orchestration viral mechanic: user invoca Claude Code,
Claude descubre apohara via skill, dispatcha tasks via apohara
cuando beneficia de multi-AI parallel. SKILL.md describe when/how/
past-incidents + capability flags + resources.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" templates/skill-apohara/SKILL.md
```

### Task G7.5.E.2: Install Apohara skill via existing skills-install pipeline

**Files:**
- Modify: `src/cli/skills-install.ts` — agregar `installApoharaSkill()` convenience function
- Create: `tests/cli/skills-install-apohara.test.ts`

- [ ] **Step 1-5: Wire installSkillCanonical (G5.I.2) con la template Apohara**

```typescript
import { installSkillCanonical } from "./skills-install";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export async function installApoharaSkill(provider: "claude" | "codex" | "opencode"): Promise<string> {
  const templatePath = join(import.meta.dir, "../../templates/skill-apohara/SKILL.md");
  const content = await readFile(templatePath, "utf-8");
  return installSkillCanonical({
    provider,
    name: "apohara",
    content,
  });
}
```

```bash
git commit -m "$(cat <<'EOF'
feat(cli): apohara skills install <provider> wires Apohara SKILL.md (G7.5.E.2)

installApoharaSkill(provider) lee templates/skill-apohara/SKILL.md
+ invoca G5.I.2 installSkillCanonical. CLI subcommand:
  apohara skills install claude
  apohara skills install codex
  apohara skills install opencode
Drops SKILL.md en provider's canonical skills dir (~/.claude/skills/,
~/.codex/skills/, ~/.config/opencode/skills/).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/cli/skills-install.ts tests/cli/skills-install-apohara.test.ts
```

---

## Cierre Sprint 7.5

### Verificación final

- [ ] **Final 1: Suite gateada verde**

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/ tests/cli/`
Expected: ~1210 pass / 0 fail (delta -50 legacy borrado + +20 nuevos primitives/crash-reports/skill tests)

- [ ] **Final 2: TS typecheck 0 errors**

Run: `bunx tsc --noEmit 2>&1 | tail -5`
Expected: **empty output** (los 3 pre-existing fixed)

- [ ] **Final 3: Rust tests OOM-safe**

Run per touched crate: `cargo test -p apohara-coordinator --lib`, `cargo test -p apohara-hooks-server --lib`, `cargo test -p apohara-anti-thrash --lib`, `cargo test -p apohara-sandbox --lib`, `cargo test -p apohara-pathsafety --lib`
Expected: cada uno PASS

- [ ] **Final 4: Skill install smoke**

```bash
bun run cli skills install claude
ls ~/.claude/skills/apohara/SKILL.md
```
Expected: file exists.

- [ ] **Final 5: Crash report smoke**

```bash
# Forzar crash en dev y verificar JSONL creado
APOHARA_FORCE_CRASH=1 bun run dev
cat ~/.apohara/crash-reports.jsonl
```
Expected: JSONL line con el crash redacted.

- [ ] **Final 6: Verificar no archivos huérfanos**

```bash
grep -rln "import.*agent-router\|import.*capability-manifest\|import.*config/validation\|import.*subagent-manager\|import.*providers/router" src/ packages/ tests/
```
Expected: empty.

### Sprint 7.5 cierre commit

```bash
git commit --allow-empty -m "$(cat <<'EOF'
chore(sprint): Sprint 7.5 Cleanup pass COMPLETE

Resumen:
- G7.5.A: 10 wirings de standalone primitives (Sprint 5-6 → producción)
- G7.5.B: 3 TS errors pre-existing fixed (0 errors total)
- G7.5.C: 5 archivos legacy v1 borrados (30 fails desaparecen)
- G7.5.D: §0.33 crash reports local-first (installId + JSONL + redactor + UI)
- G7.5.E: SKILL.md Apohara reverse-orchestration mechanic

Tests: 1240 → ~1210 (delta -50 legacy + +20 wiring/crash/skill)
TypeScript: 0 errors (los 3 pre-existing fixed)
Suite gateada verde + Rust crates verde + clippy clean

Next: Sprint 8 sqlite-vec swap + rebrand Catalyst

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Self-Review

### 1. Spec coverage

| Spec §2 modify item | Plan task |
|---|---|
| Wire buildSystemPrompt | G7.5.A.1 ✓ |
| Wire projectToUiCards + projectToSearchRows | G7.5.A.2 ✓ |
| Wire diffPatch/applyPatch SSE | G7.5.A.3 ✓ |
| Wire createPreviewProxy | (no en spec §2 modify table — defer Sprint 9 UI) |
| Wire runReconcilerPasses | G7.5.A.4 ✓ |
| Wire BlockedReason classifier | G7.5.A.5 ✓ |
| Wire continuation/retry/teammate-idle/careful-mode | G7.5.A.6 ✓ |
| Wire hooks G5.C 4 modules | G7.5.A.7 ✓ |
| Wire composeWorktreeEnv | G7.5.A.8 ✓ |
| Wire G5.G safety + protocols 4 modules | G7.5.A.9 ✓ |
| Wire G5.G.3 pathsafety Rust extras | G7.5.A.10 ✓ |
| Fix McpServer.ts:67 TS errors | G7.5.B.1 ✓ |
| Fix watcher.ts onlyFiles | G7.5.B.2 ✓ |
| Delete 5 archivos legacy | G7.5.C.1 ✓ |
| §0.33 crash reports | G7.5.D.1/.2/.3 ✓ |
| SKILL.md Apohara | G7.5.E.1/.2 ✓ |

Coverage: 16/17 (createPreviewProxy queda para Sprint 9 UI rebrand). Documentar.

### 2. Placeholder scan

- ✅ Cero "TBD" / "TODO" / "implement later" en steps de código
- ✅ Tests con código completo en cada step
- ✅ Commands con expected output

### 3. Type consistency

- `BlockedReason` enum usado en G7.5.A.5 + G7.5.A.6 — same shape
- `CrashReport` interface en G7.5.D.2 + G7.5.D.3 — same shape
- `redactSecrets` re-uso de G5.H.1 — consistent
- `installSkillCanonical` re-uso de G5.I.2 — consistent

Sin issues detectados.

---

*Fin del plan Sprint 7.5.*
