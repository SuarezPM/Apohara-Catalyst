/**
 * Session-level dispatcher.
 *
 * `dispatchSession` is the entry the bun server's `/api/run` calls
 * AFTER it has written the `session_started` ledger event. For v1 we
 * spawn ONE task per session using the chosen CLI provider — the
 * decomposer hookup that produces a graph of tasks lands in T1.2.
 *
 * For each task:
 *   1. Write the instruction file atomically.
 *   2. Append a `task_scheduled` event to the ledger so the UI's
 *      SSE listener and the bus bridge see it.
 *   3. Invoke `runDispatchInstruction` (in-process for v1) — the
 *      runner writes the result file.
 *   4. The result-file watcher (see `result-watcher.ts`) sees the
 *      write, parses it, and appends the matching `task_completed`
 *      / `task_failed` / `task_timed_out` event.
 *
 * The dispatcher is fire-and-forget from the HTTP handler's POV: the
 * runner promise is intentionally NOT awaited so `/api/run` returns
 * the sessionId immediately and the UI starts tailing the SSE stream
 * while the worker is still running.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "../persistence/atomicWrite.js";
import type { ProviderId } from "../providers/agent-config.js";
import { runDispatchInstruction } from "./runner.js";
import { dispatchPaths, type DispatchInstruction } from "./types.js";

export interface DispatchSessionOptions {
	workspace: string;
	sessionId: string;
	prompt: string;
	systemPrompt?: string;
	providerId: ProviderId;
	timeoutMs?: number;
	/**
	 * Where to append ledger events. Same JSONL file the SSE handler
	 * tails (`<eventsDir>/run-<sessionId>.jsonl`).
	 */
	ledgerPath: string;
}

export interface DispatchedTask {
	taskId: string;
	instructionPath: string;
	resultPath: string;
}

async function appendLedgerEvent(
	ledgerPath: string,
	event: Record<string, unknown>,
): Promise<void> {
	await appendFile(ledgerPath, `${JSON.stringify(event)}\n`, "utf-8");
}

export async function dispatchSession(
	opts: DispatchSessionOptions,
): Promise<DispatchedTask[]> {
	const paths = dispatchPaths(opts.workspace, opts.sessionId);
	await mkdir(paths.tasks, { recursive: true });

	// v1: one task per session. The recursive ExecutorAction chain
	// (setup → coding → cleanup) lands in T1.2; for now we emit a
	// single "coding" task so the runtime path is wired end-to-end.
	const taskId = `t-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
	const instruction: DispatchInstruction = {
		taskId,
		sessionId: opts.sessionId,
		providerId: opts.providerId,
		prompt: opts.prompt,
		systemPrompt: opts.systemPrompt,
		workdir: opts.workspace,
		resultPath: paths.resultFile(taskId),
		timeoutMs: opts.timeoutMs,
		createdAt: Date.now(),
	};
	const instructionPath = paths.taskFile(taskId);
	await atomicWriteFile(
		instructionPath,
		`${JSON.stringify(instruction, null, 2)}\n`,
	);

	await appendLedgerEvent(opts.ledgerPath, {
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		type: "task_scheduled",
		severity: "info",
		taskId,
		payload: {
			providerId: opts.providerId,
			prompt: opts.prompt,
			workdir: opts.workspace,
		},
		metadata: { provider: opts.providerId },
	});

	// Fire-and-forget the runner. The result-file watcher emits the
	// completion / failure ledger event when the result lands.
	void runDispatchInstruction(instruction, opts.workspace).catch(
		async (err) => {
			// Defensive: `runDispatchInstruction` is supposed to ALWAYS
			// write a result file even on internal errors. If it somehow
			// rejects, surface the failure to the ledger so the UI
			// doesn't show the task hanging forever.
			await appendLedgerEvent(opts.ledgerPath, {
				id: randomUUID(),
				timestamp: new Date().toISOString(),
				type: "task_failed",
				severity: "error",
				taskId,
				payload: {
					providerId: opts.providerId,
					error: (err as Error).message,
				},
				metadata: { provider: opts.providerId },
			}).catch(() => {
				/* last-ditch — nothing we can do */
			});
		},
	);

	return [{ taskId, instructionPath, resultPath: paths.resultFile(taskId) }];
}
