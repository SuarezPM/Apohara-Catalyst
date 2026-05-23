/**
 * Symphony §5 — reconciliation tick passes (G5.B.2).
 *
 * The original `runReconcilerTick` did exactly ONE pass (stall
 * detection by createdAt + stallTimeoutMs). The audit hallazgo 5
 * called for an orchestrator of passes A→E. v1.0 in-scope passes:
 *
 *   Pass A: stall detection (already implemented).
 *   Pass E: blocked-state aging — tasks marked `blocked` longer than
 *           `blockedAgingMs` get a `needs_operator` ledger event
 *           so the UI's Blocked / Needs Operator column flags them.
 *
 * Passes B/C (tracker state + missing-issue cleanup) are out of scope
 * for v1.0 (they require live github-bridge coupling — explicitly
 * deferred per spec).
 *
 * This test file verifies:
 *   (a) the legacy `runReconcilerTick(opts)` shape still works (Pass A
 *       only) for callers that haven't migrated.
 *   (b) the new `runReconcilerPasses(opts)` shape runs the configured
 *       passes in order and aggregates summaries.
 *   (c) Pass E surfaces blocked-aging events without touching stall
 *       events.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	PASS_BLOCKED_AGING,
	PASS_STALL_DETECTION,
	runReconcilerPasses,
	runReconcilerTick,
} from "../../../src/core/dispatch/reconciler";
import { dispatchPaths } from "../../../src/core/dispatch/types";

let workspace: string;

beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), "apohara-reconciler-passes-"));
});
afterEach(async () => {
	await rm(workspace, { recursive: true, force: true });
});

async function plantInstruction(
	sessionId: string,
	taskId: string,
	createdAt: number,
): Promise<void> {
	const paths = dispatchPaths(workspace, sessionId);
	await mkdir(paths.tasks, { recursive: true });
	const instruction = {
		taskId,
		sessionId,
		providerId: "claude-code-cli",
		prompt: "test",
		workdir: workspace,
		resultPath: paths.resultFile(taskId),
		createdAt,
	};
	await writeFile(paths.taskFile(taskId), JSON.stringify(instruction));
}

test("runReconcilerPasses runs PASS_STALL_DETECTION (back-compat)", async () => {
	const sessionId = "s-a";
	const ledgerPath = join(workspace, "s-a.jsonl");
	await writeFile(ledgerPath, "");
	await plantInstruction(sessionId, "t-stale", Date.now() - 10 * 60 * 1000);

	const report = await runReconcilerPasses({
		workspace,
		sessionId,
		ledgerPath,
		stallTimeoutMs: 5 * 60 * 1000,
		passes: [PASS_STALL_DETECTION],
	});

	expect(report.passResults).toHaveLength(1);
	expect(report.passResults[0]?.name).toBe("stall_detection");
	expect(report.passResults[0]?.affected).toEqual(["t-stale"]);
	expect(report.totalAffected).toEqual(["t-stale"]);
});

test("runReconcilerPasses Pass E emits `needs_operator` for aged blocked rows", async () => {
	const sessionId = "s-b";
	const ledgerPath = join(workspace, "s-b.jsonl");
	const paths = dispatchPaths(workspace, sessionId);
	await mkdir(paths.tasks, { recursive: true });

	// Two `blocked` rows: one fresh, one aged
	const blockedAgingMs = 3 * 60 * 1000; // 3 min
	const aged = {
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
	const fresh = {
		taskId: "t-blocked-fresh",
		sessionId,
		providerId: "claude-code-cli" as const,
		prompt: "x",
		workdir: workspace,
		resultPath: paths.resultFile("t-blocked-fresh"),
		createdAt: Date.now(),
		blockedSince: Date.now() - 60 * 1000,
		blockedReason: "user_input_required" as const,
	};
	await writeFile(paths.taskFile("t-blocked-aged"), JSON.stringify(aged));
	await writeFile(paths.taskFile("t-blocked-fresh"), JSON.stringify(fresh));
	await writeFile(ledgerPath, "");

	const report = await runReconcilerPasses({
		workspace,
		sessionId,
		ledgerPath,
		// Disable Pass A so fresh-instruction stall logic doesn't fire.
		stallTimeoutMs: 60 * 60 * 1000,
		blockedAgingMs,
		passes: [PASS_BLOCKED_AGING],
	});

	expect(report.passResults[0]?.name).toBe("blocked_aging");
	expect(report.passResults[0]?.affected).toEqual(["t-blocked-aged"]);

	const ledger = await readFile(ledgerPath, "utf-8");
	const events = ledger.trim().split("\n").map((l) => JSON.parse(l));
	const needsOp = events.find((e) => e.type === "needs_operator");
	expect(needsOp).toBeDefined();
	expect(needsOp.taskId).toBe("t-blocked-aged");
	expect(needsOp.payload.blockedReason).toBe("approval_required");
});

test("runReconcilerPasses is idempotent across passes", async () => {
	const sessionId = "s-c";
	const ledgerPath = join(workspace, "s-c.jsonl");
	const paths = dispatchPaths(workspace, sessionId);
	await mkdir(paths.tasks, { recursive: true });
	const blocked = {
		taskId: "t-blocked",
		sessionId,
		providerId: "claude-code-cli" as const,
		prompt: "x",
		workdir: workspace,
		resultPath: paths.resultFile("t-blocked"),
		createdAt: Date.now() - 10 * 60 * 1000,
		blockedSince: Date.now() - 5 * 60 * 1000,
		blockedReason: "approval_required" as const,
	};
	await writeFile(paths.taskFile("t-blocked"), JSON.stringify(blocked));
	await writeFile(ledgerPath, "");

	await runReconcilerPasses({
		workspace,
		sessionId,
		ledgerPath,
		blockedAgingMs: 60 * 1000,
		passes: [PASS_BLOCKED_AGING],
	});
	const after1 = await readFile(ledgerPath, "utf-8");
	await runReconcilerPasses({
		workspace,
		sessionId,
		ledgerPath,
		blockedAgingMs: 60 * 1000,
		passes: [PASS_BLOCKED_AGING],
	});
	const after2 = await readFile(ledgerPath, "utf-8");
	expect(after1).toBe(after2);
});

test("legacy runReconcilerTick still works (Pass A only)", async () => {
	const sessionId = "s-d";
	const ledgerPath = join(workspace, "s-d.jsonl");
	await writeFile(ledgerPath, "");
	await plantInstruction(sessionId, "t-stale", Date.now() - 10 * 60 * 1000);

	const summary = await runReconcilerTick({
		workspace,
		sessionId,
		ledgerPath,
		stallTimeoutMs: 5 * 60 * 1000,
	});
	expect(summary.stalled).toEqual(["t-stale"]);
});
