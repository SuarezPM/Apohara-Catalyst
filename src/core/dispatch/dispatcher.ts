/**
 * Session-level dispatcher.
 *
 * `dispatchSession` is the entry the bun server's `/api/run` calls
 * AFTER it has written the `session_started` ledger event. It builds
 * an `ExecutorAction` chain via `startWorkspace()` and walks it
 * sequentially, emitting one instruction file + ledger event per node.
 *
 * For each `coding` / `follow_up` action:
 *   1. Write the instruction file atomically.
 *   2. Append a `task_scheduled` event to the ledger so the UI's SSE
 *      listener and the bus bridge see it.
 *   3. Run the worker (in-process for v1) — it writes a result file
 *      that the result-watcher converts into a `task_completed` /
 *      `task_failed` ledger event.
 *   4. If the action has a `next`, build the next instruction using
 *      the previous result's content as additional system context
 *      (continuation pattern from symphony §10.3).
 *
 * `script` actions execute a binary (no LLM) and write a synthetic
 * Result with the subprocess's exit code as `exitCode`.
 *
 * The dispatcher is fire-and-forget from the HTTP handler's POV: the
 * full chain walk runs in the background so `/api/run` returns the
 * sessionId immediately and the UI starts tailing the SSE stream
 * while the worker is still running.
 */
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { atomicWriteFile } from "../persistence/atomicWrite.js";
import type { ProviderId } from "../providers/agent-config.js";
import {
	actionChain,
	type ExecutorAction,
	startWorkspace,
} from "./executor-action.js";
import { runDispatchInstruction } from "./runner.js";
import {
	dispatchPaths,
	type DispatchInstruction,
	type DispatchResult,
} from "./types.js";

export interface DispatchSessionOptions {
	workspace: string;
	sessionId: string;
	prompt: string;
	systemPrompt?: string;
	providerId: ProviderId;
	timeoutMs?: number;
	/**
	 * Pre-built ExecutorAction chain. When absent, defaults to the
	 * single-coding chain produced by `startWorkspace`. Callers that
	 * want a setup → coding → review chain pass it in here.
	 */
	chain?: ExecutorAction;
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
	kind: ExecutorAction["kind"];
}

async function appendLedgerEvent(
	ledgerPath: string,
	event: Record<string, unknown>,
): Promise<void> {
	await appendFile(ledgerPath, `${JSON.stringify(event)}\n`, "utf-8");
}

