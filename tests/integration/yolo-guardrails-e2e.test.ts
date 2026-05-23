/**
 * W3.7 — /yolo guardrails enforcement E2E.
 *
 * Drives the FULL /yolo pipeline end-to-end:
 *
 *   1. Workspace allowlist file (per-workspace marker) — must exist
 *      with non-empty content. Empty file → not allowed.
 *   2. APOHARA_YOLO=1 env var — must be set.
 *   3. UI toggle — must be true (operator opted in this session).
 *
 * All THREE gates must be open. Removing any one disables /yolo. This
 * test wires real filesystem (workspace marker), real env detection,
 * and a real `YoloOrchestrator` instance and verifies:
 *
 *  - canStartRun() returns the boolean AND of all three gates.
 *  - tryReserveSpend() refuses spend whenever canStartRun() is false.
 *  - tryReserveSpend() respects the cost cap even when all gates open.
 *  - shouldRollback() drives the rollback policy on test results
 *    (failures > maxFailures → rollback; errors > 0 → rollback always).
 *  - State transitions are observable in the orchestrator's running
 *    totals (totalSpentUsd grows only on successful reserves).
 */
import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { isWorkspaceYoloAllowed } from "../../src/core/orchestration/yolo-allowlist";
import { YoloOrchestrator } from "../../src/core/orchestration/yolo-orchestrator";
import { isYoloEnabled } from "../../src/core/orchestration/yolo-mode";

let workspace: string;

beforeEach(async () => {
	workspace = await mkdtemp(path.join(tmpdir(), "apohara-yolo-e2e-"));
});

afterEach(async () => {
	await rm(workspace, { recursive: true, force: true });
});

async function arm(): Promise<void> {
	await mkdir(path.join(workspace, ".apohara"), { recursive: true });
	await writeFile(
		path.join(workspace, ".apohara", "yolo-allowed"),
		"approved-by-pablo-2026-05-23",
	);
}

test("triple-gate ALL open: orchestrator allows the run", async () => {
	await arm();
	const wsAllowed = await isWorkspaceYoloAllowed(workspace);
	expect(wsAllowed).toBe(true);
	expect(
		isYoloEnabled({
			env: { APOHARA_YOLO: "1" },
			uiToggle: true,
			workspaceAllowed: wsAllowed,
		}),
	).toBe(true);

	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: true,
		workspaceAllowed: wsAllowed,
		costCap: { maxUsd: 10 },
		rollbackPolicy: { maxFailures: 3 },
	});
	expect(orch.canStartRun()).toBe(true);
});

test("gate 1 (env): APOHARA_YOLO unset → orchestrator refuses run", async () => {
	await arm();
	const wsAllowed = await isWorkspaceYoloAllowed(workspace);
	const orch = new YoloOrchestrator({
		env: {}, // no APOHARA_YOLO
		uiToggle: true,
		workspaceAllowed: wsAllowed,
		costCap: { maxUsd: 10 },
		rollbackPolicy: { maxFailures: 3 },
	});
	expect(orch.canStartRun()).toBe(false);
	expect(orch.tryReserveSpend(1)).toBe(false);
});

test("gate 2 (UI toggle): operator off → orchestrator refuses run", async () => {
	await arm();
	const wsAllowed = await isWorkspaceYoloAllowed(workspace);
	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: false,
		workspaceAllowed: wsAllowed,
		costCap: { maxUsd: 10 },
		rollbackPolicy: { maxFailures: 3 },
	});
	expect(orch.canStartRun()).toBe(false);
	expect(orch.tryReserveSpend(1)).toBe(false);
});

test("gate 3 (allowlist): file missing → orchestrator refuses run", async () => {
	// No arm() call — workspace lacks .apohara/yolo-allowed
	const wsAllowed = await isWorkspaceYoloAllowed(workspace);
	expect(wsAllowed).toBe(false);
	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: true,
		workspaceAllowed: wsAllowed,
		costCap: { maxUsd: 10 },
		rollbackPolicy: { maxFailures: 3 },
	});
	expect(orch.canStartRun()).toBe(false);
});

test("empty allowlist file does NOT count as allowed", async () => {
	await mkdir(path.join(workspace, ".apohara"), { recursive: true });
	await writeFile(path.join(workspace, ".apohara", "yolo-allowed"), "");
	const wsAllowed = await isWorkspaceYoloAllowed(workspace);
	expect(wsAllowed).toBe(false);
});

test("whitespace-only allowlist is rejected (must be deliberate content)", async () => {
	await mkdir(path.join(workspace, ".apohara"), { recursive: true });
	await writeFile(path.join(workspace, ".apohara", "yolo-allowed"), "   \n\n  \n");
	expect(await isWorkspaceYoloAllowed(workspace)).toBe(false);
});

test("cost cap enforced: tryReserve refuses once cumulative spend exceeds cap", async () => {
	await arm();
	const wsAllowed = await isWorkspaceYoloAllowed(workspace);
	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: true,
		workspaceAllowed: wsAllowed,
		costCap: { maxUsd: 5 },
		rollbackPolicy: { maxFailures: 3 },
	});
	expect(orch.tryReserveSpend(2)).toBe(true);
	expect(orch.tryReserveSpend(2)).toBe(true);
	expect(orch.tryReserveSpend(2)).toBe(false); // 2+2+2=6 > 5
	expect(orch.totalSpentUsd()).toBe(4);
});

