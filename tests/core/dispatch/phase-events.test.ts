import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runDispatchInstruction } from "../../../src/core/dispatch/runner";
import { dispatchPaths, type DispatchInstruction } from "../../../src/core/dispatch/types";

let workspace: string;

beforeEach(async () => {
	workspace = await mkdtemp(join(tmpdir(), "apohara-phase-test-"));
});
afterEach(async () => {
	await rm(workspace, { recursive: true, force: true });
});

test("runner emits 'preparing_workspace' + 'failed' phase events when driver missing", async () => {
	const sessionId = "s1";
	const paths = dispatchPaths(workspace, sessionId);
	const ledgerPath = join(workspace, "ledger.jsonl");
	await writeFile(ledgerPath, "");

	const inst: DispatchInstruction = {
		taskId: "t-1",
		sessionId,
		// biome-ignore lint/suspicious/noExplicitAny: deliberate invalid id
		providerId: "definitely-not-a-real-cli" as any,
		prompt: "x",
		workdir: workspace,
		resultPath: paths.resultFile("t-1"),
		createdAt: Date.now(),
	};
	await runDispatchInstruction(inst, workspace, { ledgerPath });

	const ledger = await readFile(ledgerPath, "utf-8");
	const events = ledger.trim().split("\n").map((l) => JSON.parse(l));
	const phases = events.filter((e) => e.type === "task_phase");
	const phaseNames = phases.map((e) => e.payload.phase);
	expect(phaseNames).toContain("preparing_workspace");
	expect(phaseNames).toContain("failed");
});

test("runner skips phase events when no ledgerPath provided", async () => {
	const sessionId = "s2";
	const paths = dispatchPaths(workspace, sessionId);

	const inst: DispatchInstruction = {
		taskId: "t-2",
		sessionId,
		// biome-ignore lint/suspicious/noExplicitAny: deliberate invalid id
		providerId: "definitely-not-a-real-cli" as any,
		prompt: "x",
		workdir: workspace,
		resultPath: paths.resultFile("t-2"),
		createdAt: Date.now(),
	};
	// No `ledgerPath` — should still produce a result file but no
	// errors and definitely no ledger writes anywhere.
	const result = await runDispatchInstruction(inst, workspace);
	expect(result.status).toBe("failed");
});
