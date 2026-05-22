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
 */
import { mkdir } from "node:fs/promises";
import { atomicWriteFile } from "../persistence/atomicWrite.js";
import {
	BUILTIN_CLI_DRIVERS,
	callCliDriver,
	type CliDriverConfig,
} from "../../providers/cli-driver.js";
import {
	dispatchPaths,
	type DispatchInstruction,
	type DispatchResult,
} from "./types.js";

function pickDriver(providerId: string): CliDriverConfig | undefined {
	return BUILTIN_CLI_DRIVERS.find((d) => d.id === providerId);
}

export async function runDispatchInstruction(
	inst: DispatchInstruction,
	workspace: string,
): Promise<DispatchResult> {
	const startedAt = Date.now();
	const paths = dispatchPaths(workspace, inst.sessionId);
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

	try {
		const llmResponse = await callCliDriver(driver, messages);
		const completedAt = Date.now();
		return writeResult({
			...baseResult,
			status: "completed",
			content: llmResponse.content,
			exitCode: 0,
			completedAt,
			durationMs: completedAt - startedAt,
		});
	} catch (err) {
		const completedAt = Date.now();
		const message = (err as Error).message;
		// Heuristic: messages that mention "timed out" / "timeout" map to
		// `timed_out` so the watcher can route them through the retry
		// path; everything else is a generic failure.
		const status =
			/timed out|timeout/i.test(message) ? ("timed_out" as const) : ("failed" as const);
		return writeResult({
			...baseResult,
			status,
			error: message,
			completedAt,
			durationMs: completedAt - startedAt,
		});
	}
}
