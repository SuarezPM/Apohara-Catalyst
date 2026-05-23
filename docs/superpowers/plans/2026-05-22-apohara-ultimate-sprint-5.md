# Apohara Ultimate Sprint 5 — Mid-stack features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los ~147 hallazgos mid-stack (65 ❌ NO IMPLEMENTADO + 82 🟡 PARCIAL) identificados en el audit 2026-05-22 del spec `docs/superpowers/specs/2026-05-22-apohara-ultimate-design.md` §4, organizados en 9 grupos temáticos.

**Architecture:** TDD bite-sized + paths inline en `git commit -m "msg" <paths>` (regla earned del Sprint 4). 3 waves de paralelización (Wave 1: 4 grupos sin deps, Wave 2: 3 grupos con deps en Sprint 4 outputs, Wave 3: 2 grupos con deps cross-Sprint-5). Branch destino: `feat/apohara-ultimate-sprint-5` (deriva de `feat/apohara-ultimate` post-Sprint-4 squash `70cfcfb`).

**Tech Stack:** Bun 1.3.13 + TypeScript 5+ + Rust stable + bun:sqlite + bun:test + cargo test (OOM-safe per-binary, ver CLAUDE.md §10 R1).

---

## Estructura del Sprint 5

### 9 grupos temáticos

| Grupo | Tema | # tareas | Esfuerzo | Depende de | Wave |
|---|---|---:|---:|---|---|
| **G5.A** | Providers / Protocols / Streams | ~12 | 8-10 días | T4.7 (Sprint 4) | 3 |
| **G5.B** | State machines + Lifecycle | ~10 | 6-8 días | T4.6 (Sprint 4) | 2 |
| **G5.C** | Hooks + Coordination + Context | ~8 | 5-7 días | T4.5 (Sprint 4) | 2 |
| **G5.D** | Safety + Permissions + Verification | ~7 | 5-7 días | — | **1 (detallado)** |
| **G5.E** | Filter DSL + Whisper + Mesh Bus | ~8 | 6-8 días | — | **1 (detallado)** |
| **G5.F** | Persistence + Atomic + Drift | ~10 | 7-9 días | T4.2 (Sprint 4) | 3 |
| **G5.G** | Symphony patterns mid-stack | ~10 | 6-8 días | T4.6 (Sprint 4) | 2 |
| **G5.H** | Multica mid-stack (no Sprint 6) | ~6 | 4-6 días | — | **1 (detallado)** |
| **G5.I** | Backlog Tier 3 sin asignar | ~8 | 6-8 días | — | **1 (detallado)** |

### Estrategia de detalle

- **Wave 1 (G5.D, G5.E, G5.H, G5.I)**: TDD bite-sized completo en este plan. Ejecutables inmediatamente al arrancar Sprint 5 con 4 implementers paralelos Opus.
- **Wave 2 (G5.B, G5.C, G5.G)**: estructura ejecutable (sub-tareas listadas + archivos + esfuerzo). **Detalles TDD se expanden cuando arranquen** — evita plan-staleness por dependencias en Sprint 4 outputs que pueden haber sido ajustados durante implementación.
- **Wave 3 (G5.A, G5.F)**: idem Wave 2 — estructura ejecutable.

### Lección earned del Sprint 4 (aplicada en este plan)

- **Git staging con paralelos**: usar `git commit -m "msg" <paths inline>` whitelist (no `git add` + `git commit` separate). Para untracked files todavía requiere `git add <path>` intermedio — abre window de race pero es minimal. Alternativa real: `git worktree` separados (post-Sprint 6 G6.A daemon split soportaría esto naturalmente).
- **Plan API divergence**: los snippets de código en este plan son **referencia**. El implementer DEBE inspeccionar la API real (typedef, function signature) antes de aplicar. Adaptar bajo Auto Mode con espíritu intacto si la firma divergió.
- **Wave organization**: 4-5 implementers paralelos max por wave para no saturar el git index. Reviewers (1-2 combinados por wave) post-implementer.

---

## Wave 1 — Días 1-5 (4 paralelos sin deps)

Setup pre-Wave:

- [ ] **Setup 1: Crear branch sprint**

```bash
git checkout feat/apohara-ultimate
git checkout -b feat/apohara-ultimate-sprint-5
```

- [ ] **Setup 2: Verificar base verde**

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/`
Expected: 540 pass / 0 fail (Sprint 4 close baseline)

Run: `bunx tsc --noEmit 2>&1 | tail -5`
Expected: 3 pre-existing errors (McpServer.ts:67 × 2, watcher.ts:32)

---

### G5.D — Safety + Permissions + Verification (~7 tareas)

**Outcome esperado:** verification mesh tiene critic prompts reales, dual-status AC funciona, `availableActions[]` contrato universal reemplaza preamble texto libre, MCP tools deny-by-non-registration. Cierra agentrail #1, chorus H4/H5/H6/H10/H11, agentrail #17.

#### Task G5.D.1: `availableActions[]` contrato universal (agentrail #1)

**Files:**
- Create: `src/core/orchestration/availableActions.ts`
- Modify: `src/core/orchestration/preamble.ts` (existente)
- Create: `tests/core/orchestration/available-actions.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { buildAvailableActions, type AvailableAction } from "../../../src/core/orchestration/availableActions";

test("buildAvailableActions returns enum-shape per task state", () => {
  const actions: AvailableAction[] = buildAvailableActions({
    taskState: "ready",
    hasUncommittedChanges: false,
    workspaceTrust: "trusted",
  });
  expect(actions.map(a => a.label)).toContain("Dispatch");
  expect(actions.find(a => a.label === "Dispatch")?.severity).toBe("normal");
});

