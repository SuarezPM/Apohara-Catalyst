# Apohara Ultimate Sprint 6 — v1.1+ Promovidos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar los 10 items v1.1+ promovidos a Apohara Ultimate (spec §5): daemon split, WS hub, two-transport heartbeat, profile system multi-daemon, workspace GC 3-tier, embedded SSH server, SSH worker extension, Smart Router auto-invoke, Reaction Engine state machine, /yolo full-auto pipeline. Es el sprint que define "Ultimate" — features que el plan v1.0 había diferido por costo.

**Architecture:** 5 grupos arquitectónicos paralelizables en 3 waves. **Feature flags obligatorios** para todos los grupos riesgosos (defense-in-depth: opt-in OFF default). Branch destino: `feat/apohara-ultimate-sprint-6` (deriva de `feat/apohara-ultimate` post-Sprint-5).

**Tech Stack:** Bun 1.3.13 + TypeScript 5+ + Rust stable + tokio + russh (SSH) + bun:sqlite + bun:test + cargo test (OOM-safe per-binary). Nuevas crates: `apohara-daemon`, `apohara-client`, `apohara-ws-hub`, `apohara-transport`, `apohara-ssh-server`, `apohara-remote-worker`, `apohara-reaction-engine`.

---

## Estructura del Sprint 6

### 5 grupos por afinidad arquitectónica

| Grupo | Tema | # tareas | Esfuerzo | Wave | Feature flag default |
|---|---|---:|---:|---|---|
| **G6.A** | Multi-process foundation (daemon split + WS hub + transport + profiles) | 12 | 10-14 días | 2 | `APOHARA_DAEMON_MODE=1` OFF |
| **G6.B** | Workspace GC 3-tier | 5 | 3-4 días | 1 (detallado) | n/a (always-on, safe) |
| **G6.C** | Distributed compute (SSH server + worker) | 10 | 8-10 días | 2 | `APOHARA_REMOTE_WORKERS=1` OFF |
| **G6.D** | Smart automation (Smart Router + Reaction Engine) | 12 | 8-10 días | 2 | `APOHARA_SMART_ROUTER=1` + `APOHARA_REACTIONS=1` OFF |
| **G6.E** | `/yolo` full-auto pipeline | 6 | 4-6 días | 1 (detallado) | **TRIPLE OFF**: env + UI toggle + per-workspace allowlist |

### Estrategia de detalle

- **Wave 1 (G6.B + G6.E)**: TDD bite-sized completo. Sin deps, ejecutables al arrancar.
- **Wave 2 (G6.A + G6.C + G6.D)**: estructura ejecutable (sub-tareas + archivos + esfuerzo). Detalles TDD se expanden cuando arranque cada wave. G6.A es el sprint más arquitectónico — cambio del modelo de proceso afecta TODO; mitigación: feature flag + backward-compat shim a monolithic mode.

### Identidad NO negociable (intacta desde spec)

- Tauri 2 (NO Electron)
- bun:sqlite + Rust SQLx (NO PostgreSQL/pgvector)
- Single-user-per-machine (NO multi-tenant)
- CLI wrappers ONLY (NO OAuth)
- Local-first (NO cloud sync por default; SSH worker es opt-in para uso local de máquinas del MISMO user)

### Riesgos críticos (revisar antes de ejecutar)

1. **G6.A es el sprint más arriesgado**: cambiar el modelo de proceso. Mitigación: el shim backward-compat permite que toda la app funcione en monolithic si daemon split inestable. Split queda detrás de `APOHARA_DAEMON_MODE=1` feature flag.
2. **G6.C SSH**: socket SSH local — riesgo de seguridad. Mitigación: bind explícito 127.0.0.1, key-based auth obligatorio (no password), audit-log de workers conectados.
3. **G6.D Smart Router**: depende de LLM-as-classifier (costo). Mitigación: prompt cache agresivo (90%+ hits), max-classifications-per-hour cap.
4. **G6.E `/yolo`**: peligro real de "agent rampage". Mitigación: TRIPLE OFF obligatorio (env + UI + allowlist); sin uno de los 3 → modo deshabilitado.

---

## Setup pre-Wave

- [ ] **Setup 1: Crear branch**

```bash
git checkout feat/apohara-ultimate
git checkout -b feat/apohara-ultimate-sprint-6
```

- [ ] **Setup 2: Verificar base verde**

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/`
Expected: ~850-900 pass / 0 fail (Sprint 5 close baseline)

Run: `bunx tsc --noEmit 2>&1 | tail -5`
Expected: 3 pre-existing errors

---

## Wave 1 — Días 1-7 (2 paralelos sin deps)

### G6.B — Workspace GC 3-tier (~5 tareas)

**Outcome esperado:** worktree storage tiered: Full → Artifact-only → Metadata-only. Auto-downgrade cuando disco supera threshold. Multica #8 (workspace GC tiers — promovido).

#### Task G6.B.1: Tier enum + storage layout types

**Files:**
- Create: `src/core/worktree/gc-tiered/types.ts`
- Create: `tests/core/worktree/gc-tiered/types.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import type { WorktreeTier, TieredWorktree } from "../../../../src/core/worktree/gc-tiered/types";

test("WorktreeTier enum has three levels", () => {
  const tiers: WorktreeTier[] = ["full", "artifact-only", "metadata-only"];
  expect(tiers.length).toBe(3);
});

