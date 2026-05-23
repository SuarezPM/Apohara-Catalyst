/**
 * Reconciler — symphony §8.5 stall detector + multi-pass orchestrator.
 *
 * Original behaviour (Pass A, kept via the `runReconcilerTick` legacy
 * entry): every tick (default 30 s) walks every active session's
 * `.apohara/runs/<sessionId>/tasks/` dir, finds instructions that have
 * no matching result file AND whose `createdAt + stallTimeoutMs <
 * now`, and synthesizes a `task_failed` ledger event with
 * `error: "stalled..."`.
 *
 * G5.B.2 (symphony hallazgo 5 PARCIAL → COMPLETO) introduces the
 * pluggable pass orchestrator `runReconcilerPasses`. The v1.0 in-scope
 * passes are:
 *
 *   Pass A — stall detection (`PASS_STALL_DETECTION`). What the legacy
 *            tick already did.
 *   Pass E — blocked-state aging (`PASS_BLOCKED_AGING`). When an
 *            instruction carries `blockedSince` (set by G5.B.3 once a
 *            permission_request or approval_required interrupt fires),
 *            and that age exceeds `blockedAgingMs`, we emit a
 *            `needs_operator` ledger event so the UI's Blocked / Needs
 *            Operator column flags it.
 *
 * Passes B / C / D (tracker state refresh, missing-issue cleanup,
 * drift detection vs symbol manifest) need live couplings the v1.0
 * scope deferred (`packages/github-bridge/`, the symbol manifest).
 * They can be added by appending more entries to `BUILTIN_PASSES`
 * without touching call-sites.
 *
 * Each pass is responsible for its own idempotency: passing a session
 * already reconciled MUST produce zero side effects.
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
	/** Default 5 min. A task in `blocked` state that hasn't moved in
	 * this much time is escalated via `needs_operator`. */
	blockedAgingMs?: number;
}

/**
 * Optional `blockedSince` + `blockedReason` carried by instructions
 * paused mid-flight. The legacy DispatchInstruction shape doesn't
 * include these (they're undefined on most tasks); when present, the
 * blocked-aging pass uses them to detect stuck operator inputs.
 */
export type BlockedReason =
	| "approval_required"
	| "user_input_required"
	| "mcp_elicitation"
	| "stalled_after_input_request"
	| "provider_rejected";

interface BlockedInstruction extends DispatchInstruction {
	blockedSince?: number;
	blockedReason?: BlockedReason;
}

const DEFAULT_STALL_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_BLOCKED_AGING_MS = 5 * 60 * 1000;

export interface ReconcileSummary {
	scanned: number;
	stalled: string[];
}

export interface ReconcilePassResult {
	name: string;
	scanned: number;
	affected: string[];
}

export interface ReconcileReport {
	passResults: ReconcilePassResult[];
	totalAffected: string[];
}

export interface ReconcilePass {
	name: string;
	run(
		ctx: ReconcilePassContext,
	): Promise<ReconcilePassResult>;
}

export interface ReconcilePassContext {
	workspace: string;
	sessionId: string;
	ledgerPath: string;
	stallTimeoutMs: number;
	blockedAgingMs: number;
}

/**
 * Helper — load + parse all instruction files for a session, skipping
 * tmp / non-json / unreadable. Shared by passes that need to scan the
 * `tasks/` directory.
 */
async function loadInstructions(
	workspace: string,
	sessionId: string,
): Promise<{ taskId: string; instruction: BlockedInstruction }[]> {
	const paths = dispatchPaths(workspace, sessionId);
	let entries: string[];
	try {
		entries = await readdir(paths.tasks);
	} catch {
		return [];
	}
	const out: { taskId: string; instruction: BlockedInstruction }[] = [];
	for (const entry of entries) {
		if (extname(entry) !== ".json") continue;
		if (entry.startsWith(".tmp.")) continue;
		const taskId = entry.slice(0, -".json".length);
		try {
			const raw = await readFile(paths.taskFile(taskId), "utf-8");
			out.push({ taskId, instruction: JSON.parse(raw) as BlockedInstruction });
		} catch {
			// mid-write or corrupted — try again next tick
		}
	}
	return out;
}

/**
 * Pass A — Stall detection. Same logic as the legacy
 * `runReconcilerTick`, packaged as a Pass for the orchestrator.
 */