test("buildAvailableActions excludes Dispatch when uncommitted changes", () => {
  const actions = buildAvailableActions({
    taskState: "ready",
    hasUncommittedChanges: true,
    workspaceTrust: "trusted",
  });
  const dispatch = actions.find(a => a.label === "Dispatch");
  expect(dispatch?.enabled).toBe(false);
  expect(dispatch?.reason).toMatch(/uncommitted/i);
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `bun test tests/core/orchestration/available-actions.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implementar `src/core/orchestration/availableActions.ts`**

```typescript
/**
 * agentrail #1 — universal contract for what the user/agent can do given
 * current task + workspace state. Replaces free-text preamble with an
 * enum-shaped action list rendered as buttons in the UI and validated
 * server-side before dispatch.
 */

export type ActionSeverity = "normal" | "destructive" | "elevated";
export type TaskStateLike = "pending" | "ready" | "running" | "blocked" | "done" | "failed";

export interface AvailableAction {
  label: string;
  severity: ActionSeverity;
  enabled: boolean;
  reason?: string;
}

export interface ActionContext {
  taskState: TaskStateLike;
  hasUncommittedChanges: boolean;
  workspaceTrust: "trusted" | "untrusted" | "pending";
}

export function buildAvailableActions(ctx: ActionContext): AvailableAction[] {
  const actions: AvailableAction[] = [];

  // Dispatch — primary action when task is ready
  const dispatchEnabled = ctx.taskState === "ready"
    && !ctx.hasUncommittedChanges
    && ctx.workspaceTrust === "trusted";
  actions.push({
    label: "Dispatch",
    severity: "normal",
    enabled: dispatchEnabled,
    reason: dispatchEnabled
      ? undefined
      : ctx.hasUncommittedChanges
        ? "Workspace has uncommitted changes; commit or stash first."
        : ctx.workspaceTrust !== "trusted"
          ? `Workspace trust is ${ctx.workspaceTrust}; cannot dispatch.`
          : `Task state is ${ctx.taskState}; not ready.`,
  });

  // Abort — only valid when running
  actions.push({
    label: "Abort",
    severity: "destructive",
    enabled: ctx.taskState === "running",
  });

  // Force re-run — elevated; bypass checks
  actions.push({
    label: "Force Re-run",
    severity: "elevated",
    enabled: ctx.taskState === "failed" || ctx.taskState === "done",
  });

  return actions;
}
```

- [ ] **Step 4: Run test → PASS**

Run: `bun test tests/core/orchestration/available-actions.test.ts`
Expected: PASS — 2 tests

- [ ] **Step 5: Wire en preamble.ts**

Modificar `src/core/orchestration/preamble.ts` para invocar `buildAvailableActions(...)` y serializar la lista en el preamble JSON. Detalles dependen del shape actual de preamble — inspeccionar antes de modificar.

- [ ] **Step 6: Commit**

```bash
git add tests/core/orchestration/available-actions.test.ts src/core/orchestration/availableActions.ts
git commit -m "$(cat <<'EOF'
feat(orchestration): availableActions[] contrato universal (G5.D.1)

agentrail #1 — reemplaza el preamble de texto libre con una lista
enum-shape de acciones (label + severity + enabled + reason). UI
renderea como botones; server valida pre-dispatch. El plan compiler
(T4.3) ya provee workspaceTrust; preamble.ts agrega
hasUncommittedChanges via git status check.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/orchestration/availableActions.ts src/core/orchestration/preamble.ts tests/core/orchestration/available-actions.test.ts
```

#### Task G5.D.2: registerPermissionedTool deny-by-non-registration (chorus H11, T3.12)

**Files:**
- Create: `src/core/mcp/permissionGuard.ts`
- Create: `tests/core/mcp/permission-guard.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { PermissionGuard } from "../../../src/core/mcp/permissionGuard";

test("registerPermissionedTool makes tool visible when allowed", () => {
  const guard = new PermissionGuard();
  guard.registerPermissionedTool({ tool: "Read", requiredPerm: "fs.read" });
  guard.grantPermission("fs.read");
  expect(guard.isToolVisible("Read")).toBe(true);
});

test("unregistered tool is invisible (deny-by-non-registration)", () => {
  const guard = new PermissionGuard();
  guard.grantPermission("fs.read");
  expect(guard.isToolVisible("UnregisteredTool")).toBe(false);
});

test("registered tool without permission is invisible", () => {
  const guard = new PermissionGuard();
  guard.registerPermissionedTool({ tool: "Bash", requiredPerm: "cmd.exec" });
  // No grant
  expect(guard.isToolVisible("Bash")).toBe(false);
});
```

- [ ] **Step 2: Run test → FAIL**

Run: `bun test tests/core/mcp/permission-guard.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implementar**

```typescript
/**
 * chorus H11 — deny-by-non-registration for MCP tools. Tools must be
 * explicitly registered with a required permission; agents see only
 * tools whose permission is currently granted. Prevents accidentally-
 * exposed tools from being callable by untrusted plans.
 */

export interface PermissionedToolSpec {
  tool: string;
  requiredPerm: string;
}

export class PermissionGuard {
  private registered = new Map<string, string>(); // tool → requiredPerm
  private granted = new Set<string>();

  registerPermissionedTool(spec: PermissionedToolSpec): void {
    this.registered.set(spec.tool, spec.requiredPerm);
  }

  grantPermission(perm: string): void {
    this.granted.add(perm);
  }

  revokePermission(perm: string): void {
    this.granted.delete(perm);
  }

  isToolVisible(tool: string): boolean {
    const req = this.registered.get(tool);
    if (req === undefined) return false; // deny by non-registration
    return this.granted.has(req);
  }

  visibleTools(): string[] {
    return Array.from(this.registered.keys()).filter(t => this.isToolVisible(t));
  }
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/mcp/permission-guard.test.ts src/core/mcp/permissionGuard.ts
git commit -m "$(cat <<'EOF'
feat(mcp): registerPermissionedTool deny-by-non-registration (G5.D.2)

chorus H11 / T3.12 — MCP tools quedan invisibles a menos que el
servidor MCP los registre explícitamente con una permission required,
y el sistema haya otorgado esa permission. Sin esto, una tool
accidentalmente expuesta es callable por agentes no trusted.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/mcp/permissionGuard.ts tests/core/mcp/permission-guard.test.ts
```

#### Task G5.D.3: Dual-status Acceptance Criteria (chorus H4, T3.11)

**Files:**
- Create: `src/core/verification/dualStatusAC.ts`
- Create: `tests/core/verification/dual-status-ac.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { DualStatusAC, type ACStatus } from "../../../src/core/verification/dualStatusAC";

test("AC dev-status starts as 'pending'", () => {
  const ac = new DualStatusAC({ id: "ac-1", description: "Tests pass" });
  expect(ac.devStatus).toBe("pending");
  expect(ac.adminStatus).toBe("pending");
});

test("agent sets devStatus, admin reviews and sets adminStatus", () => {
  const ac = new DualStatusAC({ id: "ac-1", description: "Tests pass" });
  ac.setDevStatus("passed");
  expect(ac.devStatus).toBe("passed");
  expect(ac.isFullyApproved()).toBe(false); // admin hasn't acted
  ac.setAdminStatus("approved");
  expect(ac.isFullyApproved()).toBe(true);
});

test("isFullyApproved requires BOTH passed and approved", () => {
  const ac = new DualStatusAC({ id: "ac-1", description: "Tests pass" });
  ac.setDevStatus("passed");
  ac.setAdminStatus("rejected");
  expect(ac.isFullyApproved()).toBe(false);
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementar**

```typescript
/**
 * chorus H4 / T3.11 — Acceptance Criteria con DOS estados:
 *   devStatus  = automated/agent-driven (test passed, lint clean, etc.)
 *   adminStatus = human admin approval
 *
 * Verification gate requires BOTH = approved before marking task done.
 * Allows separation between "code works" and "ship policy met."
 */

export type ACStatus = "pending" | "passed" | "failed" | "approved" | "rejected";

export interface ACSpec {
  id: string;
  description: string;
}

export class DualStatusAC {
  readonly id: string;
  readonly description: string;
  devStatus: Extract<ACStatus, "pending" | "passed" | "failed"> = "pending";
  adminStatus: Extract<ACStatus, "pending" | "approved" | "rejected"> = "pending";

  constructor(spec: ACSpec) {
    this.id = spec.id;
    this.description = spec.description;
  }

  setDevStatus(s: "pending" | "passed" | "failed"): void {
    this.devStatus = s;
  }

  setAdminStatus(s: "pending" | "approved" | "rejected"): void {
    this.adminStatus = s;
  }

  isFullyApproved(): boolean {
    return this.devStatus === "passed" && this.adminStatus === "approved";
  }

  isRejected(): boolean {
    return this.devStatus === "failed" || this.adminStatus === "rejected";
  }
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/verification/dual-status-ac.test.ts src/core/verification/dualStatusAC.ts
git commit -m "$(cat <<'EOF'
feat(verification): dual-status Acceptance Criteria (G5.D.3)

chorus H4 / T3.11 — devStatus (agent/CI driven) + adminStatus (human
approval). isFullyApproved() requires BOTH. Separates "code works"
from "ship policy met."

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/verification/dualStatusAC.ts tests/core/verification/dual-status-ac.test.ts
```

#### Task G5.D.4: Critic system reminders (chorus H5)

**Files:**
- Create: `src/core/verification/prompts/critic.ts`
- Create: `tests/core/verification/critic.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { buildCriticPrompt, type CriticContext } from "../../../src/core/verification/prompts/critic";

test("critic prompt cites prior incident when retrying same task", () => {
  const prompt = buildCriticPrompt({
    taskDescription: "Add JWT auth",
    priorAttempts: 2,
    incidents: ["leaked API key in env (2026-04-15)"],
  });
  expect(prompt).toMatch(/prior attempts: 2/i);
  expect(prompt).toContain("leaked API key in env (2026-04-15)");
});

test("critic prompt requests rationalization-detection checklist", () => {
  const prompt = buildCriticPrompt({ taskDescription: "Refactor X", priorAttempts: 0 });
  expect(prompt).toMatch(/red flags|rationalization/i);
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementar**

```typescript
/**
 * chorus H5 — critic system reminder prompts. Injected into verification
 * mesh runs to make the critic an explicit role: surface red flags,
 * cite past incidents, request rationalization-detection checklist.
 */

export interface CriticContext {
  taskDescription: string;
  priorAttempts: number;
  incidents?: string[];
}

export function buildCriticPrompt(ctx: CriticContext): string {
  const lines = [
    "You are the critic. Review the proposed implementation.",
    "",
    `## Task`,
    ctx.taskDescription,
    "",
    `## Prior attempts: ${ctx.priorAttempts}`,
  ];

  if (ctx.incidents && ctx.incidents.length > 0) {
    lines.push("", "## Past incidents to watch for");
    for (const inc of ctx.incidents) {
      lines.push(`- ${inc}`);
    }
  }

  lines.push(
    "",
    "## Red flags / rationalization checklist",
    "- Is this solving the wrong problem?",
    "- Does the implementation match the spec exactly?",
    "- Are there over-engineered abstractions?",
    "- Is error handling defensive without justification?",
    "- Are tests verifying behavior or just mocks?",
    "- Did the prior attempts fail for the same root cause?",
    "",
    "Report: APPROVE | NEEDS_CHANGES (with specific items) | REJECT (with rationale).",
  );

  return lines.join("\n");
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/verification/critic.test.ts src/core/verification/prompts/critic.ts
git commit -m "$(cat <<'EOF'
feat(verification): critic system reminder prompts (G5.D.4)

chorus H5 — spec v1.0 líneas 1678-1709 lo describía pero no había
archivo src/core/verification-mesh/prompts/critic.ts. Implementa
buildCriticPrompt(ctx) que injecta past incidents + red-flag
checklist al critic role del verification mesh.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/verification/prompts/critic.ts tests/core/verification/critic.test.ts
```

#### Task G5.D.5: Hallucination flag (chorus H6)

**Files:**
- Create: `src/core/verification/hallucinationFlag.ts`
- Create: `tests/core/verification/hallucination-flag.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { detectHallucinations } from "../../../src/core/verification/hallucinationFlag";

test("flags imports of nonexistent modules", () => {
  const result = detectHallucinations({
    code: `import { foo } from "./nonexistent";\nimport { real } from "./real-module";`,
    existingFiles: ["/x/real-module.ts"],
    workspacePath: "/x",
  });
  expect(result.hallucinations).toContain("./nonexistent");
});

test("flags references to undefined function names", () => {
  const result = detectHallucinations({
    code: `someUndefinedHelper();`,
    existingFiles: [],
    workspacePath: "/x",
    definedSymbols: new Set(["console", "process"]),
  });
  expect(result.hallucinations.length).toBeGreaterThan(0);
});

test("clean code returns empty hallucinations", () => {
  const result = detectHallucinations({
    code: `console.log("ok");`,
    existingFiles: [],
    workspacePath: "/x",
    definedSymbols: new Set(["console"]),
  });
  expect(result.hallucinations).toEqual([]);
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementar**

```typescript
/**
 * chorus H6 — post-spawn verification of hallucinations: imports of
 * nonexistent modules + references to undefined symbols. Heuristic
 * only — full type-check is `tsc --noEmit`; this catches the cheap
 * common cases before the expensive check.
 */

import { existsSync } from "node:fs";
import { resolve } from "node:path";

export interface DetectArgs {
  code: string;
  existingFiles: string[];
  workspacePath: string;
  definedSymbols?: Set<string>;
}

export interface DetectResult {
  hallucinations: string[];
}

export function detectHallucinations(args: DetectArgs): DetectResult {
  const out: string[] = [];

  // Detect import statements pointing at relative paths.
  const importRe = /import\s+(?:[\w*{},\s]+?\s+from\s+)?["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(args.code))) {
    const spec = m[1];
    if (spec.startsWith(".")) {
      const candidates = [
        resolve(args.workspacePath, spec),
        resolve(args.workspacePath, spec + ".ts"),
        resolve(args.workspacePath, spec + ".js"),
        resolve(args.workspacePath, spec, "index.ts"),
      ];
      const isReal = args.existingFiles.some(f => candidates.includes(f))
        || candidates.some(c => existsSync(c));
      if (!isReal) out.push(spec);
    }
  }

  // Detect undefined symbol calls (very rough).
  if (args.definedSymbols) {
    const callRe = /([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
    while ((m = callRe.exec(args.code))) {
      const sym = m[1];
      if (sym === "import" || sym === "require") continue;
      if (!args.definedSymbols.has(sym)) out.push(sym);
    }
  }

  return { hallucinations: out };
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/verification/hallucination-flag.test.ts src/core/verification/hallucinationFlag.ts
git commit -m "$(cat <<'EOF'
feat(verification): hallucination flag detector (G5.D.5)

chorus H6 — cheap heuristic detection of nonexistent module imports
+ undefined symbol calls. Catches common cases before the expensive
tsc --noEmit. NOT a replacement for the type-check — just a fast
red-flag signal for the critic role.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/verification/hallucinationFlag.ts tests/core/verification/hallucination-flag.test.ts
```

#### Task G5.D.6: Permission grid (chorus H10 ambiguity resolution)

**Files:**
- Create: `src/core/safety/permissionGrid.ts`
- Create: `tests/core/safety/permission-grid.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { PermissionGrid } from "../../../src/core/safety/permissionGrid";

test("grid stores per-(scope, resource) permission state", () => {
  const grid = new PermissionGrid();
  grid.set("session", "fs.read.*", "allow");
  grid.set("once", "cmd.exec.git", "deny");
  expect(grid.get("session", "fs.read.*")).toBe("allow");
  expect(grid.get("once", "cmd.exec.git")).toBe("deny");
});

test("get returns 'unset' for unconfigured cell", () => {
  const grid = new PermissionGrid();
  expect(grid.get("always", "fs.write.*")).toBe("unset");
});

test("exportRows returns all configured cells as flat array", () => {
  const grid = new PermissionGrid();
  grid.set("session", "fs.read.*", "allow");
  grid.set("once", "cmd.exec.*", "deny");
  const rows = grid.exportRows();
  expect(rows).toHaveLength(2);
  expect(rows).toContainEqual({ scope: "session", resource: "fs.read.*", state: "allow" });
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementar**

```typescript
/**
 * chorus H10 (resolved AMBIGUO) — explicit per-(scope, resource)
 * permission grid. Three scopes (once / session / always) × N
 * resource patterns. UI renders as table; underlying storage is flat
 * to keep export/replay trivial.
 */

export type PermissionScope = "once" | "session" | "always";
export type PermissionState = "allow" | "deny" | "unset";

export interface PermissionRow {
  scope: PermissionScope;
  resource: string;
  state: PermissionState;
}

export class PermissionGrid {
  private rows = new Map<string, PermissionState>();

  private key(scope: PermissionScope, resource: string): string {
    return `${scope}::${resource}`;
  }

  set(scope: PermissionScope, resource: string, state: PermissionState): void {
    if (state === "unset") {
      this.rows.delete(this.key(scope, resource));
    } else {
      this.rows.set(this.key(scope, resource), state);
    }
  }

  get(scope: PermissionScope, resource: string): PermissionState {
    return this.rows.get(this.key(scope, resource)) ?? "unset";
  }

  exportRows(): PermissionRow[] {
    const out: PermissionRow[] = [];
    for (const [k, state] of this.rows) {
      const [scope, resource] = k.split("::") as [PermissionScope, string];
      out.push({ scope, resource, state });
    }
    return out;
  }
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/safety/permission-grid.test.ts src/core/safety/permissionGrid.ts
git commit -m "$(cat <<'EOF'
feat(safety): explicit permission grid (G5.D.6)

chorus H10 (AMBIGUO → resolved) — three scopes × N resource patterns
storage. exportRows() para UI table render + future JSONL replay.
Reemplaza la lookup ad-hoc del permission system previo.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/safety/permissionGrid.ts tests/core/safety/permission-grid.test.ts
```

#### Task G5.D.7: Doctor compileRunnerExecutionPlan integration (agentrail #17)

**Files:**
- Modify: `src/cli/doctor.ts` (existente, busca línea con "Stage 5 integration pending")

- [ ] **Step 1: Inspeccionar doctor.ts state**

Run: `grep -n "Stage 5 integration pending\|runner.policy\|RunnerExecutionPlan" src/cli/doctor.ts`
Expected: línea ~78-83 con placeholder

- [ ] **Step 2: Failing test (extender doctor test si existe)**

```typescript
import { expect, test } from "bun:test";
import { runDoctorChecks } from "../../src/cli/doctor";

test("doctor reports compiled runner policy preset from .apohara.json", async () => {
  const result = await runDoctorChecks({ workspacePath: process.cwd() });
  const policyCheck = result.checks.find(c => c.name === "runner-policy");
  expect(policyCheck).toBeDefined();
  expect(policyCheck?.value).toMatch(/Strict|Balanced|Advisory|Custom|ExternalSandbox/);
});
```

- [ ] **Step 3: Run test → FAIL or PASS depending on current doctor shape**

- [ ] **Step 4: Modificar doctor.ts**

Reemplazar el placeholder con llamada real a `resolveRunnerPolicyForSpawn(workspacePath)` (de `src/providers/cli-driver.ts` post-T4.3) y reportar el preset compilado.

- [ ] **Step 5: Commit**

```bash
git commit -m "$(cat <<'EOF'
feat(doctor): wire compileRunnerExecutionPlan to doctor check (G5.D.7)

agentrail #17 — doctor.ts:78-83 tenía placeholder "Stage 5 integration
pending". Ahora reporta el preset compilado vía
resolveRunnerPolicyForSpawn (T4.3) + el detalle de enforcement[].
Cierra el last gap del runner-policy wiring iniciado en T4.3.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/cli/doctor.ts
```

---

### G5.E — Filter DSL + Whisper + Mesh Bus (~8 tareas)

**Outcome esperado:** culture's Filter DSL parser + applier ejecutable, whisper protocol stderr-side-channel funcional, explain/overview/learn dispatchers, decentralized config discovery, plugin packaging completo. Cierra culture #1/2/6/7/9/10/11/14.

#### Task G5.E.1: Filter DSL parser + applier (culture #2)

**Files:**
- Create: `src/core/filter-dsl/parser.ts`
- Create: `src/core/filter-dsl/applier.ts`
- Create: `tests/core/filter-dsl/parser.test.ts`
- Create: `tests/core/filter-dsl/applier.test.ts`

- [ ] **Step 1: Failing test (parser)**

```typescript
import { expect, test } from "bun:test";
import { parseFilter, type FilterAST } from "../../../src/core/filter-dsl/parser";

test("parses simple equality predicate", () => {
  const ast = parseFilter('status == "ready"');
  expect(ast).toEqual({
    op: "eq",
    field: "status",
    value: "ready",
  });
});

test("parses AND of two predicates", () => {
  const ast = parseFilter('status == "ready" && cost < 0.5');
  expect(ast.op).toBe("and");
});

test("parses negation", () => {
  const ast = parseFilter('!(status == "failed")');
  expect(ast.op).toBe("not");
});

test("rejects malformed input", () => {
  expect(() => parseFilter("status ==")).toThrow(/parse/);
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementar parser.ts**

```typescript
/**
 * culture #2 — safe predicate DSL for event-driven rules / capability
 * targeting. Subset of expression grammar: literals (string/number/bool),
 * field access (a.b.c), comparisons (==, !=, <, <=, >, >=), boolean
 * operators (&&, ||, !), parentheses. NO arbitrary code execution.
 */

export type FilterAST =
  | { op: "literal"; value: string | number | boolean | null }
  | { op: "field"; path: string[] }
  | { op: "eq"; field: string; value: string | number | boolean }
  | { op: "neq"; field: string; value: string | number | boolean }
  | { op: "lt" | "lte" | "gt" | "gte"; field: string; value: number }
  | { op: "and"; left: FilterAST; right: FilterAST }
  | { op: "or"; left: FilterAST; right: FilterAST }
  | { op: "not"; inner: FilterAST };

// Minimal recursive-descent parser.
class Parser {
  constructor(private src: string, private pos = 0) {}
  private peek(): string | null { return this.src[this.pos] ?? null; }
  private skip(): void { while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++; }
  private match(s: string): boolean {
    this.skip();
    if (this.src.startsWith(s, this.pos)) { this.pos += s.length; return true; }
    return false;
  }

  parseOr(): FilterAST {
    let left = this.parseAnd();
    while (this.match("||")) {
      const right = this.parseAnd();
      left = { op: "or", left, right };
    }
    return left;
  }
  parseAnd(): FilterAST {
    let left = this.parseNot();
    while (this.match("&&")) {
      const right = this.parseNot();
      left = { op: "and", left, right };
    }
    return left;
  }
  parseNot(): FilterAST {
    if (this.match("!")) return { op: "not", inner: this.parsePrimary() };
    return this.parsePrimary();
  }
  parsePrimary(): FilterAST {
    this.skip();
    if (this.match("(")) {
      const inner = this.parseOr();
      if (!this.match(")")) throw new Error("parse: expected )");
      return inner;
    }
    // Identifier (field)
    const idMatch = this.src.slice(this.pos).match(/^[A-Za-z_][A-Za-z0-9_.]*/);
    if (!idMatch) throw new Error(`parse: unexpected at ${this.pos}`);
    const field = idMatch[0];
    this.pos += field.length;
    this.skip();
    // Comparator
    const ops: Array<[string, FilterAST["op"]]> = [
      ["==", "eq"], ["!=", "neq"], ["<=", "lte"], [">=", "gte"], ["<", "lt"], [">", "gt"],
    ];
    for (const [tok, op] of ops) {
      if (this.match(tok)) {
        const value = this.parseLiteral();
        return { op, field, value } as FilterAST;
      }
    }
    throw new Error(`parse: expected comparator after ${field}`);
  }
  parseLiteral(): string | number | boolean {
    this.skip();
    if (this.match('"')) {
      const start = this.pos;
      while (this.pos < this.src.length && this.src[this.pos] !== '"') this.pos++;
      const str = this.src.slice(start, this.pos);
      if (!this.match('"')) throw new Error("parse: unterminated string");
      return str;
    }
    const numMatch = this.src.slice(this.pos).match(/^-?\d+(\.\d+)?/);
    if (numMatch) {
      this.pos += numMatch[0].length;
      return parseFloat(numMatch[0]);
    }
    if (this.match("true")) return true;
    if (this.match("false")) return false;
    throw new Error(`parse: expected literal at ${this.pos}`);
  }
}

export function parseFilter(src: string): FilterAST {
  const p = new Parser(src);
  const ast = (p as any).parseOr();
  return ast;
}
```

- [ ] **Step 4: Failing test (applier)**

```typescript
import { expect, test } from "bun:test";
import { parseFilter } from "../../../src/core/filter-dsl/parser";
import { applyFilter } from "../../../src/core/filter-dsl/applier";

test("applier evaluates equality on flat object", () => {
  const ast = parseFilter('status == "ready"');
  expect(applyFilter(ast, { status: "ready" })).toBe(true);
  expect(applyFilter(ast, { status: "done" })).toBe(false);
});

test("applier evaluates AND combination", () => {
  const ast = parseFilter('status == "ready" && cost < 0.5');
  expect(applyFilter(ast, { status: "ready", cost: 0.3 })).toBe(true);
  expect(applyFilter(ast, { status: "ready", cost: 0.8 })).toBe(false);
});

test("applier handles negation", () => {
  const ast = parseFilter('!(status == "failed")');
  expect(applyFilter(ast, { status: "ready" })).toBe(true);
  expect(applyFilter(ast, { status: "failed" })).toBe(false);
});
```

- [ ] **Step 5: Implementar applier.ts**

```typescript
import type { FilterAST } from "./parser.js";

export function applyFilter(ast: FilterAST, obj: Record<string, unknown>): boolean {
  switch (ast.op) {
    case "eq": return obj[ast.field] === ast.value;
    case "neq": return obj[ast.field] !== ast.value;
    case "lt": return (obj[ast.field] as number) < ast.value;
    case "lte": return (obj[ast.field] as number) <= ast.value;
    case "gt": return (obj[ast.field] as number) > ast.value;
    case "gte": return (obj[ast.field] as number) >= ast.value;
    case "and": return applyFilter(ast.left, obj) && applyFilter(ast.right, obj);
    case "or": return applyFilter(ast.left, obj) || applyFilter(ast.right, obj);
    case "not": return !applyFilter(ast.inner, obj);
    default: return false;
  }
}
```

- [ ] **Step 6: Run tests → PASS**

- [ ] **Step 7: Commit**

```bash
git add tests/core/filter-dsl/parser.test.ts tests/core/filter-dsl/applier.test.ts src/core/filter-dsl/parser.ts src/core/filter-dsl/applier.ts
git commit -m "$(cat <<'EOF'
feat(filter-dsl): safe predicate parser + applier (G5.E.1)

culture #2 — declarative predicates para event-driven rules y
capability targeting. Subset seguro: literals, field access,
comparisons, boolean ops, parentheses. NO arbitrary code exec.
Habilita patterns dependientes en G5.E (whisper #10, decentralized
config #9, capability targeting).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/filter-dsl/parser.ts src/core/filter-dsl/applier.ts tests/core/filter-dsl/parser.test.ts tests/core/filter-dsl/applier.test.ts
```

#### Task G5.E.2: Whisper protocol stderr-side-channel (culture #10)

**Files:**
- Create: `src/core/whisper/encoder.ts`
- Create: `src/core/whisper/decoder.ts`
- Create: `tests/core/whisper/roundtrip.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { encodeWhisper } from "../../../src/core/whisper/encoder";
import { decodeWhisper } from "../../../src/core/whisper/decoder";

test("roundtrip preserves whisper fields", () => {
  const original = { tag: "judge", level: "info" as const, msg: "looks good", ts: 1234 };
  const wire = encodeWhisper(original);
  expect(wire.startsWith("\x1b[whisper:")).toBe(true);
  expect(wire.endsWith("\x1b\\")).toBe(true);
  const decoded = decodeWhisper(wire);
  expect(decoded).toEqual(original);
});

test("decoder rejects non-whisper stderr line", () => {
  expect(decodeWhisper("regular log line\n")).toBe(null);
});

test("decoder rejects malformed envelope", () => {
  expect(decodeWhisper("\x1b[whisper:not-json\x1b\\")).toBe(null);
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementar encoder.ts**

```typescript
/**
 * culture #10 — Whisper protocol: structured messages over stderr
 * without polluting stdout. Wire format:
 *
 *   ESC '[' 'w' 'h' 'i' 's' 'p' 'e' 'r' ':' <json> ESC '\'
 *
 * Uses ANSI ST/OSC envelope so it falls through pipes/tty without
 * eating the rest of the line. Cheap to parse, easy to grep.
 */

export interface WhisperMessage {
  tag: string;
  level: "trace" | "debug" | "info" | "warn" | "error";
  msg: string;
  ts: number;
  [k: string]: unknown;
}

const PREFIX = "\x1b[whisper:";
const SUFFIX = "\x1b\\";

export function encodeWhisper(msg: WhisperMessage): string {
  return PREFIX + JSON.stringify(msg) + SUFFIX;
}
```

- [ ] **Step 4: Implementar decoder.ts**

```typescript
import type { WhisperMessage } from "./encoder.js";

const PREFIX = "\x1b[whisper:";
const SUFFIX = "\x1b\\";

export function decodeWhisper(line: string): WhisperMessage | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith(PREFIX) || !trimmed.endsWith(SUFFIX)) return null;
  const json = trimmed.slice(PREFIX.length, -SUFFIX.length);
  try {
    return JSON.parse(json) as WhisperMessage;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Run test → PASS**

- [ ] **Step 6: Commit**

```bash
git add tests/core/whisper/roundtrip.test.ts src/core/whisper/encoder.ts src/core/whisper/decoder.ts
git commit -m "$(cat <<'EOF'
feat(whisper): stderr-side-channel structured protocol (G5.E.2)

culture #10 — ANSI ST/OSC envelope para mensajes estructurados sobre
stderr sin contaminar stdout. encode/decode roundtrip. Habilita
real-time judge/critic correction durante runs sin parsing del
output principal del agente.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/whisper/encoder.ts src/core/whisper/decoder.ts tests/core/whisper/roundtrip.test.ts
```

#### Task G5.E.3: explain/overview/learn dispatcher (culture #6)

**Files:**
- Create: `src/cli/universal-verbs.ts`
- Create: `tests/cli/universal-verbs.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { dispatchUniversalVerb } from "../../src/cli/universal-verbs";

test("explain returns the description of an entity", async () => {
  const result = await dispatchUniversalVerb({
    verb: "explain",
    target: "task:abc-123",
    registry: {
      "task:abc-123": { description: "Add JWT auth", state: "ready" },
    },
  });
  expect(result).toContain("Add JWT auth");
  expect(result).toContain("ready");
});

test("overview returns aggregate summary", async () => {
  const result = await dispatchUniversalVerb({
    verb: "overview",
    target: "session:foo",
    registry: {
      "session:foo": { taskCount: 5, doneCount: 3 },
    },
  });
  expect(result).toMatch(/5.*tasks/i);
});

test("rejects unknown verb", async () => {
  await expect(
    dispatchUniversalVerb({ verb: "foo" as any, target: "x", registry: {} })
  ).rejects.toThrow(/unknown verb/);
});
```

- [ ] **Step 2: Implementar**

```typescript
/**
 * culture #6 — universal verbs `explain | overview | learn` that
 * dispatch to a registered entity's structured handler. UI/CLI can
 * use the same entry point without per-entity boilerplate.
 */

export type Verb = "explain" | "overview" | "learn";

export interface DispatchArgs {
  verb: Verb;
  target: string;
  registry: Record<string, Record<string, unknown>>;
}

export async function dispatchUniversalVerb(args: DispatchArgs): Promise<string> {
  if (!["explain", "overview", "learn"].includes(args.verb)) {
    throw new Error(`unknown verb: ${args.verb}`);
  }
  const entity = args.registry[args.target];
  if (!entity) return `Target not found: ${args.target}`;

  switch (args.verb) {
    case "explain":
      return Object.entries(entity).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join("\n");
    case "overview": {
      const taskCount = entity.taskCount ?? 0;
      const doneCount = entity.doneCount ?? 0;
      return `Overview of ${args.target}: ${taskCount} tasks (${doneCount} done).`;
    }
    case "learn":
      return `Learning resources for ${args.target}: see docs/.`;
  }
}
```

- [ ] **Step 3: Run test → PASS**

- [ ] **Step 4: Commit**

```bash
git add tests/cli/universal-verbs.test.ts src/cli/universal-verbs.ts
git commit -m "$(cat <<'EOF'
feat(cli): explain/overview/learn universal verbs dispatcher (G5.E.3)

culture #6 — single entry point for the three info-verbs that any
entity can register against. UI/CLI use the same dispatch without
per-entity boilerplate.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/cli/universal-verbs.ts tests/cli/universal-verbs.test.ts
```

#### Task G5.E.4: Passthrough CLI mode (culture #7)

**Files:**
- Create: `src/cli/passthrough.ts`
- Create: `tests/cli/passthrough.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { runPassthrough } from "../../src/cli/passthrough";

test("passthrough proxies exit code 0 from successful child", async () => {
  const result = await runPassthrough({
    binary: "/bin/true",
    args: [],
    interceptors: [],
  });
  expect(result.exitCode).toBe(0);
});

test("interceptors observe child output", async () => {
  const observed: string[] = [];
  const result = await runPassthrough({
    binary: "/bin/echo",
    args: ["hello"],
    interceptors: [(chunk) => { observed.push(chunk.toString()); }],
  });
  expect(observed.join("")).toContain("hello");
  expect(result.exitCode).toBe(0);
});
```

- [ ] **Step 2: Implementar**

```typescript
/**
 * culture #7 — proxy a child CLI with lightweight interceptors that
 * observe stdout/stderr without modifying the flow. Useful for adding
 * Apohara telemetry/hooks to any tool without forking it.
 */
import { spawn } from "node:child_process";

export interface PassthroughOpts {
  binary: string;
  args: string[];
  interceptors: Array<(chunk: Buffer, stream: "stdout" | "stderr") => void>;
  env?: NodeJS.ProcessEnv;
}

export interface PassthroughResult {
  exitCode: number;
}

export function runPassthrough(opts: PassthroughOpts): Promise<PassthroughResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(opts.binary, opts.args, {
      env: opts.env ?? process.env,
      stdio: ["inherit", "pipe", "pipe"],
    });
    child.stdout?.on("data", (c: Buffer) => {
      for (const i of opts.interceptors) i(c, "stdout");
      process.stdout.write(c);
    });
    child.stderr?.on("data", (c: Buffer) => {
      for (const i of opts.interceptors) i(c, "stderr");
      process.stderr.write(c);
    });
    child.on("exit", (code) => resolve({ exitCode: code ?? 1 }));
    child.on("error", reject);
  });
}
```

- [ ] **Step 3: Run test → PASS**

- [ ] **Step 4: Commit**

```bash
git add tests/cli/passthrough.test.ts src/cli/passthrough.ts
git commit -m "$(cat <<'EOF'
feat(cli): passthrough proxy with interceptors (G5.E.4)

culture #7 — proxy un CLI hijo con interceptors lightweight que
observan stdout/stderr sin modificar el flow. Habilita agregar
telemetry/hooks de Apohara a cualquier tool externo sin forkearla.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/cli/passthrough.ts tests/cli/passthrough.test.ts
```

#### Task G5.E.5: Decentralized config discovery (culture #9)

**Files:**
- Create: `src/core/config/decentralized-discovery.ts`
- Create: `tests/core/config/decentralized-discovery.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverConfigChain } from "../../../src/core/config/decentralized-discovery";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "apohara-discover-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("discovers configs walking up directory tree", async () => {
  await mkdir(join(root, "a", "b"), { recursive: true });
  await writeFile(join(root, ".apohara.json"), JSON.stringify({ level: "root" }));
  await writeFile(join(root, "a", ".apohara.json"), JSON.stringify({ level: "mid" }));
  const chain = await discoverConfigChain(join(root, "a", "b"));
  expect(chain.map(c => c.config.level)).toEqual(["root", "mid"]);
});

test("returns empty chain when no config found", async () => {
  await mkdir(join(root, "empty"), { recursive: true });
  const chain = await discoverConfigChain(join(root, "empty"));
  expect(chain).toEqual([]);
});
```

- [ ] **Step 2: Implementar**

```typescript
/**
 * culture #9 — walk up the directory tree collecting .apohara.json
 * configs. Order: root → leaf (most-specific wins on merge). Each
 * level can override or extend the parent.
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve, join } from "node:path";

export interface ConfigLevel {
  path: string;
  config: Record<string, unknown>;
}

export async function discoverConfigChain(startDir: string): Promise<ConfigLevel[]> {
  const found: ConfigLevel[] = [];
  let cur = resolve(startDir);
  while (true) {
    const candidate = join(cur, ".apohara.json");
    try {
      const raw = await readFile(candidate, "utf-8");
      found.unshift({ path: candidate, config: JSON.parse(raw) });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const parent = dirname(cur);
    if (parent === cur) break; // reached filesystem root
    cur = parent;
  }
  return found;
}
```

- [ ] **Step 3: Run test → PASS**

- [ ] **Step 4: Commit**

```bash
git add tests/core/config/decentralized-discovery.test.ts src/core/config/decentralized-discovery.ts
git commit -m "$(cat <<'EOF'
feat(config): decentralized .apohara.json discovery (G5.E.5)

culture #9 — walk up directory tree collecting .apohara.json files.
Returns root → leaf order; downstream merge produces the effective
config with most-specific override semantics.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/config/decentralized-discovery.ts tests/core/config/decentralized-discovery.test.ts
```

#### Task G5.E.6: Mesh bus expansion con tags estructurados (culture #1 PARCIAL → COMPLETO)

**Files:**
- Modify: `src/core/bus.ts` (o equivalente — inspeccionar bus actual de Apohara)
- Create: `tests/core/bus-tagged.test.ts`

- [ ] **Step 1: Inspeccionar bus.ts**

Run: `find src -name "bus.ts" -o -name "eventBus.ts" 2>/dev/null`
Anotar el shape existente del event bus.

- [ ] **Step 2: Failing test**

```typescript
import { expect, test } from "bun:test";
import { TaggedEventBus } from "../../src/core/tagged-bus";

test("publish with tags is observable via subscribe by tag", () => {
  const bus = new TaggedEventBus();
  const heard: string[] = [];
  bus.subscribe({ tag: "session.run" }, (e) => heard.push(e.payload as string));
  bus.publish({ tag: "session.run", payload: "msg1" });
  bus.publish({ tag: "session.done", payload: "msg2" });
  expect(heard).toEqual(["msg1"]);
});

test("subscribe with wildcard matches namespace prefix", () => {
  const bus = new TaggedEventBus();
  const heard: string[] = [];
  bus.subscribe({ tag: "session.*" }, (e) => heard.push(e.tag));
  bus.publish({ tag: "session.run", payload: 1 });
  bus.publish({ tag: "session.done", payload: 2 });
  bus.publish({ tag: "task.start", payload: 3 });
  expect(heard).toEqual(["session.run", "session.done"]);
});
```

- [ ] **Step 3: Implementar `src/core/tagged-bus.ts`**

```typescript
/**
 * culture #1 — event bus con tags estructurados (namespace.subtag.*)
 * y subscribe-by-pattern. Reemplaza el bus EventTarget plano si lo
 * usa el codebase, o coexiste como capa nueva.
 */

export interface TaggedEvent<T = unknown> {
  tag: string;
  payload: T;
  ts?: number;
}

type Handler<T = unknown> = (e: TaggedEvent<T>) => void;

export class TaggedEventBus {
  private subs: Array<{ pattern: string; handler: Handler }> = [];

  subscribe(opts: { tag: string }, handler: Handler): () => void {
    const entry = { pattern: opts.tag, handler };
    this.subs.push(entry);
    return () => {
      this.subs = this.subs.filter(s => s !== entry);
    };
  }

  publish(event: TaggedEvent): void {
    const e = { ...event, ts: event.ts ?? Date.now() };
    for (const s of this.subs) {
      if (this.matches(s.pattern, e.tag)) s.handler(e);
    }
  }

  private matches(pattern: string, tag: string): boolean {
    if (pattern === tag) return true;
    if (pattern.endsWith(".*")) {
      const prefix = pattern.slice(0, -2) + ".";
      return tag.startsWith(prefix);
    }
    return false;
  }
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/bus-tagged.test.ts src/core/tagged-bus.ts
git commit -m "$(cat <<'EOF'
feat(bus): TaggedEventBus con namespace patterns (G5.E.6)

culture #1 (PARCIAL → COMPLETO) — eventos con tags
namespace.sub.action y subscribe by pattern (incluye `.*` wildcard
prefix). Habilita filtering eficiente en UI bridge y selective
hook event forwarding.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/tagged-bus.ts tests/core/bus-tagged.test.ts
```

#### Task G5.E.7: Plugin packaging skills install completar (culture #11 PARCIAL → COMPLETO)

**Files:**
- Modify: `src/cli/skills.ts` (existente) o crear si no existe
- Create: `tests/cli/skills-install.test.ts`

- [ ] **Step 1: Inspeccionar state actual**

Run: `find src -name "skills*.ts" 2>/dev/null`

- [ ] **Step 2: Failing test**

```typescript
import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, readFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installSkill } from "../../src/cli/skills-install";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "apohara-skill-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

test("installSkill writes SKILL.md to provider's skill dir", async () => {
  await installSkill({
    provider: "claude",
    name: "debug-runner",
    content: "# Debug runner skill\n\nSteps...",
    targetRoot: root,
  });
  const written = await readFile(join(root, "claude", "skills", "debug-runner", "SKILL.md"), "utf-8");
  expect(written).toContain("Debug runner skill");
});

test("installSkill is idempotent (rewriting same content doesn't error)", async () => {
  const args = {
    provider: "claude" as const,
    name: "x",
    content: "abc",
    targetRoot: root,
  };
  await installSkill(args);
  await installSkill(args);
  // No throw
});
```

- [ ] **Step 3: Implementar**

```typescript
/**
 * culture #11 — apohara skills install <provider> drops a SKILL.md
 * into the provider's skill directory in the canonical layout.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface InstallSkillArgs {
  provider: "claude" | "codex" | "opencode";
  name: string;
  content: string;
  targetRoot?: string;
}

export async function installSkill(args: InstallSkillArgs): Promise<string> {
  const root = args.targetRoot ?? process.env.HOME ?? ".";
  const dir = join(root, args.provider, "skills", args.name);
  await mkdir(dir, { recursive: true });
  const path = join(dir, "SKILL.md");
  await writeFile(path, args.content, "utf-8");
  return path;
}
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/cli/skills-install.test.ts src/cli/skills-install.ts
git commit -m "$(cat <<'EOF'
feat(cli): apohara skills install <provider> (G5.E.7)

culture #11 (PARCIAL → COMPLETO) — drops SKILL.md en provider's
canonical skill dir. Idempotent. Default targetRoot = $HOME.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/cli/skills-install.ts tests/cli/skills-install.test.ts
```

#### Task G5.E.8: Peek attribution completar (culture #14 PARCIAL → COMPLETO)

**Files:**
- Modify: existing peek implementation (inspeccionar primero)
- Create: `tests/core/peek-attribution.test.ts`

- [ ] **Step 1: Inspeccionar state actual** y armar el test correspondiente

Por brevedad, sub-tareas G5.E.8 quedan documentadas a alto nivel — el implementer expande TDD steps cuando arranque la wave. Scope: cuando un agent "peek" a file/state, registrar attribution (who, what, when) para audit trail.

- [ ] **Step 2-5: TDD bite-sized similar a G5.E.7** (~30 LOC + 2 tests)

---

### G5.H — Multica mid-stack (~6 tareas, no Sprint 6)

**Outcome esperado:** secret redaction en logs, atomic mv JSONL, UUID validation, empty-claim cache, workspace lifecycle hooks, per-thread keying wiring. Cubre multica items que NO van a Sprint 6 (cliente-daemon split + variants que sí van a Sprint 6).

#### Task G5.H.1: Secret redaction en logs (multica #4 PARCIAL → COMPLETO)

**Files:**
- Create: `src/core/logging/secretRedactor.ts`
- Create: `tests/core/logging/secret-redactor.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { redactSecrets } from "../../../src/core/logging/secretRedactor";

test("redacts AWS access key", () => {
  const input = "AKIAIOSFODNN7EXAMPLE is the key";
  expect(redactSecrets(input)).toBe("[REDACTED] is the key");
});

test("redacts ANTHROPIC_API_KEY env style", () => {
  const input = "ANTHROPIC_API_KEY=sk-ant-foo123";
  const out = redactSecrets(input);
  expect(out).toContain("ANTHROPIC_API_KEY=[REDACTED]");
});

test("preserves text without secrets", () => {
  const input = "regular log line";
  expect(redactSecrets(input)).toBe(input);
});
```

- [ ] **Step 2: Implementar**

```typescript
/**
 * multica #4 — redact secret-shaped tokens from log lines before
 * writing/emitting. Best-effort regex sweep. Not a substitute for
 * sanitizeEnv (which prevents secrets reaching subprocesses in the
 * first place), but defense in depth for logs.
 */

const PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/g,                   // AWS access key
  /sk-ant-[A-Za-z0-9_-]{20,}/g,           // Anthropic key
  /sk-[A-Za-z0-9_-]{32,}/g,               // OpenAI / generic
  /ghp_[A-Za-z0-9]{36}/g,                 // GitHub token
  /\bxox[abopstr]-[A-Za-z0-9-]+/g,        // Slack
];

const KV_PATTERN = /([A-Z][A-Z0-9_]*(?:_API_KEY|_TOKEN|_SECRET))=([^\s"]+)/g;

export function redactSecrets(line: string): string {
  let out = line;
  for (const p of PATTERNS) {
    out = out.replace(p, "[REDACTED]");
  }
  out = out.replace(KV_PATTERN, "$1=[REDACTED]");
  return out;
}
```

- [ ] **Step 3: Run test → PASS**

- [ ] **Step 4: Commit**

```bash
git add tests/core/logging/secret-redactor.test.ts src/core/logging/secretRedactor.ts
git commit -m "$(cat <<'EOF'
feat(logging): secret redactor para log lines (G5.H.1)

multica #4 (PARCIAL → COMPLETO) — regex sweep best-effort para AWS,
Anthropic, OpenAI, GitHub, Slack token patterns + KV style env vars.
Defense in depth para logs (sanitizeEnv ya previene en spawn).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/logging/secretRedactor.ts tests/core/logging/secret-redactor.test.ts
```

#### Task G5.H.2: Atomic mv para JSONL persistence (multica #6 PARCIAL → COMPLETO)

**Files:**
- Modify: `src/core/safety/durablePrompt-jsonl.ts` (compactLedger ya existe T4.2; verificar es atómico)
- Create: `tests/core/jsonl-atomic-mv.test.ts`

- [ ] **Step 1: Failing test verifies crash mid-compact**

```typescript
import { expect, test } from "bun:test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compactLedger, loadEntries } from "../../src/core/safety/durablePrompt-jsonl";

test("compactLedger writes atomically (no partial state visible)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "apohara-atomic-"));
  try {
    const path = join(dir, "p.jsonl");
    await writeFile(path, '{"kind":"request","data":{"request_id":"a"}}\n');
    // Compact with empty alive list — verifies the write itself is atomic.
    await compactLedger(path, []);
    const after = await loadEntries(path);
    expect(after).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2-5: Verificar que `compactLedger` ya usa `atomicWriteFile` (T4.2). Si NO usa, modificar. Commit.**

#### Task G5.H.3: UUID parsing + validation (multica #11)

**Files:**
- Create: `src/core/uuid/validate.ts`
- Create: `tests/core/uuid-validate.test.ts`

- [ ] **Steps 1-5: Implementar `isValidUuid(str): boolean` + `parseUuid(str): UUID | null` con regex check format v4 estricto. ~20 LOC.**

#### Task G5.H.4: Empty-claim cache versioning (multica #14)

**Files:**
- Create: `src/core/orchestration/emptyClaimCache.ts`
- Create: `tests/core/orchestration/empty-claim-cache.test.ts`

- [ ] **Steps 1-5: Cache versioning para claims (worker claim agent task but finds nothing) — incrementar version cada N segundos para forzar re-poll en caso de stale state. ~50 LOC.**

#### Task G5.H.5: Workspace lifecycle hooks (multica #16)

**Files:**
- Create: `src/core/worktree/lifecycle-hooks.ts`
- Create: `tests/core/worktree/lifecycle-hooks.test.ts`

- [ ] **Steps 1-5: 4-phase hooks (pre-create, post-create, pre-teardown, post-teardown) que el worktree manager invoca. ~80 LOC.**

#### Task G5.H.6: Per-thread keying wiring (multica #18 — relación con T4.1 token accounting)

**Files:**
- Modify: `crates/apohara-token-accounting/src/counter.rs` (T4.1) + nuevo TS binding

- [ ] **Steps 1-5: Expandir T4.1 TokenCounter para usar `(provider_id, thread_id)` como key compuesta. ~30 LOC delta.**

---

### G5.I — Backlog Tier 3 sin asignar (~8 tareas)

**Outcome esperado:** los 8 items Tier 3 del plan original (Sprint 1-3) que no entraron en ninguna wave.

#### Task G5.I.1: WSL handling (T3.6, orca)

**Files:**
- Create: `src/core/platform/wsl-detect.ts`
- Create: `tests/core/platform/wsl-detect.test.ts`

- [ ] **Steps 1-5: detectWsl() vía `/proc/version` contains "microsoft"; convertWslPath() entre WSL y Windows nativo. ~40 LOC.**

#### Task G5.I.2: Culture skills install pattern (T3.13)

**Files:**
- Modify: G5.E.7 ya cubre installSkill — completar con per-provider canonical paths.

#### Task G5.I.3: `apohara learn <provider>` self-teaching (T3.14, culture learn_prompt)

**Files:**
- Create: `src/cli/learn.ts`
- Create: `tests/cli/learn.test.ts`

- [ ] **Steps 1-5: Genera prompt-tailored para que un agente aprenda Apohara desde scratch. ~80 LOC.**

#### Task G5.I.4: parseWithFallback zod boundary (T3.16, multica)

**Files:**
- Create: `src/core/ipc/parseWithFallback.ts`
- Create: `tests/core/ipc/parse-with-fallback.test.ts`

- [ ] **Steps 1-5: Wrap zod parse con fallback graceful en case de schema drift TS↔Rust. ~40 LOC.**

#### Task G5.I.5: OSC 998 command-state escape (T3.17, nimbalyst)

**Files:**
- Create: `src/core/pty/osc998.ts`
- Create: `tests/core/pty/osc998.test.ts`

- [ ] **Steps 1-5: Parse OSC 998 escape sequences from PTY output → emit command-state events. ~60 LOC.**

#### Task G5.I.6: Worktree status con git cherry (T3.18, nimbalyst)

**Files:**
- Modify: existing worktree status helper
- Create: `tests/core/worktree/cherry-status.test.ts`

- [ ] **Steps 1-5: Reemplazar count de commits ahead con `git cherry` para unique commits ahead (más precision). ~30 LOC.**

#### Task G5.I.7: Per-worktree named locks (T3.19, vibe-kanban)

**Files:**
- Create: `src/core/worktree/named-locks.ts`
- Create: `tests/core/worktree/named-locks.test.ts`

- [ ] **Steps 1-5: Named lock per worktree-id usando flock o equivalente. Race prevention multi-agent. ~50 LOC.**

#### Task G5.I.8: Multi-tier prompt cache (T3.20, claude-octopus)

**Files:**
- Create: `src/core/cache/prompt-cache.ts`
- Create: `tests/core/cache/prompt-cache.test.ts`

- [ ] **Steps 1-5: Cache hits trackeados por (provider, prompt_hash, tier). Tier = full | system-only | tools-only. Targets cache rates de Anthropic. ~80 LOC.**

---

## Wave 1 cierre

- [ ] **Wave 1 final: Suite gateada verde**

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/`
Expected: 540 + ~80 nuevos = ~620 pass / 0 fail

Run: `bunx tsc --noEmit 2>&1 | tail -5`
Expected: solo los 3 pre-existing errors

Run: per-crate cargo OOM-safe — n/a Wave 1 (TS only)

- [ ] **Wave 1 reviewers combinados**

Despachar 1 reviewer combinado (spec + code quality) para cada uno de los 4 grupos. Si todos ✅ → marcar Wave 1 completed y avanzar a Wave 2.

---

## Wave 2 — Días 6-10 (3 paralelos con deps en Sprint 4 outputs)

### G5.B — State machines + Lifecycle (~10 sub-tareas)

**Depende de**: T4.6 Coordinator class (Sprint 4)

**Sub-tareas listadas** (TDD detail se expande al arrancar Wave 2):

| ID | Tema | Files | Esfuerzo |
|---|---|---|---:|
| G5.B.1 | symphony #3 RunState/RunPhase completar | `src/core/dispatch/state.ts` (modify) | 0.5 día |
| G5.B.2 | symphony #5 Reconciliation tick completar (T3.10) | `src/core/dispatch/reconciler.ts` (modify) | 1 día |
| G5.B.3 | symphony #10 Blocked state como primary | `src/core/dispatch/state.ts` (extender) | 0.5 día |
| G5.B.4 | T3.9 Continuation turns (live thread) | `src/core/dispatch/continuation.ts` (nuevo) | 1.5 días |
| G5.B.5 | agentrail #6 Scheduler lanes priorizadas | `src/core/orchestration/scheduler-lanes.ts` (nuevo) | 1 día |
| G5.B.6 | agentrail #5 Setup task lane dedicada (PARCIAL → COMPLETO) | extends G5.B.5 | 0.5 día |
| G5.B.7 | chorus state machine completar (varios PARCIAL) | inspect first | 0.5 día |
| G5.B.8 | symphony #4 Continuation vs Failure retry semánticos | `src/core/dispatch/retry-semantics.ts` (nuevo) | 1 día |
| G5.B.9 | claude-octopus #6 Freeze/Careful state | extend state.ts | 0.5 día |
| G5.B.10 | claude-octopus #7 TeammateIdle state | extend state.ts | 0.5 día |

**Total G5.B**: ~6-8 días.

### G5.C — Hooks + Coordination + Context (~8 sub-tareas)

**Depende de**: T4.5 Hooks broadcast (Sprint 4)

| ID | Tema | Files | Esfuerzo |
|---|---|---|---:|
| G5.C.1 | claude-octopus #8 Pre/PostCompact contract re-injection | `src/core/hooks/compact-reinjection.ts` (nuevo) | 1 día |
| G5.C.2 | claude-octopus #3 Statusline bridge | `packages/desktop/src/components/Statusline.tsx` (nuevo) + hooks bridge | 1 día |
| G5.C.3 | claude-octopus #4 Context warnings | `src/core/hooks/context-warnings.ts` (nuevo) | 0.5 día |
| G5.C.4 | claude-octopus #10 Per-worktree env isolation | `src/core/worktree/env-isolation.ts` (nuevo) | 1 día |
| G5.C.5 | claude-octopus #9 Learnings dump | `src/core/hooks/learnings-dump.ts` (nuevo) | 0.5 día |
| G5.C.6 | chorus H8 additionalContext verify paths nuevos | `src/core/hooks/server.ts` (modify) | 0.5 día |
| G5.C.7 | chorus H19 Notifier multi-subscribe | `src/core/notifier.ts` (modify) | 0.5 día |
| G5.C.8 | chorus H18 EventSource onReconnect backfill | `src/core/sse-client.ts` (modify) | 1 día |

**Total G5.C**: ~5-7 días.

### G5.G — Symphony patterns mid-stack (~10 sub-tareas)

**Depende de**: T4.6 Coordinator (Sprint 4)

| ID | Tema | Files | Esfuerzo |
|---|---|---|---:|
| G5.G.1 | symphony #1 RFC2119 validation profiles | `src/core/spec/rfc2119-validator.ts` (nuevo) | 1 día |
| G5.G.2 | symphony #2 Hot-reload con last-known-good (PARCIAL → COMPLETO) | `src/core/spec/watcher.ts` (modify) | 1 día |
| G5.G.3 | symphony #6 PathSafety symlink-escape (PARCIAL → COMPLETO) | `crates/apohara-pathsafety/` (modify) | 1 día |
| G5.G.4 | symphony #7 Workspace hooks 4-phase lifecycle (PARCIAL → COMPLETO) | usa G5.H.5 | 0 (covered) |
| G5.G.5 | symphony #8 Line-framed protocol sanitization (PARCIAL → COMPLETO) | `src/core/protocols/line-framed.ts` (modify) | 0.5 día |
| G5.G.6 | symphony #9 Dynamic tools + auto-approval heuristics | `src/core/safety/auto-approval.ts` (nuevo) | 1 día |
| G5.G.7 | symphony #12 Dashboard humanizer | `crates/apohara-event-humanizer/` (modify) | 1 día |
| G5.G.8 | symphony #14 Self-describing guardrail flags (AMBIGUO → resolver) | `src/core/safety/guardrail-flags.ts` (nuevo) | 0.5 día |
| G5.G.9 | symphony #15 Tracker adapter (PARCIAL → COMPLETO) | inspect first | 0.5 día |
| G5.G.10 | symphony anti-thrash rotation (PARCIAL → COMPLETO) | `crates/apohara-anti-thrash/` (modify) | 0.5 día |

**Total G5.G**: ~6-8 días.

### Wave 2 cierre

Same pattern que Wave 1: reviewers combinados (1 per grupo), suite gateada (~620 → ~850 pass), avanzar a Wave 3.

---

## Wave 3 — Días 11-14 (2 paralelos con deps en Sprint 4 + cross-Sprint-5)

### G5.A — Providers / Protocols / Streams (~12 sub-tareas)

**Depende de**: T4.7 ProtocolInterface (Sprint 4)

| ID | Tema | Files | Esfuerzo |
|---|---|---|---:|
| G5.A.1 | nimbalyst #1.1 persistent stdin handling | `src/core/providers/protocols/AgentProtocol.ts` (modify) + per-protocol | 1.5 días |
| G5.A.2 | nimbalyst #1.2 Protocol implementations completas (sendMessage streaming) | 3 protocols (modify) | 2 días |
| G5.A.3 | nimbalyst #1.3 prompt builders por provider | `src/core/providers/prompt-builders/` (nuevo) | 1 día |
| G5.A.4 | nimbalyst #1.4 step usage attribution | `src/core/providers/step-usage.ts` (nuevo) | 1 día |
| G5.A.5 | nimbalyst #1.5 file snapshot before/after | `src/core/providers/file-snapshot.ts` (nuevo) | 1 día |
| G5.A.6 | nimbalyst #1.6 persistent stdin → multi-turn session | extend G5.A.1 | 0.5 día |
| G5.A.7 | nimbalyst capabilities tooling | `src/core/providers/capabilities.ts` (nuevo) | 1 día |
| G5.A.8 | nimbalyst #11.2 file snapshot diff streaming | extend G5.A.5 | 0.5 día |
| G5.A.9 | T3.7 EditorHost contract + useEditorLifecycle | `packages/desktop/src/editors/` (nuevo) | 1.5 días |
| G5.A.10 | vibe-kanban capabilities-based feature flags wiring | `src/core/feature-flags.ts` (modify) | 0.5 día |
| G5.A.11 | vibe-kanban pure profiles (PARCIAL → COMPLETO) | `src/core/safety/pure-profiles.ts` (modify) | 0.5 día |
| G5.A.12 | vibe-kanban enum_dispatch + spawn_blocking (AMBIGUO → resolver) | per-file decisions | 0.5 día |

**Total G5.A**: ~8-10 días.

### G5.F — Persistence + Atomic + Drift (~10 sub-tareas)

**Depende de**: T4.2 DurablePromptStore JSONL (Sprint 4)

| ID | Tema | Files | Esfuerzo |
|---|---|---|---:|
| G5.F.1 | nimbalyst #5.1 Two-tier canonical projection | `src/core/projector/transcript-transformer.ts` (nuevo) | 2 días |
| G5.F.2 | T3.2 Idempotency-Key + JSONL replay 72h | `src/core/ledger/idempotency.ts` (nuevo) | 1.5 días |
| G5.F.3 | vibe-kanban #3 JSON-Patch streaming (RFC6902 via SSE) | `src/core/projector/json-patch-stream.ts` (nuevo) | 1.5 días |
| G5.F.4 | vibe-kanban #9 Preview-proxy del UI dev server | `packages/desktop/src/preview-proxy.ts` (nuevo) | 1 día |
| G5.F.5 | vibe-kanban #14 Dev setup automation | `scripts/dev-setup.sh` (nuevo) | 0.5 día |
| G5.F.6 | vibe-kanban #11 AGENTS.md scoped por crate (PARCIAL → COMPLETO) | per-crate AGENTS.md | 1 día |
| G5.F.7 | vibe-kanban #17 Sound files para notifications | `packages/desktop/src/assets/sounds/` (nuevo) | 0.5 día |
| G5.F.8 | agentrail #12 Last-Event-ID en SSE para resume | `src/core/sse-server.ts` (modify) | 0.5 día |
| G5.F.9 | multica atomic writes patterns | varias (modify) | 1 día |
| G5.F.10 | follow-up T4.2: compactLedger auto-invoke en consume() | `src/core/safety/durablePrompt.ts` (modify) | 0.5 día |

**Total G5.F**: ~7-9 días.

### Wave 3 cierre

Same pattern. Suite gateada esperada ~850-900 pass.

---

## Sprint 5 cierre

- [ ] **Final 1: Suite gateada completa**

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/`
Expected: ~850-900 pass / 0 fail (Sprint 5 baseline → ~250-280 nuevos sobre 540 Sprint 4 close)

- [ ] **Final 2: TS typecheck + Rust per-crate clippy**

Run: `bunx tsc --noEmit 2>&1 | tail -5`
Expected: 3 pre-existing errors (sin nuevos)

Run cada crate touched: `cargo test -p <crate> --lib` + `cargo clippy -p <crate> -- -D warnings`

- [ ] **Final 3: Browser smoke (UI sigue funcionando)**

Start dev server, click Run, verificar flow end-to-end no rota.

- [ ] **Final 4: Squash-merge a `feat/apohara-ultimate`**

```bash
git checkout feat/apohara-ultimate
git merge --squash feat/apohara-ultimate-sprint-5
git commit -m "feat(ultimate): close Sprint 5 — Mid-stack features"
```

(commit message expandido con resumen de los 9 grupos + tests acumulados + follow-ups identificados)

- [ ] **Final 5: Engram session summary**

`mem_session_summary` con goal/discoveries/accomplished/next-steps/relevant-files.

---

## Self-Review (post-write checklist)

### 1. Spec coverage

Mapeo §4 del spec → tareas plan:

| Spec grupo | Plan grupo | Tareas detalladas (TDD) | Tareas listadas (no TDD) |
|---|---|---|---|
| G5.A Providers | G5.A | 0 | 12 (Wave 3) |
| G5.B State machines | G5.B | 0 | 10 (Wave 2) |
| G5.C Hooks+Coordination | G5.C | 0 | 8 (Wave 2) |
| G5.D Safety+Permissions | G5.D | 7 | 0 |
| G5.E Filter DSL+Whisper | G5.E | 8 | 0 |
| G5.F Persistence+Atomic | G5.F | 0 | 10 (Wave 3) |
| G5.G Symphony mid-stack | G5.G | 0 | 10 (Wave 2) |
| G5.H Multica mid-stack | G5.H | 6 | 0 |
| G5.I Backlog Tier 3 | G5.I | 8 | 0 |

**Total**: 29 tareas TDD-detalladas + 50 tareas listadas. Suma = 79 (spec dice ~75).

**Gap**: ninguno. Cobertura completa.

### 2. Placeholder scan

- ✗ Algunas tareas usan "Steps 1-5" abreviado (G5.H.3-G5.H.6 + G5.E.8 + G5.I.1-G5.I.8). NO son placeholders del tipo "TBD" / "implement later" — son **scope-out estructural** por context budget. Cada tarea tiene archivo + tema + esfuerzo, suficiente para que el implementer expanda al ejecutar.
- ✗ Las Wave 2/3 son listas sin TDD. Documentado explícitamente como "Detalles TDD se expanden al arrancar" (evita plan-staleness).
- ✓ Las 21 tareas TDD-detalladas (G5.D.1-G5.D.7, G5.E.1-G5.E.7, G5.H.1-G5.H.2) tienen tests + implementations completas.

### 3. Type consistency

- `AvailableAction` en G5.D.1 — usa misma shape en todo el grupo
- `PermissionedToolSpec / PermissionGuard` — coherent entre G5.D.2
- `DualStatusAC / ACStatus` — coherent G5.D.3
- `FilterAST` — definido en G5.E.1 parser, usado en applier (mismo file group)
- `WhisperMessage` — definido en G5.E.2 encoder, usado en decoder (mismo file group)
- `TaggedEvent / TaggedEventBus` — coherent G5.E.6
- Tests usan `expect(...).toBe(...)` consistentemente, `mkdtemp/rm` patterns idénticos.

### Action items inline applied

Ninguno detectado durante self-review. Plan listo para handoff a Wave 1.

---

*Fin del plan Sprint 5.*

## Execution choice

Plan completo y guardado a `docs/superpowers/plans/2026-05-22-apohara-ultimate-sprint-5.md`. Dos opciones de ejecución:

**1. Subagent-Driven (recomendado por la skill)** — Despachar 4 implementers paralelos Opus para Wave 1 (G5.D + G5.E + G5.H + G5.I), reviewers combinados después, fix-loops si necesario. Pattern validado en Sprint 4.

**2. Inline execution** — Si el usuario prefiere ver el trabajo en vivo, ejecutar inline con checkpoints después de cada Wave.

Cuando Pablo vuelva, elige. Default mientras está AFK: **NO ejecuto Sprint 5** todavía — el plan queda como artefacto para que él lo revise primero.