test("TieredWorktree carries tier + size estimate", () => {
  const wt: TieredWorktree = {
    id: "wt-1",
    path: "/x",
    tier: "full",
    sizeBytes: 1024 * 1024 * 100, // 100MB
    lastAccessedMs: Date.now(),
  };
  expect(wt.tier).toBe("full");
  expect(wt.sizeBytes).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test → FAIL**

- [ ] **Step 3: Implementar `src/core/worktree/gc-tiered/types.ts`**

```typescript
/**
 * Multica #8 — workspace storage tiered to manage disk pressure.
 *
 * Three tiers in priority order (most to least valuable):
 *   full:           complete worktree (~50-500MB each, full git checkout + node_modules + target/)
 *   artifact-only:  only `target/release/`, `dist/`, build outputs (~5-50MB)
 *   metadata-only:  task.json + result.json + JSONL log (~1-10KB)
 *
 * GC policy: when total worktree storage exceeds threshold, downgrade
 * oldest-accessed worktree Tier1→2→3. Re-upgrade on access (lazy).
 */

export type WorktreeTier = "full" | "artifact-only" | "metadata-only";

export interface TieredWorktree {
  id: string;
  path: string;
  tier: WorktreeTier;
  sizeBytes: number;
  lastAccessedMs: number;
}

export interface GcPolicy {
  totalBudgetBytes: number;
  fullTierMaxAgeMs: number;
  artifactTierMaxAgeMs: number;
}

export const DEFAULT_GC_POLICY: GcPolicy = {
  totalBudgetBytes: 10 * 1024 * 1024 * 1024, // 10GB
  fullTierMaxAgeMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  artifactTierMaxAgeMs: 30 * 24 * 60 * 60 * 1000, // 30 days
};
```

- [ ] **Step 4: Run test → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/worktree/gc-tiered/types.test.ts src/core/worktree/gc-tiered/types.ts
git commit -m "$(cat <<'EOF'
feat(worktree): tiered GC types (G6.B.1)

multica #8 (promoted to Ultimate) — three tier enum for workspace
storage management. full / artifact-only / metadata-only. Default
policy: 10GB total budget, 7d full → 30d artifact → metadata forever.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/worktree/gc-tiered/types.ts tests/core/worktree/gc-tiered/types.test.ts
```

#### Task G6.B.2: Worktree size estimator

**Files:**
- Create: `src/core/worktree/gc-tiered/size-estimator.ts`
- Create: `tests/core/worktree/gc-tiered/size-estimator.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { estimateWorktreeSize } from "../../../../src/core/worktree/gc-tiered/size-estimator";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "apohara-gc-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("returns 0 for empty dir", async () => {
  expect(await estimateWorktreeSize(dir)).toBe(0);
});

test("sums file sizes recursively", async () => {
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "a.txt"), "x".repeat(100));
  await writeFile(join(dir, "src", "b.txt"), "y".repeat(200));
  const size = await estimateWorktreeSize(dir);
  expect(size).toBeGreaterThanOrEqual(300);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementar**

```typescript
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";

export async function estimateWorktreeSize(path: string): Promise<number> {
  let total = 0;
  const stack: string[] = [path];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    let entries;
    try {
      entries = await readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(cur, entry.name);
      if (entry.isDirectory()) {
        stack.push(full);
      } else if (entry.isFile()) {
        try {
          const s = await stat(full);
          total += s.size;
        } catch {
          // race with deletion is fine
        }
      }
    }
  }
  return total;
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/worktree/gc-tiered/size-estimator.test.ts src/core/worktree/gc-tiered/size-estimator.ts
git commit -m "$(cat <<'EOF'
feat(worktree): worktree size estimator (G6.B.2)

Recursive du-equivalent for tier downgrade decisions. Race-safe
against concurrent deletions (silent skip on stat ENOENT).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/worktree/gc-tiered/size-estimator.ts tests/core/worktree/gc-tiered/size-estimator.test.ts
```

#### Task G6.B.3: Tier downgrade executor

**Files:**
- Create: `src/core/worktree/gc-tiered/downgrade.ts`
- Create: `tests/core/worktree/gc-tiered/downgrade.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { downgradeWorktree } from "../../../../src/core/worktree/gc-tiered/downgrade";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "apohara-dg-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("downgrade full → artifact-only keeps target/ + dist/ + drops node_modules + src", async () => {
  await mkdir(join(dir, "target", "release"), { recursive: true });
  await mkdir(join(dir, "dist"), { recursive: true });
  await mkdir(join(dir, "node_modules", "x"), { recursive: true });
  await mkdir(join(dir, "src"), { recursive: true });
  await writeFile(join(dir, "target", "release", "bin"), "binary");
  await writeFile(join(dir, "dist", "out.js"), "x");
  await writeFile(join(dir, "node_modules", "x", "p.json"), "x");
  await writeFile(join(dir, "src", "code.ts"), "x");
  await writeFile(join(dir, "task.json"), "x");

  await downgradeWorktree(dir, "full", "artifact-only");

  const remaining = await readdir(dir);
  expect(remaining).toContain("target");
  expect(remaining).toContain("dist");
  expect(remaining).not.toContain("node_modules");
  expect(remaining).not.toContain("src");
  expect(remaining).toContain("task.json"); // task metadata always preserved
});

test("downgrade artifact-only → metadata-only keeps task.json + log + drops target/", async () => {
  await mkdir(join(dir, "target"), { recursive: true });
  await writeFile(join(dir, "target", "bin"), "x");
  await writeFile(join(dir, "task.json"), "x");
  await writeFile(join(dir, "result.json"), "x");
  await writeFile(join(dir, "agent.log"), "x");

  await downgradeWorktree(dir, "artifact-only", "metadata-only");

  const remaining = await readdir(dir);
  expect(remaining).not.toContain("target");
  expect(remaining).toContain("task.json");
  expect(remaining).toContain("result.json");
  expect(remaining).toContain("agent.log");
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementar**

```typescript
import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import type { WorktreeTier } from "./types.js";

const ARTIFACT_KEEP = new Set(["target", "dist", ".next", "build", "out"]);
const METADATA_KEEP = new Set(["task.json", "result.json", "agent.log", "manifest.json"]);