test("rollback decision: errors > 0 ALWAYS triggers rollback", async () => {
	await arm();
	const wsAllowed = await isWorkspaceYoloAllowed(workspace);
	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: true,
		workspaceAllowed: wsAllowed,
		costCap: { maxUsd: 10 },
		rollbackPolicy: { maxFailures: 100 },
	});
	const d = orch.shouldRollback({ passed: 1000, failed: 0, errors: 1 });
	expect(d.rollback).toBe(true);
	expect(d.reason ?? "").toContain("error");
});

test("rollback decision: failures > threshold triggers rollback", async () => {
	await arm();
	const wsAllowed = await isWorkspaceYoloAllowed(workspace);
	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: true,
		workspaceAllowed: wsAllowed,
		costCap: { maxUsd: 10 },
		rollbackPolicy: { maxFailures: 3 },
	});
	const d = orch.shouldRollback({ passed: 50, failed: 10, errors: 0 });
	expect(d.rollback).toBe(true);
});

test("rollback decision: failures within threshold → no rollback", async () => {
	await arm();
	const wsAllowed = await isWorkspaceYoloAllowed(workspace);
	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: true,
		workspaceAllowed: wsAllowed,
		costCap: { maxUsd: 10 },
		rollbackPolicy: { maxFailures: 5 },
	});
	const d = orch.shouldRollback({ passed: 100, failed: 3, errors: 0 });
	expect(d.rollback).toBe(false);
});

test("revoking allowlist mid-session: a new orchestrator instance refuses", async () => {
	await arm();
	const wsAllowedBefore = await isWorkspaceYoloAllowed(workspace);
	expect(wsAllowedBefore).toBe(true);

	// Simulate operator revoking by deleting the file mid-session.
	await rm(path.join(workspace, ".apohara", "yolo-allowed"));
	const wsAllowedAfter = await isWorkspaceYoloAllowed(workspace);
	expect(wsAllowedAfter).toBe(false);

	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: true,
		workspaceAllowed: wsAllowedAfter,
		costCap: { maxUsd: 10 },
		rollbackPolicy: { maxFailures: 3 },
	});
	expect(orch.canStartRun()).toBe(false);
});

test("full lifecycle: arm → reserve → test fails → rollback decided", async () => {
	await arm();
	const wsAllowed = await isWorkspaceYoloAllowed(workspace);
	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: true,
		workspaceAllowed: wsAllowed,
		costCap: { maxUsd: 20 },
		rollbackPolicy: { maxFailures: 1 },
	});
	expect(orch.canStartRun()).toBe(true);
	expect(orch.tryReserveSpend(1.5)).toBe(true); // LLM call 1
	expect(orch.tryReserveSpend(2.0)).toBe(true); // LLM call 2
	expect(orch.tryReserveSpend(0.5)).toBe(true); // verifier
	const decision = orch.shouldRollback({ passed: 99, failed: 2, errors: 0 });
	expect(decision.rollback).toBe(true);
	expect(orch.totalSpentUsd()).toBeCloseTo(4.0, 5);
});

test("UI cannot create the allowlist file (defense-in-depth)", async () => {
	// The orchestrator MUST NOT auto-create the allowlist marker. The
	// only way to enable gate 3 is operator-side `touch`. We assert
	// the orchestrator constructor with all flags open but no file
	// still refuses if workspaceAllowed=false comes back from disk.
	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: true,
		workspaceAllowed: false, // operator hasn't created the file
		costCap: { maxUsd: 10 },
		rollbackPolicy: { maxFailures: 3 },
	});
	expect(orch.canStartRun()).toBe(false);
	// And no .apohara directory has been auto-created by the orchestrator.
	const fs = await import("node:fs/promises");
	let dirExists = false;
	try {
		await fs.stat(path.join(workspace, ".apohara"));
		dirExists = true;
	} catch {}
	expect(dirExists).toBe(false);
});

test("gate evaluation is pure on the orchestrator-held context (no re-stat)", async () => {
	// Once the orchestrator is constructed with `workspaceAllowed: true`,
	// it doesn't re-stat the file — the value is cached at construction.
	// This guards against TOCTOU-style races and is the operator's
	// rationale for a session-scoped UI toggle.
	await arm();
	const wsAllowed = await isWorkspaceYoloAllowed(workspace);
	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: true,
		workspaceAllowed: wsAllowed,
		costCap: { maxUsd: 10 },
		rollbackPolicy: { maxFailures: 3 },
	});
	expect(orch.canStartRun()).toBe(true);
	// Even after deleting the file, the orchestrator's view does not flip.
	await rm(path.join(workspace, ".apohara", "yolo-allowed"));
	expect(orch.canStartRun()).toBe(true);
});

test("zero cost cap: every reserve is rejected", async () => {
	await arm();
	const wsAllowed = await isWorkspaceYoloAllowed(workspace);
	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: true,
		workspaceAllowed: wsAllowed,
		costCap: { maxUsd: 0 },
		rollbackPolicy: { maxFailures: 3 },
	});
	expect(orch.canStartRun()).toBe(true);
	expect(orch.tryReserveSpend(0.01)).toBe(false);
});
