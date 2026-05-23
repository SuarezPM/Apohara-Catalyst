/**
 * Worker runner — given a `DispatchInstruction`, spawn the chosen CLI
 * driver, capture the response, and write a `DispatchResult` to the
 * instruction's `resultPath` atomically.
 *
 * `runDispatchInstruction` ALWAYS resolves (it never throws): a CLI
 * spawn failure, non-zero exit, or timeout becomes a `failed`-status
 * Result. The orchestrator's file watcher reads the result and turns
 * it into the right ledger event. This keeps the contract simple: one
 * instruction → exactly one result file on disk.
 *
 * When the optional `ledgerPath` is set the runner also appends
 * symphony §7.1 `task_phase` events at each milestone
 * (`preparing_workspace`, `launching_agent_process`, `finishing`,
 * `succeeded` / `failed` / `timed_out`). The VerificationTimeline UI
 * consumes those via the SSE → bus bridge for real-time progress.
 */
import { appendFile, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "../persistence/atomicWrite.js";
import {
	BUILTIN_CLI_DRIVERS,
	callCliDriver,
	type CliDriverConfig,
} from "../../providers/cli-driver.js";
import type { RunPhase } from "./state.js";
import {
	dispatchPaths,
	type DispatchInstruction,
	type DispatchResult,
} from "./types.js";

function pickDriver(providerId: string): CliDriverConfig | undefined {
	return BUILTIN_CLI_DRIVERS.find((d) => d.id === providerId);
}

export interface RunDispatchOptions {
	/** When set, the runner appends one `task_phase` ledger event per
	 * phase milestone so the UI's VerificationTimeline can render
	 * real-time progress. Best-effort: failures to append are swallowed
	 * because they must NOT abort the actual worker. */
	ledgerPath?: string;
}

async function emitPhase(
	ledgerPath: string | undefined,
	taskId: string,
	providerId: string,
	phase: RunPhase,
	detail?: string,
): Promise<void> {
	if (!ledgerPath) return;
	const line = `${JSON.stringify({
		id: randomUUID(),
		timestamp: new Date().toISOString(),
		type: "task_phase",
		severity: phase === "failed" || phase === "timed_out" ? "error" : "info",
		taskId,
		payload: { phase, detail },
		metadata: { provider: providerId },
	})}\n`;
	try {
		await appendFile(ledgerPath, line, "utf-8");
	} catch {
		// Phase events are observability only — never block the runner.
	}
}

export async function runDispatchInstruction(
	inst: DispatchInstruction,
	workspace: string,
	opts: RunDispatchOptions = {},
): Promise<DispatchResult> {
	const startedAt = Date.now();
	const paths = dispatchPaths(workspace, inst.sessionId);

	await emitPhase(
		opts.ledgerPath,
		inst.taskId,
		inst.providerId,
		"preparing_workspace",
		`workdir=${workspace}`,
	);

	await mkdir(paths.results, { recursive: true });

	const writeResult = async (result: DispatchResult) => {
		await atomicWriteFile(
			inst.resultPath,
			`${JSON.stringify(result, null, 2)}\n`,
			{ ensureParentDir: true },
		);
		return result;
	};

	const baseResult = {
		taskId: inst.taskId,
		sessionId: inst.sessionId,
		providerId: inst.providerId,
		startedAt,
	};

	const driver = pickDriver(inst.providerId);
	if (!driver) {
		await emitPhase(
			opts.ledgerPath,
			inst.taskId,
			inst.providerId,
			"failed",
			"no driver registered",
		);
		const completedAt = Date.now();
		return writeResult({
			...baseResult,
			status: "failed",
			error: `dispatch: no CLI driver registered for provider "${inst.providerId}"`,
			completedAt,
			durationMs: completedAt - startedAt,
		});
	}

	const messages = inst.systemPrompt
		? [
				{ role: "system" as const, content: inst.systemPrompt },
				{ role: "user" as const, content: inst.prompt },
			]
		: [{ role: "user" as const, content: inst.prompt }];

	await emitPhase(
		opts.ledgerPath,
		inst.taskId,
		inst.providerId,
		"launching_agent_process",
		`binary=${driver.binary}`,
	);

	try {
		// Thread the explicit `workspace` through so the runner-policy
		// gate inside `callCliDriver` resolves the correct
		// `<workspace>/.apohara.json` (not whatever the bun process is
		// cwd'd into right now — see callCliDriver doc-comment for the
		// TOCTOU rationale on concurrent worktrees).
		const llmResponse = await callCliDriver(driver, messages, workspace);
		await emitPhase(
			opts.ledgerPath,
			inst.taskId,
			inst.providerId,
			"finishing",
		);
		const completedAt = Date.now();
		const result = await writeResult({
			...baseResult,
			status: "completed",
			content: llmResponse.content,
			exitCode: 0,
			completedAt,
			durationMs: completedAt - startedAt,
		});
		await emitPhase(
			opts.ledgerPath,
			inst.taskId,
			inst.providerId,
			"succeeded",
			`durationMs=${completedAt - startedAt}`,
		);
		return result;
	} catch (err) {
		const completedAt = Date.now();
		const message = (err as Error).message;
		const status =
			/timed out|timeout/i.test(message) ? ("timed_out" as const) : ("failed" as const);
		await emitPhase(
			opts.ledgerPath,
			inst.taskId,
			inst.providerId,
			status,
			message,
		);
		return writeResult({
			...baseResult,
			status,
			error: message,
			completedAt,
			durationMs: completedAt - startedAt,
		});
	}
}