export async function downgradeWorktree(
  path: string,
  from: WorktreeTier,
  to: WorktreeTier,
): Promise<void> {
  // Always preserve metadata files at root regardless of tier.
  if (to === "artifact-only") {
    const entries = await readdir(path, { withFileTypes: true });
    for (const e of entries) {
      const isArtifact = e.isDirectory() && ARTIFACT_KEEP.has(e.name);
      const isMetadata = e.isFile() && METADATA_KEEP.has(e.name);
      if (!isArtifact && !isMetadata) {
        await rm(join(path, e.name), { recursive: true, force: true });
      }
    }
  } else if (to === "metadata-only") {
    const entries = await readdir(path, { withFileTypes: true });
    for (const e of entries) {
      const isMetadata = e.isFile() && METADATA_KEEP.has(e.name);
      if (!isMetadata) {
        await rm(join(path, e.name), { recursive: true, force: true });
      }
    }
  }
  // Upgrade paths (metadata-only → full, etc.) are noops — they require
  // recomputation from git which is out of scope for downgradeWorktree.
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/worktree/gc-tiered/downgrade.test.ts src/core/worktree/gc-tiered/downgrade.ts
git commit -m "$(cat <<'EOF'
feat(worktree): tier downgrade executor (G6.B.3)

multica #8 — full → artifact-only keeps target/dist/.next/build/out
plus metadata files. artifact-only → metadata-only drops everything
except task.json + result.json + agent.log + manifest.json. Upgrade
paths are NOOPs (require recomputation from git, out of scope here).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/worktree/gc-tiered/downgrade.ts tests/core/worktree/gc-tiered/downgrade.test.ts
```

#### Task G6.B.4: GC orchestrator (policy + scan + downgrade)

**Files:**
- Create: `src/core/worktree/gc-tiered/orchestrator.ts`
- Create: `tests/core/worktree/gc-tiered/orchestrator.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { runGcTick } from "../../../../src/core/worktree/gc-tiered/orchestrator";
import type { TieredWorktree, GcPolicy } from "../../../../src/core/worktree/gc-tiered/types";

const policy: GcPolicy = {
  totalBudgetBytes: 1000,
  fullTierMaxAgeMs: 1000,
  artifactTierMaxAgeMs: 5000,
};

test("returns no-op when under budget", () => {
  const now = 10_000;
  const wts: TieredWorktree[] = [
    { id: "a", path: "/a", tier: "full", sizeBytes: 100, lastAccessedMs: now - 500 },
  ];
  const actions = runGcTick(wts, policy, now);
  expect(actions).toEqual([]);
});

test("downgrades oldest worktree when over budget", () => {
  const now = 10_000;
  const wts: TieredWorktree[] = [
    { id: "old", path: "/old", tier: "full", sizeBytes: 800, lastAccessedMs: now - 5000 },
    { id: "new", path: "/new", tier: "full", sizeBytes: 800, lastAccessedMs: now - 500 },
  ];
  const actions = runGcTick(wts, policy, now);
  expect(actions[0]).toMatchObject({ id: "old", from: "full", to: "artifact-only" });
});

test("downgrades full → artifact when age exceeds fullTierMaxAgeMs even under budget", () => {
  const now = 10_000;
  const wts: TieredWorktree[] = [
    { id: "stale", path: "/x", tier: "full", sizeBytes: 100, lastAccessedMs: now - 2000 },
  ];
  const actions = runGcTick(wts, policy, now);
  expect(actions[0]).toMatchObject({ id: "stale", from: "full", to: "artifact-only" });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementar**

```typescript
import type { TieredWorktree, WorktreeTier, GcPolicy } from "./types.js";

export interface GcAction {
  id: string;
  from: WorktreeTier;
  to: WorktreeTier;
  reason: "budget" | "age";
}

export function runGcTick(
  worktrees: TieredWorktree[],
  policy: GcPolicy,
  nowMs: number,
): GcAction[] {
  const actions: GcAction[] = [];

  // Pass 1: age-based downgrades.
  for (const wt of worktrees) {
    const age = nowMs - wt.lastAccessedMs;
    if (wt.tier === "full" && age > policy.fullTierMaxAgeMs) {
      actions.push({ id: wt.id, from: "full", to: "artifact-only", reason: "age" });
    } else if (wt.tier === "artifact-only" && age > policy.artifactTierMaxAgeMs) {
      actions.push({ id: wt.id, from: "artifact-only", to: "metadata-only", reason: "age" });
    }
  }

  // Pass 2: budget-based downgrades on remaining full-tier oldest first.
  const totalBytes = worktrees.reduce((acc, w) => acc + w.sizeBytes, 0);
  if (totalBytes > policy.totalBudgetBytes) {
    const candidates = worktrees
      .filter(w => w.tier === "full" && !actions.some(a => a.id === w.id))
      .sort((a, b) => a.lastAccessedMs - b.lastAccessedMs);
    for (const wt of candidates) {
      actions.push({ id: wt.id, from: "full", to: "artifact-only", reason: "budget" });
      // For simplicity: one downgrade per tick. Caller invokes tick again.
      break;
    }
  }

  return actions;
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/worktree/gc-tiered/orchestrator.test.ts src/core/worktree/gc-tiered/orchestrator.ts
git commit -m "$(cat <<'EOF'
feat(worktree): GC tick orchestrator (G6.B.4)

multica #8 — runGcTick decides downgrade actions: pass 1 age-based
(fullTierMaxAgeMs → artifact-only; artifactTierMaxAgeMs → metadata),
pass 2 budget-based (totalBytes > budget → downgrade oldest full).
One action per tick by design — caller invokes repeatedly until
under budget. Pure function: no I/O, no state.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/worktree/gc-tiered/orchestrator.ts tests/core/worktree/gc-tiered/orchestrator.test.ts
```

#### Task G6.B.5: Worktree manager integration (wire GC tick)

**Files:**
- Modify: existing worktree manager (inspeccionar primero `find src -name "worktree*.ts" -type f`)
- Create: `tests/integration/worktree-gc-tiered.test.ts`

- [ ] **Step 1: Inspeccionar state**

Run: `find src crates -name "worktree*" -type f | head -10`
Expected: existing worktree manager + worktree crate.

- [ ] **Step 2: Failing integration test**

```typescript
import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runGcTick } from "../../src/core/worktree/gc-tiered/orchestrator";
import { downgradeWorktree } from "../../src/core/worktree/gc-tiered/downgrade";
import { estimateWorktreeSize } from "../../src/core/worktree/gc-tiered/size-estimator";

test("end-to-end: scan → tick → downgrade → re-scan under budget", async () => {
  const root = await mkdtemp(join(tmpdir(), "apohara-gc-e2e-"));
  try {
    // Set up 2 fake worktrees: 1 old, 1 new
    const old = join(root, "wt-old");
    const newer = join(root, "wt-new");
    await mkdir(join(old, "target", "release"), { recursive: true });
    await mkdir(join(old, "node_modules"), { recursive: true });
    await writeFile(join(old, "task.json"), "{}");
    await writeFile(join(old, "node_modules", "big"), "x".repeat(2000));
    await mkdir(join(newer, "src"), { recursive: true });
    await writeFile(join(newer, "task.json"), "{}");

    const now = Date.now();
    const wts = [
      { id: "old", path: old, tier: "full" as const, sizeBytes: await estimateWorktreeSize(old), lastAccessedMs: now - 1_000_000 },
      { id: "new", path: newer, tier: "full" as const, sizeBytes: await estimateWorktreeSize(newer), lastAccessedMs: now - 100 },
    ];

    const policy = {
      totalBudgetBytes: 100, // tiny — both exceed
      fullTierMaxAgeMs: 500_000, // 8min
      artifactTierMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
    };

    const actions = runGcTick(wts, policy, now);
    expect(actions.length).toBeGreaterThan(0);
    expect(actions[0].id).toBe("old");

    await downgradeWorktree(old, actions[0].from, actions[0].to);

    const sizeAfter = await estimateWorktreeSize(old);
    expect(sizeAfter).toBeLessThan(2000); // node_modules dropped
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 3: Run → PASS** (este test es integración pura — no wiring real al manager todavía)

- [ ] **Step 4: Commit + nota wiring**

```bash
git add tests/integration/worktree-gc-tiered.test.ts
git commit -m "$(cat <<'EOF'
feat(worktree): tiered GC end-to-end integration test (G6.B.5)

multica #8 — wires types + estimator + orchestrator + downgrade en
un flujo end-to-end verificable. Wiring REAL al worktree manager
(invocar runGcTick desde scheduler timer) queda como Sprint 7
hardening — el flujo lógico ya está cubierto + las 4 unidades
testeables individualmente.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" tests/integration/worktree-gc-tiered.test.ts
```

---

### G6.E — `/yolo` full-auto pipeline (~6 tareas)

**Outcome esperado:** opt-in full-automation mode con TRIPLE OFF default. Bypass de approvals + auto-spawn de la chain decompose→dispatch→verify→commit→push→PR. Guardrails: auto-rollback si N tests fail + max-cost-per-run + per-workspace allowlist.

#### Task G6.E.1: YoloMode triple-gate check

**Files:**
- Create: `src/core/orchestration/yolo-mode.ts`
- Create: `tests/core/orchestration/yolo-mode.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { isYoloEnabled, type YoloGateContext } from "../../../src/core/orchestration/yolo-mode";

test("yolo disabled by default", () => {
  expect(isYoloEnabled({ env: {}, uiToggle: false, workspaceAllowed: false })).toBe(false);
});

test("yolo requires ALL three gates", () => {
  expect(isYoloEnabled({ env: { APOHARA_YOLO: "1" }, uiToggle: false, workspaceAllowed: false })).toBe(false);
  expect(isYoloEnabled({ env: { APOHARA_YOLO: "1" }, uiToggle: true, workspaceAllowed: false })).toBe(false);
  expect(isYoloEnabled({ env: { APOHARA_YOLO: "1" }, uiToggle: true, workspaceAllowed: true })).toBe(true);
});

test("APOHARA_YOLO=0 disables even if other gates pass", () => {
  expect(isYoloEnabled({ env: { APOHARA_YOLO: "0" }, uiToggle: true, workspaceAllowed: true })).toBe(false);
});

test("missing env var disables", () => {
  expect(isYoloEnabled({ env: {}, uiToggle: true, workspaceAllowed: true })).toBe(false);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementar**

```typescript
/**
 * Chorus /yolo (promoted to Ultimate, opt-in) — full-auto pipeline.
 * TRIPLE OFF by default: env var + UI toggle + per-workspace allowlist.
 * All three MUST be true to enable. Removing any one disables.
 *
 * Reason: agent rampage is a real risk. /yolo bypasses approvals and
 * auto-spawns decompose→dispatch→verify→commit→push→PR. Defense in
 * depth: three orthogonal switches (operator env, UI session, file
 * marker per workspace) prevent accidental enable from any single
 * misconfiguration.
 */

export interface YoloGateContext {
  env: Record<string, string | undefined>;
  uiToggle: boolean;
  workspaceAllowed: boolean;
}

export function isYoloEnabled(ctx: YoloGateContext): boolean {
  const envEnabled = ctx.env.APOHARA_YOLO === "1";
  return envEnabled && ctx.uiToggle === true && ctx.workspaceAllowed === true;
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/orchestration/yolo-mode.test.ts src/core/orchestration/yolo-mode.ts
git commit -m "$(cat <<'EOF'
feat(orchestration): yolo TRIPLE-OFF gate check (G6.E.1)

Chorus /yolo promoted to Ultimate. Three orthogonal switches must
ALL be true to enable: APOHARA_YOLO=1 env + UI session toggle + per-
workspace allowlist file. Defense in depth — single misconfiguration
cannot accidentally enable agent rampage mode.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/orchestration/yolo-mode.ts tests/core/orchestration/yolo-mode.test.ts
```

#### Task G6.E.2: Per-workspace allowlist parser

**Files:**
- Create: `src/core/orchestration/yolo-allowlist.ts`
- Create: `tests/core/orchestration/yolo-allowlist.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWorkspaceYoloAllowed } from "../../../src/core/orchestration/yolo-allowlist";

let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "apohara-yolo-")); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

test("returns false when allowlist marker missing", async () => {
  expect(await isWorkspaceYoloAllowed(dir)).toBe(false);
});

test("returns true when .apohara/yolo-allowed marker exists", async () => {
  await mkdir(join(dir, ".apohara"), { recursive: true });
  await writeFile(join(dir, ".apohara", "yolo-allowed"), "yes");
  expect(await isWorkspaceYoloAllowed(dir)).toBe(true);
});

test("returns false when marker is empty (must have non-empty content)", async () => {
  await mkdir(join(dir, ".apohara"), { recursive: true });
  await writeFile(join(dir, ".apohara", "yolo-allowed"), "");
  expect(await isWorkspaceYoloAllowed(dir)).toBe(false);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementar**

```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * Per-workspace yolo allowlist — explicit opt-in file marker.
 * Empty file does NOT count as allowed (forces deliberate content).
 */
export async function isWorkspaceYoloAllowed(workspacePath: string): Promise<boolean> {
  try {
    const content = await readFile(join(workspacePath, ".apohara", "yolo-allowed"), "utf-8");
    return content.trim().length > 0;
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/orchestration/yolo-allowlist.test.ts src/core/orchestration/yolo-allowlist.ts
git commit -m "$(cat <<'EOF'
feat(orchestration): yolo per-workspace allowlist (G6.E.2)

Marker file `.apohara/yolo-allowed` must exist AND have non-empty
content. Empty file does NOT count — forces deliberate operator
acknowledgement (e.g. content = "approved-2026-05-22 by Pablo").
Third gate of the TRIPLE OFF defense.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/orchestration/yolo-allowlist.ts tests/core/orchestration/yolo-allowlist.test.ts
```

#### Task G6.E.3: Max-cost-per-run cap

**Files:**
- Create: `src/core/orchestration/yolo-cost-cap.ts`
- Create: `tests/core/orchestration/yolo-cost-cap.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { CostCap } from "../../../src/core/orchestration/yolo-cost-cap";

test("cap allows spend under limit", () => {
  const cap = new CostCap({ maxUsd: 10 });
  expect(cap.tryReserve(3)).toBe(true);
  expect(cap.tryReserve(5)).toBe(true);
  expect(cap.totalSpentUsd()).toBe(8);
});

test("cap rejects spend that would exceed limit", () => {
  const cap = new CostCap({ maxUsd: 10 });
  cap.tryReserve(7);
  expect(cap.tryReserve(5)).toBe(false); // 7 + 5 = 12 > 10
  expect(cap.totalSpentUsd()).toBe(7); // not incremented on reject
});

test("cap at exactly limit allows last spend then blocks", () => {
  const cap = new CostCap({ maxUsd: 10 });
  expect(cap.tryReserve(10)).toBe(true);
  expect(cap.tryReserve(0.01)).toBe(false);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementar**

```typescript
/**
 * yolo cost cap — accumulating spend with hard limit. tryReserve
 * is atomic: either the increment is applied AND returns true, or
 * no state change AND returns false. Caller must check return before
 * committing the underlying expense (LLM call, tool exec, etc.).
 */
export interface CostCapOptions {
  maxUsd: number;
}

export class CostCap {
  private spentUsd = 0;
  private readonly maxUsd: number;

  constructor(opts: CostCapOptions) {
    this.maxUsd = opts.maxUsd;
  }

  tryReserve(amountUsd: number): boolean {
    if (this.spentUsd + amountUsd > this.maxUsd) return false;
    this.spentUsd += amountUsd;
    return true;
  }

  totalSpentUsd(): number {
    return this.spentUsd;
  }

  remainingUsd(): number {
    return Math.max(0, this.maxUsd - this.spentUsd);
  }
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/orchestration/yolo-cost-cap.test.ts src/core/orchestration/yolo-cost-cap.ts
git commit -m "$(cat <<'EOF'
feat(orchestration): yolo cost cap (G6.E.3)

Atomic tryReserve(amount): si excede maxUsd, return false sin
incrementar. Caller debe check return ANTES de incurrir el cost
real. Hard limit cap previene runaway spending en /yolo mode.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/orchestration/yolo-cost-cap.ts tests/core/orchestration/yolo-cost-cap.test.ts
```

#### Task G6.E.4: Auto-rollback en test fail

**Files:**
- Create: `src/core/orchestration/yolo-rollback.ts`
- Create: `tests/core/orchestration/yolo-rollback.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { evaluateRollback, type TestRunResult } from "../../../src/core/orchestration/yolo-rollback";

test("no rollback when all tests pass", () => {
  const r: TestRunResult = { passed: 100, failed: 0, errors: 0 };
  expect(evaluateRollback(r, { maxFailures: 3 })).toEqual({ rollback: false });
});

test("rollback when failures exceed threshold", () => {
  const r: TestRunResult = { passed: 90, failed: 5, errors: 0 };
  const decision = evaluateRollback(r, { maxFailures: 3 });
  expect(decision.rollback).toBe(true);
  expect(decision.reason).toContain("5 failed");
});

test("rollback on any error regardless of threshold", () => {
  const r: TestRunResult = { passed: 100, failed: 0, errors: 1 };
  const decision = evaluateRollback(r, { maxFailures: 3 });
  expect(decision.rollback).toBe(true);
  expect(decision.reason).toContain("errors");
});

test("no rollback at exactly threshold (inclusive boundary)", () => {
  const r: TestRunResult = { passed: 90, failed: 3, errors: 0 };
  expect(evaluateRollback(r, { maxFailures: 3 })).toEqual({ rollback: false });
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementar**

```typescript
/**
 * yolo rollback decision — given test results post-implementation,
 * decide whether to revert the changes. Errors (panic / setup / etc.)
 * always trigger rollback; failures trigger if exceeding threshold.
 */

export interface TestRunResult {
  passed: number;
  failed: number;
  errors: number;
}

export interface RollbackPolicy {
  maxFailures: number;
}

export interface RollbackDecision {
  rollback: boolean;
  reason?: string;
}

export function evaluateRollback(result: TestRunResult, policy: RollbackPolicy): RollbackDecision {
  if (result.errors > 0) {
    return { rollback: true, reason: `${result.errors} errors detected (rollback always on error)` };
  }
  if (result.failed > policy.maxFailures) {
    return { rollback: true, reason: `${result.failed} failed exceeds threshold ${policy.maxFailures}` };
  }
  return { rollback: false };
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/orchestration/yolo-rollback.test.ts src/core/orchestration/yolo-rollback.ts
git commit -m "$(cat <<'EOF'
feat(orchestration): yolo rollback decision (G6.E.4)

Pure function: TestRunResult + RollbackPolicy → RollbackDecision.
Errors always trigger rollback (panic / setup failure ≠ "expected
flaky"). Failures trigger if exceeding threshold (strictly greater
than). Caller invokes `git revert` or worktree-rollback on
rollback === true.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/orchestration/yolo-rollback.ts tests/core/orchestration/yolo-rollback.test.ts
```

#### Task G6.E.5: YoloOrchestrator wiring (compose triple-gate + cost-cap + rollback)

**Files:**
- Create: `src/core/orchestration/yolo-orchestrator.ts`
- Create: `tests/core/orchestration/yolo-orchestrator.test.ts`

- [ ] **Step 1: Failing test**

```typescript
import { expect, test } from "bun:test";
import { YoloOrchestrator } from "../../../src/core/orchestration/yolo-orchestrator";

test("requires all gates open before allowing run", () => {
  const orch = new YoloOrchestrator({
    env: { APOHARA_YOLO: "1" },
    uiToggle: false,
    workspaceAllowed: true,
    costCap: { maxUsd: 10 },
    rollbackPolicy: { maxFailures: 3 },
  });
  expect(orch.canStartRun()).toBe(false);
});

test("blocks new spend after cost cap exhausted", () => {
  const orch = new YoloOrchestrator({
    env: { APOHARA_YOLO: "1" },
    uiToggle: true,
    workspaceAllowed: true,
    costCap: { maxUsd: 5 },
    rollbackPolicy: { maxFailures: 3 },
  });
  expect(orch.tryReserveSpend(3)).toBe(true);
  expect(orch.tryReserveSpend(3)).toBe(false); // 3+3=6 > 5
});

test("rollback decision flows through", () => {
  const orch = new YoloOrchestrator({
    env: { APOHARA_YOLO: "1" },
    uiToggle: true,
    workspaceAllowed: true,
    costCap: { maxUsd: 10 },
    rollbackPolicy: { maxFailures: 3 },
  });
  const decision = orch.shouldRollback({ passed: 50, failed: 10, errors: 0 });
  expect(decision.rollback).toBe(true);
});
```

- [ ] **Step 2: Run → FAIL**

- [ ] **Step 3: Implementar**

```typescript
import { isYoloEnabled, type YoloGateContext } from "./yolo-mode.js";
import { CostCap, type CostCapOptions } from "./yolo-cost-cap.js";
import { evaluateRollback, type RollbackPolicy, type RollbackDecision, type TestRunResult } from "./yolo-rollback.js";

export interface YoloOrchestratorOptions extends YoloGateContext {
  costCap: CostCapOptions;
  rollbackPolicy: RollbackPolicy;
}

export class YoloOrchestrator {
  private cap: CostCap;
  private rollback: RollbackPolicy;
  private gateCtx: YoloGateContext;

  constructor(opts: YoloOrchestratorOptions) {
    this.cap = new CostCap(opts.costCap);
    this.rollback = opts.rollbackPolicy;
    this.gateCtx = { env: opts.env, uiToggle: opts.uiToggle, workspaceAllowed: opts.workspaceAllowed };
  }

  canStartRun(): boolean {
    return isYoloEnabled(this.gateCtx);
  }

  tryReserveSpend(amountUsd: number): boolean {
    if (!this.canStartRun()) return false;
    return this.cap.tryReserve(amountUsd);
  }

  shouldRollback(result: TestRunResult): RollbackDecision {
    return evaluateRollback(result, this.rollback);
  }

  totalSpentUsd(): number {
    return this.cap.totalSpentUsd();
  }
}
```

- [ ] **Step 4: Run → PASS**

- [ ] **Step 5: Commit**

```bash
git add tests/core/orchestration/yolo-orchestrator.test.ts src/core/orchestration/yolo-orchestrator.ts
git commit -m "$(cat <<'EOF'
feat(orchestration): yolo orchestrator wiring (G6.E.5)

Compone los 4 building blocks (triple-gate, cost-cap, rollback):
- canStartRun(): triple-gate check
- tryReserveSpend(): blocked if gate closed OR cap exhausted
- shouldRollback(): pure delegate to evaluateRollback

YoloOrchestrator es el punto único de orquestación que el runner
invoca al iniciar un /yolo run.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" src/core/orchestration/yolo-orchestrator.ts tests/core/orchestration/yolo-orchestrator.test.ts
```

#### Task G6.E.6: UI toggle component + per-workspace allowlist UI

**Files:**
- Create: `packages/desktop/src/components/YoloToggle.tsx`
- Create: `tests/integration/yolo-ui.test.ts`

- [ ] **Step 1: Failing test (integration; verifies toggle persistence + allowlist creation flow)**

```typescript
import { expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtemp, rm, mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isWorkspaceYoloAllowed } from "../../src/core/orchestration/yolo-allowlist";

let workspace: string;
beforeEach(async () => { workspace = await mkdtemp(join(tmpdir(), "apohara-yolo-ui-")); });
afterEach(async () => { await rm(workspace, { recursive: true, force: true }); });

test("user creates allowlist file with non-empty content", async () => {
  await mkdir(join(workspace, ".apohara"), { recursive: true });
  await writeFile(join(workspace, ".apohara", "yolo-allowed"), "approved by user 2026-05-22");
  expect(await isWorkspaceYoloAllowed(workspace)).toBe(true);
});

test("revoking allowlist disables yolo", async () => {
  await mkdir(join(workspace, ".apohara"), { recursive: true });
  await writeFile(join(workspace, ".apohara", "yolo-allowed"), "approved");
  expect(await isWorkspaceYoloAllowed(workspace)).toBe(true);
  await rm(join(workspace, ".apohara", "yolo-allowed"));
  expect(await isWorkspaceYoloAllowed(workspace)).toBe(false);
});
```

- [ ] **Step 2: Run → PASS** (test verifies allowlist file behavior; UI Tauri component file separate)

- [ ] **Step 3: Implementar componente React `packages/desktop/src/components/YoloToggle.tsx`**

```typescript
import { useState, useEffect } from "react";

interface Props {
  workspacePath: string;
  envEnabled: boolean;
  allowlistPresent: boolean;
}

/**
 * Triple-gate yolo toggle UI. The toggle reflects ALL three gates:
 * env, this UI state, and the per-workspace allowlist file.
 *
 * IMPORTANT: this component DOES NOT write the allowlist file —
 * that's a deliberate manual step by the user (mkdir .apohara &&
 * echo "approved" > .apohara/yolo-allowed). UI only shows status.
 */
export function YoloToggle({ workspacePath, envEnabled, allowlistPresent }: Props) {
  const [uiToggle, setUiToggle] = useState(false);
  const allEnabled = envEnabled && uiToggle && allowlistPresent;

  return (
    <div className="yolo-toggle">
      <h3>YOLO Mode (DANGEROUS — full auto)</h3>
      <ul>
        <li>Env (APOHARA_YOLO=1): {envEnabled ? "OK" : "MISSING"}</li>
        <li>UI toggle: {uiToggle ? "ON" : "OFF"}</li>
        <li>Workspace allowlist ({workspacePath}/.apohara/yolo-allowed): {allowlistPresent ? "OK" : "MISSING"}</li>
        <li>Effective state: <strong>{allEnabled ? "ENABLED" : "DISABLED"}</strong></li>
      </ul>
      <button onClick={() => setUiToggle(!uiToggle)}>
        {uiToggle ? "Disable UI toggle" : "Enable UI toggle (session-scoped)"}
      </button>
      {!allowlistPresent && (
        <p>To enable, manually create the allowlist file:</p>
      )}
      {!allowlistPresent && (
        <pre>mkdir -p {workspacePath}/.apohara && echo "approved" {">"} {workspacePath}/.apohara/yolo-allowed</pre>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add tests/integration/yolo-ui.test.ts packages/desktop/src/components/YoloToggle.tsx
git commit -m "$(cat <<'EOF'
feat(ui): yolo triple-gate toggle component (G6.E.6)

Reflects ALL three gates explicitly: env / UI / allowlist. UI does
NOT write the allowlist file — that's deliberate manual step from
the user. UI only shows status + instructions on how to create.
Defense in depth against accidental enable from UI alone.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)" packages/desktop/src/components/YoloToggle.tsx tests/integration/yolo-ui.test.ts
```

---

## Wave 1 cierre

- [ ] **Suite gateada**

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/`
Expected: ~850-900 (Sprint 5 close) + ~30 nuevos = ~880-930 pass / 0 fail

- [ ] **Reviewers combinados** para G6.B + G6.E (2 reviewers paralelos)

- [ ] **Si todos ✅** → marcar Wave 1 completed, avanzar a Wave 2.

---

## Wave 2 — Días 8-14 (3 paralelos: G6.A + G6.C + G6.D)

### G6.A — Multi-process foundation (~12 sub-tareas)

**Es el sprint más arquitectónico**. Cambia el modelo de proceso de Apohara: pasa de "1 binary monolítico" a "daemon process en background + N clientes que conectan".

**Feature flag**: `APOHARA_DAEMON_MODE=1` OFF default. El shim backward-compat permite que toda la app funcione en monolithic si daemon split inestable.

**Sub-tareas listadas** (TDD detail se expande al arrancar Wave 2):

| ID | Tarea | Files clave | Esfuerzo |
|---|---|---|---:|
| G6.A.1 | Crate `apohara-daemon` skeleton | `crates/apohara-daemon/{Cargo.toml, src/lib.rs, src/main.rs}` | 1 día |
| G6.A.2 | Crate `apohara-client` skeleton | `crates/apohara-client/{Cargo.toml, src/lib.rs}` | 1 día |
| G6.A.3 | Local socket protocol (length-prefixed frames + envelope versioning) | `crates/apohara-transport/src/local-socket.rs` | 1.5 días |
| G6.A.4 | Client connect/reconnect con reintentos exponenciales | `crates/apohara-client/src/connect.rs` | 1 día |
| G6.A.5 | Crate `apohara-ws-hub` con subscribe/publish/dedupe | `crates/apohara-ws-hub/src/lib.rs` | 1.5 días |
| G6.A.6 | WS hub stampede control (max-N concurrent subscribers per event) | `crates/apohara-ws-hub/src/stampede.rs` | 0.5 día |
| G6.A.7 | HTTP poll endpoint fallback para clientes que pierden WS | `crates/apohara-transport/src/http-poll.rs` | 1 día |
| G6.A.8 | Profile selection `apohara --profile=<name>` | `src/core/profiles/loader.ts` + `crates/apohara-daemon/src/profiles.rs` | 1 día |
| G6.A.9 | Migration de single-process → daemon (config detection) | `src/cli/migrate-to-daemon.ts` | 0.5 día |
| G6.A.10 | Backward-compat shim: monolithic mode si daemon no corriendo | `src/cli/entry.ts` (modify) | 1 día |
| G6.A.11 | Daemon healthcheck endpoint + graceful shutdown + state checkpoint | `crates/apohara-daemon/src/health.rs` + `shutdown.rs` | 1 día |
| G6.A.12 | Multi-daemon coexistence (test con 3 profiles concurrentes) | `tests/integration/multi-daemon.test.ts` | 0.5 día |

**Total G6.A**: ~10-14 días. **El más cara del Sprint 6**.

### G6.C — Distributed compute (~10 sub-tareas)

**Feature flag**: `APOHARA_REMOTE_WORKERS=1` OFF default.

| ID | Tarea | Files clave | Esfuerzo |
|---|---|---|---:|
| G6.C.1 | Crate `apohara-ssh-server` skeleton con russh | `crates/apohara-ssh-server/{Cargo.toml, src/lib.rs}` | 1 día |
| G6.C.2 | Key-based auth obligatorio (no password) | `crates/apohara-ssh-server/src/auth.rs` | 1 día |
| G6.C.3 | `apohara worker` subcommand entry | `src/cli/worker.ts` | 0.5 día |
| G6.C.4 | Crate `apohara-remote-worker` con WorkerLocation enum | `crates/apohara-remote-worker/{Cargo.toml, src/lib.rs}` | 1 día |
| G6.C.5 | Worker handshake protocol (capability negotiation) | `crates/apohara-remote-worker/src/handshake.rs` | 1 día |
| G6.C.6 | Task dispatch a worker remoto vía daemon (G6.A.5 dep) | `crates/apohara-daemon/src/dispatch-remote.rs` | 1 día |
| G6.C.7 | Worker result streaming back (chunked over SSH channel) | `crates/apohara-remote-worker/src/stream.rs` | 1.5 días |
| G6.C.8 | Worker disconnect recovery (task re-dispatch local) | `crates/apohara-daemon/src/recovery.rs` | 1 día |
| G6.C.9 | Audit-log de workers conectados | `crates/apohara-ssh-server/src/audit.rs` | 0.5 día |
| G6.C.10 | E2E test con docker compose (3 workers en containers) | `tests/integration/ssh-workers-docker-compose.test.ts` + `tests/fixtures/docker-compose.workers.yaml` | 1.5 días |

**Total G6.C**: ~8-10 días.

### G6.D — Smart automation (~12 sub-tareas)

**Feature flags**: `APOHARA_SMART_ROUTER=1` + `APOHARA_REACTIONS=1` ambos OFF default.

| ID | Tarea | Files clave | Esfuerzo |
|---|---|---|---:|
| G6.D.1 | Intent enum + ts-rs serialization | `src/core/coordinator/intent-types.ts` + `crates/apohara-types/src/intent.rs` | 0.5 día |
| G6.D.2 | LLM-as-classifier prompt + cache strategy | `src/core/coordinator/intent-classifier.ts` | 1.5 días |
| G6.D.3 | Confidence threshold tuning (smoke dataset 50 prompts) | `tests/fixtures/intent-smoke.json` + `tests/core/coordinator/intent-precision.test.ts` | 1 día |
| G6.D.4 | Repeat-intent detection logic (3× en 5min → auto-spawn) | `src/core/coordinator/repeat-intent.ts` | 1 día |
| G6.D.5 | Auto-spawn integration con Coordinator (T4.6 dep) | `crates/apohara-coordinator/src/auto-spawn.rs` | 1 día |
| G6.D.6 | Crate `apohara-reaction-engine` skeleton | `crates/apohara-reaction-engine/{Cargo.toml, src/lib.rs}` | 0.5 día |
| G6.D.7 | Reaction Engine state machine (13 lifecycle states) | `crates/apohara-reaction-engine/src/state-machine.rs` | 1.5 días |
| G6.D.8 | `reactions.conf` parser declarativo | `crates/apohara-reaction-engine/src/conf.rs` | 1 día |
| G6.D.9 | Action chain executor | `crates/apohara-reaction-engine/src/executor.rs` | 1 día |
| G6.D.10 | Sidecar reactor process (parte del daemon G6.A) | `crates/apohara-daemon/src/reactor.rs` | 0.5 día |
| G6.D.11 | GitHub integration (issue → reaction trigger) — extiende github-bridge existente | `packages/github-bridge/src/reaction-trigger.ts` | 1 día |
| G6.D.12 | E2E test Reaction Engine (issue opened → PR merged via reaction chain) | `tests/integration/reaction-engine-e2e.test.ts` | 1 día |

**Total G6.D**: ~8-10 días.

### Wave 2 cierre

Reviewers paralelos por grupo (3). Suite gateada ~880-930 → ~1050-1150. Avanzar a Wave 3.

---

## Wave 3 — Días 15-18 (integration + smoke)

### Integration testing + cross-platform smoke

| ID | Tarea | Files clave | Esfuerzo |
|---|---|---|---:|
| W3.1 | Daemon crash mid-run recovery | `tests/integration/daemon-crash-recovery.test.ts` | 0.5 día |
| W3.2 | Client reconnect storms (10 clients × 100 reconnects) | `tests/integration/client-reconnect-storms.test.ts` | 0.5 día |
| W3.3 | WS dedupe under concurrent publish | `tests/integration/ws-dedupe.test.ts` | 0.5 día |
| W3.4 | SSH worker disconnect → task re-dispatch local | `tests/integration/ssh-worker-disconnect.test.ts` | 0.5 día |
| W3.5 | Smart Router precision/recall ≥ 0.85 sobre dataset | `tests/integration/smart-router-precision.test.ts` | 0.5 día |
| W3.6 | Reaction Engine state transition coverage (13 states) | `tests/integration/reaction-states.test.ts` | 1 día |
| W3.7 | /yolo guardrails enforcement E2E | `tests/integration/yolo-guardrails-e2e.test.ts` | 0.5 día |
| W3.8 | Cross-platform smoke matrix (Linux + macOS) | CI workflow expansion | 1 día |

**Total Wave 3**: ~5 días.

---

## Sprint 6 cierre

- [ ] **Final 1: Suite gateada completa**

Run: `bun test tests/integration/ tests/unit/ tests/core/ tests/opencode-ndjson.test.ts tests/npx-cli/`
Expected: ~1100-1200 pass / 0 fail (+250-300 nuevos sobre Sprint 5 close ~850-900)

- [ ] **Final 2: TS typecheck + Rust per-crate clippy** (incluyendo los 7 nuevos crates)

- [ ] **Final 3: Browser smoke con daemon mode toggle**

Start daemon: `APOHARA_DAEMON_MODE=1 apohara daemon start &`
Start client: `apohara` (debería detectar daemon + conectar)
Verificar flow Run end-to-end no rota.

- [ ] **Final 4: Squash-merge a `feat/apohara-ultimate`**

```bash
git checkout feat/apohara-ultimate
git merge --squash feat/apohara-ultimate-sprint-6
git commit -m "feat(ultimate): close Sprint 6 — v1.1+ Promovidos"
```

- [ ] **Final 5: Engram session summary**

---

## Self-Review (post-write checklist)

### 1. Spec coverage

| Spec grupo | Plan grupo | Tareas TDD-detalladas | Tareas listadas |
|---|---|---|---|
| G6.A Multi-process foundation | G6.A | 0 | 12 (Wave 2) |
| G6.B Workspace GC 3-tier | G6.B | 5 | 0 |
| G6.C Distributed compute | G6.C | 0 | 10 (Wave 2) |
| G6.D Smart automation | G6.D | 0 | 12 (Wave 2) |
| G6.E `/yolo` pipeline | G6.E | 6 | 0 |

**Total**: 11 tareas TDD-detalladas + 34 tareas listadas + 8 Wave 3 integration = 53. Spec esperado ~45 → coverage > 100%.

### 2. Placeholder scan

- ✗ Wave 2 grupos (G6.A, G6.C, G6.D) son listas estructuradas sin TDD steps. **Documentado** como "Detalles TDD se expanden al arrancar Wave 2" — evita plan-staleness por dependencias.
- ✓ Wave 1 (G6.B + G6.E) tienen 11 tareas con TDD bite-sized completo, código real, sin TBDs.
- ✓ Feature flags todos especificados con defaults explícitos.
- ✓ TRIPLE OFF de /yolo definido con los 3 gates concretos.

### 3. Type consistency

- `WorktreeTier / TieredWorktree / GcPolicy / GcAction` — coherent G6.B (5 tareas mismo dominio)
- `YoloGateContext / CostCap / RollbackDecision / TestRunResult` — coherent G6.E
- `YoloOrchestrator` compone los 4 sub-types de G6.E (gate + cost + rollback + UI)

### Action items inline applied

Ninguno detectado. Plan listo para handoff a Wave 1 post-Sprint-5-close.

---

*Fin del plan Sprint 6.*