function nextTaskId(): string {
	return `t-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function priorResultAsContext(prior: DispatchResult | null): string | undefined {
	if (!prior || prior.status !== "completed" || !prior.content) return undefined;
	return `Previous step output:\n${prior.content}`;
}

export async function dispatchSession(
	opts: DispatchSessionOptions,
): Promise<DispatchedTask[]> {
	const paths = dispatchPaths(opts.workspace, opts.sessionId);
	await mkdir(paths.tasks, { recursive: true });

	const chain =
		opts.chain ??
		startWorkspace({
			prompt: opts.prompt,
			systemPrompt: opts.systemPrompt,
			providerId: opts.providerId,
		});
	const actions = actionChain(chain);

	// Walk the chain SYNCHRONOUSLY only for the schedule + first
	// instruction; the rest of the chain runs in the background. This
	// keeps `/api/run` snappy while giving the watcher a deterministic
	// first event to display.
	const dispatched: DispatchedTask[] = [];

	for (const action of actions) {
		// `review` and `script` (without `next`) actions are scheduled
		// but their handlers don't yet exist in v1 — we emit a placeholder
		// instruction file so the chain shape is observable, and the
		// runner returns a `failed` result with a clear error explaining
		// the kind isn't wired yet. Future commits flesh these out.
		const taskId = nextTaskId();
		const instructionPath = paths.taskFile(taskId);
		const resultPath = paths.resultFile(taskId);
		const instruction: DispatchInstruction = {
			taskId,
			sessionId: opts.sessionId,
			providerId:
				action.kind === "coding" || action.kind === "follow_up"
					? action.providerId
					: opts.providerId,
			prompt:
				action.kind === "coding" || action.kind === "follow_up"
					? action.prompt
					: action.kind === "script"
						? `script: ${action.command} ${action.args.join(" ")}`
						: `review against criteria: ${action.criteria.join(", ")}`,
			systemPrompt:
				action.kind === "coding" ? action.systemPrompt : undefined,
			workdir: opts.workspace,
			resultPath,
			timeoutMs: opts.timeoutMs,
			createdAt: Date.now(),
		};
		await atomicWriteFile(
			instructionPath,
			`${JSON.stringify(instruction, null, 2)}\n`,
		);
		dispatched.push({ taskId, instructionPath, resultPath, kind: action.kind });
	}

	// Schedule + run the chain step by step. The first action is
	// scheduled synchronously so `/api/run` returns with at least one
	// task_scheduled event visible; the rest are processed in the
	// background.
	void (async () => {
		let prior: DispatchResult | null = null;
		for (let i = 0; i < actions.length; i++) {
			const action = actions[i];
			const task = dispatched[i];

			// Inject prior result as context for follow_up actions only;
			// coding actions intentionally don't get the previous step
			// (that's `follow_up`'s purpose).
			let finalSystem: string | undefined =
				action.kind === "coding" ? action.systemPrompt : undefined;
			if (action.kind === "follow_up") {
				const ctx = priorResultAsContext(prior);
				finalSystem = ctx
					? `${ctx}\n\nNow answer:`
					: undefined;
				// Rewrite the instruction with the augmented system prompt.
				const augmented: DispatchInstruction = {
					...(JSON.parse(
						await readFile(task.instructionPath, "utf-8"),
					) as DispatchInstruction),
					systemPrompt: finalSystem,
				};
				await atomicWriteFile(
					task.instructionPath,
					`${JSON.stringify(augmented, null, 2)}\n`,
				);
			}

			await appendLedgerEvent(opts.ledgerPath, {
				id: randomUUID(),
				timestamp: new Date().toISOString(),
				type: "task_scheduled",
				severity: "info",
				taskId: task.taskId,
				payload: {
					providerId:
						action.kind === "coding" || action.kind === "follow_up"
							? action.providerId
							: opts.providerId,
					prompt:
						action.kind === "coding" || action.kind === "follow_up"
							? action.prompt
							: action.kind === "script"
								? `${action.command} ${action.args.join(" ")}`
								: `review`,
					workdir: opts.workspace,
					kind: action.kind,
					step: i + 1,
					totalSteps: actions.length,
				},
				metadata: {
					provider:
						action.kind === "coding" || action.kind === "follow_up"
							? action.providerId
							: opts.providerId,
				},
			});

			if (action.kind === "coding" || action.kind === "follow_up") {
				try {
					prior = await runDispatchInstruction(
						JSON.parse(
							await readFile(task.instructionPath, "utf-8"),
						) as DispatchInstruction,
						opts.workspace,
						{ ledgerPath: opts.ledgerPath },
					);
				} catch (err) {
					// Defensive — `runDispatchInstruction` is supposed to
					// always write a result. Surface unexpected throws so
					// the UI doesn't hang.
					await appendLedgerEvent(opts.ledgerPath, {
						id: randomUUID(),
						timestamp: new Date().toISOString(),
						type: "task_failed",
						severity: "error",
						taskId: task.taskId,
						payload: { error: (err as Error).message },
						metadata: {
							provider:
								action.kind === "coding" ||
								action.kind === "follow_up"
									? action.providerId
									: opts.providerId,
						},
					}).catch(() => {});
					prior = null;
					break; // abort chain on hard failure
				}
				if (prior.status !== "completed") {
					// Stop the chain — `next` actions presumably depend on
					// this one. The watcher will already have emitted
					// task_failed for the failed step.
					break;
				}
			} else {
				// `script` / `review` kinds are not wired in v1. Write a
				// `failed` result with a clear error so the watcher emits
				// task_failed and the chain stops. (TS already narrows
				// `action.kind` to `"script" | "review"` here, so no
				// `action.providerId` is available — we use the session
				// fallback.)
				const now = Date.now();
				const placeholder: DispatchResult = {
					taskId: task.taskId,
					sessionId: opts.sessionId,
					providerId: opts.providerId,
					status: "failed",
					error: `executor-action kind '${action.kind}' is not wired yet (Stage 8+)`,
					startedAt: now,
					completedAt: now,
					durationMs: 0,
				};
				await atomicWriteFile(
					task.resultPath,
					`${JSON.stringify(placeholder, null, 2)}\n`,
				);
				break;
			}
		}
	})().catch(async (err) => {
		await appendLedgerEvent(opts.ledgerPath, {
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			type: "task_failed",
			severity: "error",
			payload: { error: `chain walker crashed: ${(err as Error).message}` },
			metadata: { provider: opts.providerId },
		}).catch(() => {});
	});

	return dispatched;
}
