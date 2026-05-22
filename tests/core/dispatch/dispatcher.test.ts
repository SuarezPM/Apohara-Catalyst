import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dispatchSession } from "../../../src/core/dispatch/dispatcher";
import { dispatchPaths } from "../../../src/core/dispatch/types";

let workspace: string;

beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), "apohara-dispatch-test-"));
});
afterEach(async () => {
	await rm(workspace, { recursive: true, force: true });
});

test("dispatchSession writes instruction + appends task_scheduled", async () => {
	const sessionId = "test-session-1";
	const ledgerPath = join(workspace, "ledger.jsonl");
	// Skip the actual worker — we only want to assert the
	// orchestrator-side artifacts. Set the disable flag inside the
	// runner module by spoofing the binary: a non-existent driver will
	// short-circuit with a `failed` Result without trying to spawn.
	const tasks = await dispatchSession({
		workspace,
		sessionId,
		prompt: "hello world",
		// biome-ignore lint/suspicious/noExplicitAny: deliberate invalid id
		providerId: "non-existent-cli" as any,
		ledgerPath,
	});

	expect(tasks).toHaveLength(1);
	const { taskId, instructionPath, resultPath } = tasks[0];
	expect(taskId).toMatch(/^t-[a-f0-9]+$/);

	const paths = dispatchPaths(workspace, sessionId);
	expect(instructionPath).toBe(paths.taskFile(taskId));
	expect(resultPath).toBe(paths.resultFile(taskId));

	// Instruction file is on disk and well-formed.
	const instJson = JSON.parse(await readFile(instructionPath, "utf-8"));
	expect(instJson.taskId).toBe(taskId);
	expect(instJson.sessionId).toBe(sessionId);
	expect(instJson.prompt).toBe("hello world");
	expect(instJson.resultPath).toBe(resultPath);

	// Ledger picked up the task_scheduled event.
	const ledger = await readFile(ledgerPath, "utf-8");
	const lines = ledger.trim().split("\n");
	const events = lines.map((l) => JSON.parse(l));
	expect(events.some((e) => e.type === "task_scheduled" && e.taskId === taskId)).toBe(
		true,
	);
});

test("dispatchSession runner writes result file even on bogus provider", async () => {
	const sessionId = "test-session-2";
	const ledgerPath = join(workspace, "ledger.jsonl");
	const tasks = await dispatchSession({
		workspace,
		sessionId,
		prompt: "p",
		// biome-ignore lint/suspicious/noExplicitAny: deliberate invalid id
		providerId: "non-existent-cli" as any,
		ledgerPath,
	});

	// Wait briefly for the fire-and-forget runner to write its result.
	for (let i = 0; i < 30; i++) {
		try {
			await stat(tasks[0].resultPath);
			break;
		} catch {
			await new Promise((r) => setTimeout(r, 50));
		}
	}

	const result = JSON.parse(await readFile(tasks[0].resultPath, "utf-8"));
	expect(result.status).toBe("failed");
	expect(result.error).toMatch(/no CLI driver registered/);
	expect(result.taskId).toBe(tasks[0].taskId);
});
