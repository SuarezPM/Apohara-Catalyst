import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runReconcilerTick } from "../../../src/core/dispatch/reconciler";
import { dispatchPaths } from "../../../src/core/dispatch/types";

let workspace: string;

beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), "apohara-reconciler-test-"));
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

test("reconciler emits task_failed for stalled instruction", async () => {
	const sessionId = "s1";
	const ledgerPath = join(workspace, "s1.jsonl");
	await writeFile(ledgerPath, "");
	// Instruction created 10 minutes ago, no result file.
	await plantInstruction(sessionId, "t-stale", Date.now() - 10 * 60 * 1000);

	const summary = await runReconcilerTick({
		workspace,
		sessionId,
		ledgerPath,
		stallTimeoutMs: 5 * 60 * 1000,
	});

	expect(summary.scanned).toBe(1);
	expect(summary.stalled).toEqual(["t-stale"]);

	const ledger = await readFile(ledgerPath, "utf-8");
	const events = ledger.trim().split("\n").map((l) => JSON.parse(l));
	const failed = events.find((e) => e.type === "task_failed");
	expect(failed).toBeDefined();
	expect(failed.payload.status).toBe("stalled");
	expect(failed.payload.reason).toBe("reconciler");
});

test("reconciler is idempotent: re-running produces no second event", async () => {
	const sessionId = "s2";
	const ledgerPath = join(workspace, "s2.jsonl");
	await writeFile(ledgerPath, "");
	await plantInstruction(sessionId, "t-stale-2", Date.now() - 10 * 60 * 1000);

	await runReconcilerTick({
		workspace,
		sessionId,
		ledgerPath,
		stallTimeoutMs: 5 * 60 * 1000,
	});
	const after1 = await readFile(ledgerPath, "utf-8");
	const summary2 = await runReconcilerTick({
		workspace,
		sessionId,
		ledgerPath,
		stallTimeoutMs: 5 * 60 * 1000,
	});
	const after2 = await readFile(ledgerPath, "utf-8");
	expect(summary2.stalled).toEqual([]);
	expect(after1).toBe(after2);
});

test("reconciler does NOT touch fresh instructions", async () => {
	const sessionId = "s3";
	const ledgerPath = join(workspace, "s3.jsonl");
	await writeFile(ledgerPath, "");
	await plantInstruction(sessionId, "t-fresh", Date.now());

	const summary = await runReconcilerTick({
		workspace,
		sessionId,
		ledgerPath,
		stallTimeoutMs: 5 * 60 * 1000,
	});
	expect(summary.scanned).toBe(1);
	expect(summary.stalled).toEqual([]);
});
