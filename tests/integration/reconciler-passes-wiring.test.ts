/**
 * G7.5.A.4 — Reconciler passes wiring integration test.
 *
 * Sprint 5 G5.B.2 entregó `runReconcilerPasses` (multi-pass:
 * stall_detection + blocked_aging). Sin embargo el dev server en
 * `packages/desktop/src/server.ts` seguía llamando al legacy
 * `runReconcilerTick` (single-pass, sólo stall) en el setInterval.
 *
 * Esta suite verifica DOS cosas:
 *
 *   1. La API `runReconcilerPasses` se ejecuta sobre un ledger +
 *      workspace mínimos y devuelve la forma esperada
 *      (`passResults[]` con stall_detection + blocked_aging,
 *      `totalAffected[]` agregado). Esto es la garantía contractual
 *      contra la cual el server.ts está cableado.
 *
 *   2. `packages/desktop/src/server.ts` importa y llama a
 *      `runReconcilerPasses`, NO al legacy `runReconcilerTick(`. Esto
 *      es el test "estructural" — si alguien revierte el cableado en
 *      un futuro merge, este test rompe.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReconcilerPasses } from "../../src/core/dispatch/reconciler";
import { dispatchPaths } from "../../src/core/dispatch/types";

let workspace: string;

beforeEach(async () => {
  workspace = await mkdtemp(join(tmpdir(), "apohara-passes-wiring-"));
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

test("runReconcilerPasses runs default multi-pass (stall + blocked_aging) and ages blocked tasks", async () => {
  const sessionId = "s-wiring";
  const ledgerPath = join(workspace, "s-wiring.jsonl");
  const paths = dispatchPaths(workspace, sessionId);
  await mkdir(paths.tasks, { recursive: true });
  await writeFile(ledgerPath, "");

  // One stalled instruction (Pass A target): createdAt 10 min ago, no
  // result file → must be flagged by stall_detection.
  const stalled = {
    taskId: "t-stalled",
    sessionId,
    providerId: "claude-code-cli" as const,
    prompt: "x",
    workdir: workspace,
    resultPath: paths.resultFile("t-stalled"),
    createdAt: Date.now() - 10 * 60 * 1000,
  };
  await writeFile(paths.taskFile("t-stalled"), JSON.stringify(stalled));

  // One aged blocked instruction (Pass E target): blockedSince 5 min
  // ago, with blockedAgingMs=3 min → must be flagged by blocked_aging.
  const blockedAged = {
    taskId: "t-blocked-aged",
    sessionId,
    providerId: "claude-code-cli" as const,
    prompt: "x",
    workdir: workspace,
    resultPath: paths.resultFile("t-blocked-aged"),
    createdAt: Date.now() - 10 * 60 * 1000,
    blockedSince: Date.now() - 5 * 60 * 1000,
    blockedReason: "approval_required" as const,
  };
  await writeFile(
    paths.taskFile("t-blocked-aged"),
    JSON.stringify(blockedAged),
  );

  // Default BUILTIN_PASSES = [PASS_STALL_DETECTION, PASS_BLOCKED_AGING].
  const report = await runReconcilerPasses({
    workspace,
    sessionId,
    ledgerPath,
    stallTimeoutMs: 5 * 60 * 1000,
    blockedAgingMs: 3 * 60 * 1000,
  });

  // Shape: passResults length >= 1 (actually 2 default passes).
  expect(report.passResults.length).toBeGreaterThanOrEqual(1);
  const passNames = report.passResults.map((p) => p.name);
  expect(passNames).toContain("stall_detection");
  expect(passNames).toContain("blocked_aging");

  // totalAffected aggregates both passes' affected tasks.
  expect(report.totalAffected).toContain("t-stalled");
  expect(report.totalAffected).toContain("t-blocked-aged");

  // The blocked_aging pass writes a `needs_operator` event to the
  // ledger — proves the multi-pass orchestrator is wired e2e, not just
  // returning a shape.
  const ledger = await readFile(ledgerPath, "utf-8");
  const events = ledger
    .trim()
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
  const needsOp = events.find((e) => e.type === "needs_operator");
  expect(needsOp).toBeDefined();
  expect(needsOp.taskId).toBe("t-blocked-aged");
});

test("server.ts imports and calls runReconcilerPasses, not legacy runReconcilerTick", async () => {
  const content = await readFile(
    new URL("../../packages/desktop/src/server.ts", import.meta.url),
    "utf-8",
  );
  expect(content).toContain("runReconcilerPasses");
  // No CALL site to the legacy function. The export may still exist
  // in reconciler.ts for back-compat, but server.ts must not call it.
  expect(content).not.toMatch(/runReconcilerTick\(/);
});