export const PASS_STALL_DETECTION: ReconcilePass = {
	name: "stall_detection",
	async run(ctx) {
		const paths = dispatchPaths(ctx.workspace, ctx.sessionId);
		const summary: ReconcilePassResult = {
			name: "stall_detection",
			scanned: 0,
			affected: [],
		};
		const all = await loadInstructions(ctx.workspace, ctx.sessionId);
		const now = Date.now();

		for (const { taskId, instruction } of all) {
			summary.scanned += 1;
			// If the result file already exists, the watcher handled it.
			let alreadyResulted = false;
			try {
				await stat(paths.resultFile(taskId));
				alreadyResulted = true;
			} catch {
				/* expected — no result yet */
			}
			if (alreadyResulted) continue;
			const elapsed = now - instruction.createdAt;
			if (elapsed < ctx.stallTimeoutMs) continue;

			summary.affected.push(taskId);

			const result: DispatchResult = {
				taskId,
				sessionId: ctx.sessionId,
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
				ctx.ledgerPath,
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
						stallTimeoutMs: ctx.stallTimeoutMs,
					},
					metadata: { provider: instruction.providerId },
				})}\n`,
				"utf-8",
			);
		}
		return summary;
	},
};

/**
 * Pass E — Blocked aging. For instructions with `blockedSince` set,
 * if `now - blockedSince > blockedAgingMs` AND no `needs_operator`
 * event already fired for this taskId (idempotency), emit one.
 *
 * We achieve idempotency by tagging the result-side: we drop a
 * "marker" file under `.apohara/runs/<sessionId>/needs-operator/<taskId>`
 * (atomic write). Subsequent ticks short-circuit on its presence.
 */
export const PASS_BLOCKED_AGING: ReconcilePass = {
	name: "blocked_aging",
	async run(ctx) {
		const root = `${ctx.workspace}/.apohara/runs/${ctx.sessionId}/needs-operator`;
		const summary: ReconcilePassResult = {
			name: "blocked_aging",
			scanned: 0,
			affected: [],
		};
		const all = await loadInstructions(ctx.workspace, ctx.sessionId);
		const now = Date.now();

		for (const { taskId, instruction } of all) {
			summary.scanned += 1;
			if (instruction.blockedSince === undefined) continue;
			const age = now - instruction.blockedSince;
			if (age < ctx.blockedAgingMs) continue;

			// Idempotency marker — short-circuit if we already escalated.
			let alreadyEscalated = false;
			try {
				await stat(`${root}/${taskId}`);
				alreadyEscalated = true;
			} catch {
				/* expected — first time escalating */
			}
			if (alreadyEscalated) continue;

			summary.affected.push(taskId);

			await atomicWriteFile(
				`${root}/${taskId}`,
				`${JSON.stringify({ at: now, age, reason: instruction.blockedReason })}\n`,
				{ ensureParentDir: true },
			);

			await appendFile(
				ctx.ledgerPath,
				`${JSON.stringify({
					id: randomUUID(),
					timestamp: new Date().toISOString(),
					type: "needs_operator",
					severity: "warning",
					taskId,
					payload: {
						blockedReason: instruction.blockedReason ?? "unknown",
						blockedAgeMs: age,
						blockedAgingMs: ctx.blockedAgingMs,
					},
					metadata: { provider: instruction.providerId },
				})}\n`,
				"utf-8",
			);
		}
		return summary;
	},
};

export const BUILTIN_PASSES: ReconcilePass[] = [
	PASS_STALL_DETECTION,
	PASS_BLOCKED_AGING,
];

export interface ReconcilePassOptions extends ReconcileOptions {
	/** When unset, runs the legacy `BUILTIN_PASSES` set (stall + blocked). */
	passes?: ReconcilePass[];
}

export async function runReconcilerPasses(
	opts: ReconcilePassOptions,
): Promise<ReconcileReport> {
	const ctx: ReconcilePassContext = {
		workspace: opts.workspace,
		sessionId: opts.sessionId,
		ledgerPath: opts.ledgerPath,
		stallTimeoutMs: opts.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS,
		blockedAgingMs: opts.blockedAgingMs ?? DEFAULT_BLOCKED_AGING_MS,
	};
	const passes = opts.passes ?? BUILTIN_PASSES;
	const passResults: ReconcilePassResult[] = [];
	const totalAffected: string[] = [];
	for (const pass of passes) {
		const result = await pass.run(ctx);
		passResults.push(result);
		totalAffected.push(...result.affected);
	}
	return { passResults, totalAffected };
}

/**
 * Legacy entry kept for back-compat: every existing call site (Stage
 * 8 wire-up, tests, drift-probe) treats the reconciler as a single
 * stall-detection function. The new pass orchestrator is the
 * forward-looking shape.
 */
export async function runReconcilerTick(
	opts: ReconcileOptions,
): Promise<ReconcileSummary> {
	const report = await runReconcilerPasses({
		...opts,
		passes: [PASS_STALL_DETECTION],
	});
	const stallResult = report.passResults[0];
	return {
		scanned: stallResult?.scanned ?? 0,
		stalled: stallResult?.affected ?? [],
	};
}
