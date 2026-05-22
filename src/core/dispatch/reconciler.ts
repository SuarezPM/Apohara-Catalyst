/**
 * Reconciler — symphony §8.5 stall detector.
 *
 * Every tick (default 30 s) the reconciler walks every active session's
 * `.apohara/runs/<sessionId>/tasks/` dir, finds instructions that have
 * no matching result file AND whose `createdAt + stallTimeoutMs <
 * now`, and synthesizes a `task_failed` ledger event with
 * `error: "stalled..."`. Without this, a worker that crashed before
 * writing a result file leaves the task hanging in `ready` /
 * `dispatched` forever from the UI's POV.
 *
 * The reconciler does NOT try to kill any process — by the time we
 * detect a stall the worker is already gone (or unresponsive, which is
 * effectively the same from the orchestrator's POV). It only writes
 * the synthetic result file so the result-watcher's normal path
 * surfaces `task_failed` to the UI.
 *
 * `runReconcilerTick` is idempotent: re-running it on a session
 * already reconciled produces zero side effects.
 */
import { appendFile, readFile, readdir, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { atomicWriteFile } from "../persistence/atomicWrite.js";
import {
	dispatchPaths,
	type DispatchInstruction,
	type DispatchResult,
} from "./types.js";

export interface ReconcileOptions {
	workspace: string;
	sessionId: string;
	ledgerPath: string;
	/** Default 5 min. A task whose instruction landed more than this
	 * ago with no result yet is treated as stalled. */
	stallTimeoutMs?: number;
}

const DEFAULT_STALL_TIMEOUT_MS = 5 * 60 * 1000;

export interface ReconcileSummary {
	scanned: number;
	stalled: string[];
}

export async function runReconcilerTick(
	opts: ReconcileOptions,
): Promise<ReconcileSummary> {
	const stallTimeoutMs = opts.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS;
	const paths = dispatchPaths(opts.workspace, opts.sessionId);
	const summary: ReconcileSummary = { scanned: 0, stalled: [] };

	let taskEntries: string[];
	try {
		taskEntries = await readdir(paths.tasks);
	} catch {
		return summary; // no tasks dir yet
	}

	const now = Date.now();
	for (const entry of taskEntries) {
		if (extname(entry) !== ".json") continue;
		if (entry.startsWith(".tmp.")) continue;
		summary.scanned += 1;
		const taskId = entry.slice(0, -".json".length);

		// If the result file already exists, the watcher handled it.
		let alreadyResulted = false;
		try {
			await stat(paths.resultFile(taskId));
			alreadyResulted = true;
		} catch {
			/* expected — no result yet */
		}
		if (alreadyResulted) continue;

		// Load the instruction so we can check its age and carry the
		// provider id into the synthetic result.
		let instruction: DispatchInstruction;
		try {
			const raw = await readFile(paths.taskFile(taskId), "utf-8");
			instruction = JSON.parse(raw) as DispatchInstruction;
		} catch {
			continue; // unreadable / mid-write — try again next tick
		}

		const elapsed = now - instruction.createdAt;
		if (elapsed < stallTimeoutMs) continue;

		summary.stalled.push(taskId);

		// Synthesize a `failed` result. The watcher's readdir will pick
		// it up and emit `task_failed`. We bypass the watcher for the
		// ledger append below so the UI sees a CLEAR "stalled" reason
		// even before the watcher's next poll tick.
		const result: DispatchResult = {
			taskId,
			sessionId: opts.sessionId,
			providerId: instruction.providerId,
			status: "failed",
			error: `reconciler: stalled after ${Math.round(elapsed / 1000)}s with no result`,
			startedAt: instruction.createdAt,
			completedAt: now,
			durationMs: elapsed,
		};
		await atomicWriteFile(
			paths.resultFile(taskId),
			`${JSON.stringify(result, null, 2)}\n`,
			{ ensureParentDir: true },
		);

		await appendFile(
			opts.ledgerPath,
			`${JSON.stringify({
				id: randomUUID(),
				timestamp: new Date().toISOString(),
				type: "task_failed",
				severity: "error",
				taskId,
				payload: {
					status: "stalled",
					reason: "reconciler",
					elapsedMs: elapsed,
					stallTimeoutMs,
				},
				metadata: { provider: instruction.providerId },
			})}\n`,
			"utf-8",
		);
	}

	return summary;
}
