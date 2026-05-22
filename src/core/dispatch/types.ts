/**
 * Dispatch types — instruction + result files exchanged between the
 * orchestrator and the CLI worker subprocess.
 *
 * The handoff is filesystem-based (claude-octopus / agentrail pattern):
 *   - The orchestrator atomically writes an Instruction JSON.
 *   - A worker subprocess reads it, spawns the chosen CLI, captures
 *     the agent's text response, and atomically writes a Result JSON
 *     to the path the instruction names.
 *   - The orchestrator's file watcher sees the result land and emits
 *     `task_completed` / `task_failed` events to the ledger, which the
 *     UI bus already consumes.
 *
 * Why filesystem rather than a daemon:
 *   - Survives orchestrator crash (the result file is durable).
 *   - No socket / port lifecycle.
 *   - The same shape works for in-process workers AND remote SSH
 *     workers (Stage 9+ optional).
 *   - Audit trail is just `ls .apohara/runs/`.
 */
import type { ProviderId } from "../providers/agent-config.js";

export type DispatchTaskStatus =
	| "completed"
	| "failed"
	| "aborted"
	| "timed_out";

/**
 * Instruction the orchestrator hands to a worker. The worker reads
 * this file, spawns the CLI, and writes its `Result` to
 * `resultPath`. Caller MUST atomically write the instruction file
 * BEFORE spawning the worker to avoid a race where the worker reads
 * a half-written instruction.
 */
export interface DispatchInstruction {
	taskId: string;
	sessionId: string;
	providerId: ProviderId;
	prompt: string;
	systemPrompt?: string;
	workdir: string;
	resultPath: string;
	/** Extra env to merge AFTER §0.4 sanitization. */
	env?: Record<string, string>;
	/** Hard wall-clock timeout for the entire CLI invocation. */
	timeoutMs?: number;
	createdAt: number;
}

/** Result the worker writes back. Always JSON-parseable. */
export interface DispatchResult {
	taskId: string;
	sessionId: string;
	providerId: ProviderId;
	status: DispatchTaskStatus;
	/** Agent text response on success; trimmed. */
	content?: string;
	/** Human-readable error reason on non-`completed` status. */
	error?: string;
	exitCode?: number;
	stderr?: string;
	startedAt: number;
	completedAt: number;
	durationMs: number;
}

/**
 * Canonical on-disk layout under the workspace's `.apohara/` dir.
 * `<workspace>/.apohara/runs/<sessionId>/tasks/<taskId>.json`     (instruction)
 * `<workspace>/.apohara/runs/<sessionId>/results/<taskId>.json`   (result)
 * `<workspace>/.apohara/runs/<sessionId>/stderr/<taskId>.log`     (worker stderr)
 *
 * These are intentionally NOT under `.events/` so the SSE ledger
 * (which tails `.events/run-*.jsonl`) and the dispatch state stay
 * cleanly separated.
 */
export function dispatchPaths(workspace: string, sessionId: string) {
	const root = `${workspace}/.apohara/runs/${sessionId}`;
	return {
		root,
		tasks: `${root}/tasks`,
		results: `${root}/results`,
		stderr: `${root}/stderr`,
		taskFile: (taskId: string) => `${root}/tasks/${taskId}.json`,
		resultFile: (taskId: string) => `${root}/results/${taskId}.json`,
		stderrFile: (taskId: string) => `${root}/stderr/${taskId}.log`,
	};
}
