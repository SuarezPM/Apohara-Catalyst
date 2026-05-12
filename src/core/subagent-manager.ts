/**
 * Subagent Manager - Parallel execution engine for role-labeled subagents.
 * Handles concurrent dispatch (up to 5 agents), timeout, retry with backoff,
 * dependency graph resolution, and full event ledger logging.
 */

import { randomUUID } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { InngestClient } from "../lib/inngest-client";
import { ProviderRouter } from "../providers/router";
import { type RouteResult, routeTask } from "./agent-router";
import type { DecomposedTask } from "./decomposer";
import { IndexerClient, type Memory } from "./indexer-client";
import { EventLedger } from "./ledger";
import type { ProviderId, TaskRole } from "./types";
import { WorktreeManager } from "./worktree-manager";

/**
 * Configuration for SubagentManager
 */
export interface SubagentManagerConfig {
	/** Maximum concurrent agents (default: 5) */
	maxConcurrent: number;
	/** Timeout per task in milliseconds (default: 120000ms = 2min) */
	timeoutMs: number;
	/** Maximum retry attempts (default: 3) */
	maxRetries: number;
	/** Exponential backoff delays in ms (default: [1000, 4000, 16000]) */
	backoffMs: number[];
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: SubagentManagerConfig = {
	maxConcurrent: 5,
	timeoutMs: 120000,
	maxRetries: 3,
	backoffMs: [1000, 4000, 16000],
};

/**
 * Status of a subagent execution
 */
export type SubagentStatus =
	| "pending"
	| "running"
	| "completed"
	| "failed"
	| "timeout";

/**
 * Result of a subagent execution
 */
export interface SubagentResult {
	taskId: string;
	role: TaskRole;
	status: SubagentStatus;
	provider: ProviderId;
	retries: number;
	durationMs: number;
	output: unknown;
	error?: string;
}

/**
 * Event logged to the JSONL file
 */
interface SubagentEvent {
	id: string;
	timestamp: string;
	type: "dispatch" | "start" | "retry" | "result" | "failure";
	taskId: string;
	role: TaskRole;
	provider: ProviderId;
	retries: number;
	durationMs?: number;
	error?: string;
	status: SubagentStatus;
}

/**
 * Task with additional execution metadata
 */
interface TrackedTask {
	id: string;
	description: string;
	dependencies: string[];
	role: TaskRole;
	result?: SubagentResult;
	attempt: number;
	startedAt?: number;
}

/**
 * SubagentManager manages parallel execution of role-labeled subagents.
 */
export class SubagentManager {
	private config: SubagentManagerConfig;
	private runId: string;
	private ledger: EventLedger;
	private worktreeManager: WorktreeManager;
	private providerRouter: ProviderRouter;
	private eventFilePath: string;
	private initialized = false;

	constructor(config: Partial<SubagentManagerConfig> = {}) {
		this.config = { ...DEFAULT_CONFIG, ...config };
		this.runId = new Date().toISOString().replace(/[:.]/g, "-");
		this.ledger = new EventLedger(this.runId);
		this.worktreeManager = new WorktreeManager(this.config.maxConcurrent);
		this.providerRouter = new ProviderRouter();
		this.eventFilePath = join(
			process.cwd(),
			".events",
			`m003-s02-${this.runId}.jsonl`,
		);
	}

	/**
	 * Initializes the event ledger directory.
	 */
	private async init(): Promise<void> {
		if (this.initialized) return;
		await mkdir(dirname(this.eventFilePath), { recursive: true });
		this.initialized = true;
	}

	/**
	 * Logs an event to the JSONL file.
	 */
	private async logEvent(event: SubagentEvent): Promise<void> {
		await this.init();
		const line = `${JSON.stringify(event)}\n`;
		await appendFile(this.eventFilePath, line, "utf-8");
	}

	/**
	 * Determines if an error is retryable (429 or timeout only).
	 */
	private isRetryableError(error: unknown): boolean {
		if (error instanceof Error) {
			const message = error.message.toLowerCase();
			if (message.includes("429") || message.includes("rate limit")) {
				return true;
			}
			if (
				message.includes("timeout") ||
				message.includes("etimedout") ||
				message.includes("econnaborted")
			) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Builds a dependency graph and returns tasks ready to execute.
	 */
	private buildDependencyGraph(
		tasks: DecomposedTask[],
	): Map<string, Set<string>> {
		const graph = new Map<string, Set<string>>();
		for (const task of tasks) {
			graph.set(task.id, new Set(task.dependencies));
		}
		return graph;
	}

	/**
	 * Gets tasks whose dependencies are all satisfied and haven't been dispatched yet.
	 */
	private getReadyTasks(
		tasks: TrackedTask[],
		completed: Set<string>,
	): TrackedTask[] {
		return tasks.filter((task) => {
			if (task.result) return false; // Already completed
			if (task.startedAt) return false; // Already dispatched/in-progress
			for (const dep of task.dependencies) {
				if (!completed.has(dep)) return false;
			}
			return true;
		});
	}

	/**
	 * Executes a single task with timeout and retry logic.
	 */
	private async executeTask(
		task: TrackedTask,
		provider: ProviderId,
	): Promise<SubagentResult> {
		const startTime = Date.now();
		const { timeoutMs, maxRetries } = this.config;
		let lastError: string | undefined;

		// Optional indexer client for persistent memory (redb + Nomic embeddings)
		let indexer: IndexerClient | undefined;
		try {
			indexer = new IndexerClient();
		} catch {
			// Indexer not available
		}

		// Retrieve relevant memories before execution
		let relevantMemories: Memory[] = [];
		if (indexer) {
			try {
				relevantMemories = await indexer.searchMemory(task.description, 10);
				if (relevantMemories.length > 0) {
					console.log(
						`[SubagentManager] Found ${relevantMemories.length} relevant memories for ${task.id}`,
					);
				}
			} catch (err) {
				console.log(
					`[SubagentManager] Indexer retrieval error: ${(err as Error).message}`,
				);
			}
		}

		// Optional Inngest client for durable execution
		let inngest: InngestClient | undefined;
		try {
			inngest = new InngestClient();
		} catch {
			// Inngest not available
		}

		// AbortController for timeout
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				// Log start event
				await this.logEvent({
					id: randomUUID(),
					timestamp: new Date().toISOString(),
					type: attempt === 0 ? "start" : "retry",
					taskId: task.id,
					role: task.role,
					provider,
					retries: attempt,
					status: "running",
				});

				// Display progress
				const elapsed = Math.round((Date.now() - startTime) / 1000);
				console.log(
					`🔄 Agent ${task.id} running... (${elapsed}s elapsed, ${timeoutMs / 1000}s timeout)`,
				);

				// Execute via ProviderRouter (with optional Inngest durability wrapper)
				const executeWithRetry = async () => {
					return await this.providerRouter.completion({
						messages: [
							{
								role: "system" as const,
								content: `You are a task execution agent. Your role is: ${task.role}. Execute the following task: ${task.description}`,
							},
							{ role: "user" as const, content: task.description },
						],
						provider,
						signal: controller.signal,
					});
				};

				let response: { content: string };
				if (inngest?.isConfigured()) {
					// Use Inngest for event tracking only — retry logic is in the outer loop
					console.log(
						`[SubagentManager] Using Inngest durable execution for ${task.id}`,
					);
					response = await inngest.executeStep(
						`task-${task.id}`,
						executeWithRetry,
						{ maxAttempts: 1, retryInterval: 0 },
					);
				} else {
					// Use local execution (retry handled by loop)
					response = await executeWithRetry();
				}

				clearTimeout(timeoutId);
				const durationMs = Date.now() - startTime;

				// Log success
				await this.logEvent({
					id: randomUUID(),
					timestamp: new Date().toISOString(),
					type: "result",
					taskId: task.id,
					role: task.role,
					provider,
					retries: attempt,
					durationMs,
					status: "completed",
				});

				// Store decision in indexer memory for future sessions
				if (indexer) {
					try {
						await indexer.storeMemory(
							`Task ${task.id} (${task.role}): Used ${provider} for task: ${task.description.substring(0, 100)}...`,
							"architecture",
						);
						console.log(
							`[SubagentManager] Stored decision for ${task.id} in indexer`,
						);
					} catch (err) {
						console.log(
							`[SubagentManager] Indexer store error: ${(err as Error).message}`,
						);
					}
				}

				return {
					taskId: task.id,
					role: task.role,
					status: "completed",
					provider,
					retries: attempt,
					durationMs,
					output: response.content,
				};
			} catch (error) {
				lastError = error instanceof Error ? error.message : String(error);
				const isRetryable = this.isRetryableError(error);

				// Don't retry on 401 errors
				if (!isRetryable || lastError.includes("401")) {
					clearTimeout(timeoutId);
					const durationMs = Date.now() - startTime;

					await this.logEvent({
						id: randomUUID(),
						timestamp: new Date().toISOString(),
						type: "failure",
						taskId: task.id,
						role: task.role,
						provider,
						retries: attempt,
						durationMs,
						error: lastError,
						status: "failed",
					});

					return {
						taskId: task.id,
						role: task.role,
						status: "failed",
						provider,
						retries: attempt,
						durationMs,
						output: undefined,
						error: lastError,
					};
				}

				// Retry with backoff
				if (attempt < maxRetries) {
					const backoffTime =
						this.config.backoffMs[
							Math.min(attempt, this.config.backoffMs.length - 1)
						];
					console.log(
						`⚠️ Retrying (${attempt + 1}/${maxRetries}) after ${backoffTime}ms...`,
					);
					await this.sleep(backoffTime);
				}
			}
		}

		// All retries exhausted
		clearTimeout(timeoutId);
		const durationMs = Date.now() - startTime;

		await this.logEvent({
			id: randomUUID(),
			timestamp: new Date().toISOString(),
			type: "failure",
			taskId: task.id,
			role: task.role,
			provider,
			retries: maxRetries,
			durationMs,
			error: lastError,
			status: "failed",
		});

		return {
			taskId: task.id,
			role: task.role,
			status: "failed",
			provider,
			retries: maxRetries,
			durationMs,
			output: undefined,
			error: lastError,
		};
	}

	/**
	 * sleep utility
	 */
	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}

	/**
	 * Executes all tasks in parallel while respecting dependency graph.
	 * @param tasks Array of decomposed tasks to execute
	 * @returns Array of results in order matching input tasks
	 */
	public async executeAll(
		tasks: Array<{
			id: string;
			description: string;
			dependencies: string[];
			role: TaskRole;
		}>,
	): Promise<SubagentResult[]> {
		const trackedTasks: TrackedTask[] = tasks.map((t) => ({
			...t,
			attempt: 0,
		}));

		const completed = new Set<string>();
		const results: SubagentResult[] = [];
		const pending = new Set<string>(tasks.map((t) => t.id));
		const activePromises: Map<string, Promise<void>> = new Map();

		console.log(`🚀 Starting parallel execution of ${tasks.length} tasks`);
		console.log(
			`⚙️  Max concurrent: ${this.config.maxConcurrent}, Timeout: ${this.config.timeoutMs}ms`,
		);

		while (pending.size > 0 || activePromises.size > 0) {
			// Get tasks ready to execute (dependencies satisfied)
			const readyTasks = this.getReadyTasks(trackedTasks, completed);

			// Execute up to max concurrent
			while (
				readyTasks.length > 0 &&
				activePromises.size < this.config.maxConcurrent
			) {
				const task = readyTasks.shift();
				if (!task) continue;

				// Log dispatch event
				await this.logEvent({
					id: randomUUID(),
					timestamp: new Date().toISOString(),
					type: "dispatch",
					taskId: task.id,
					role: task.role,
					provider: "opencode-go" as ProviderId, // placeholder until routed
					retries: 0,
					status: "running",
				});

				// Route to provider
				const routeResult: RouteResult = await routeTask(task.role, {
					id: task.id,
					description: task.description,
				});
				const provider = routeResult.provider;

				// Update dispatch event with actual provider
				await this.logEvent({
					id: randomUUID(),
					timestamp: new Date().toISOString(),
					type: "dispatch",
					taskId: task.id,
					role: task.role,
					provider,
					retries: 0,
					status: "running",
				});

				// Display progress
				const running = activePromises.size + 1;
				const total = tasks.length;
				const timeoutSec = this.config.timeoutMs / 1000;
				console.log(
					`📋 Agent ${running}/${total} running... (${timeoutSec}s timeout)`,
				);

				// Mark task as dispatched to prevent double-dispatch on next loop iteration
				task.startedAt = Date.now();

				// Execute the task
				const worktree = await this.worktreeManager.acquire();
				const promise = this.executeTask(task, provider)
					.then((result) => {
						task.result = result;
						results.push(result);
						completed.add(task.id);
						pending.delete(task.id);

						// Display retry info
						if (result.retries > 0) {
							console.log(`🔄 Task ${task.id}: ${result.retries} retry(s)`);
						}
					})
					.finally(async () => {
						if (worktree) {
							await this.worktreeManager.release(worktree);
						}
						activePromises.delete(task.id);
					});

				activePromises.set(task.id, promise);
				pending.delete(task.id);
			}

			// Wait for at least one task to complete
			if (activePromises.size > 0) {
				const firstComplete = await Promise.race(activePromises.values());
				await firstComplete;
			} else if (pending.size > 0) {
				// No active tasks but pending tasks - shouldn't happen
				break;
			}
		}

		// Print summary table
		this.printSummary(results);

		// Log final status
		const successCount = results.filter((r) => r.status === "completed").length;
		const failCount = results.filter((r) => r.status === "failed").length;
		console.log(
			`\n✅ Execution complete: ${successCount}/${tasks.length} succeeded, ${failCount} failed`,
		);

		return results;
	}

	/**
	 * Prints a summary table of all results.
	 */
	private printSummary(results: SubagentResult[]): void {
		console.log(
			"\n┌─────────────┬────────────┬──────────────┬─────────┬───────────┐",
		);
		console.log(
			"│ Agent       │ Status     │ Provider     │ Retries │ Duration  │",
		);
		console.log(
			"├─────────────┼────────────┼──────────────┼─────────┼───────────┤",
		);

		for (const result of results) {
			const statusIcon =
				result.status === "completed"
					? "✅"
					: result.status === "failed"
						? "❌"
						: result.status === "timeout"
							? "⏱️"
							: "⏳";
			const paddedStatus = result.status.padEnd(10);
			const paddedProvider = result.provider.padEnd(12);
			const paddedRetries = String(result.retries).padEnd(7);
			const paddedDuration = `${result.durationMs}ms`.padEnd(9);
			console.log(
				`│ ${result.taskId.padEnd(11)} │ ${statusIcon} ${paddedStatus} │ ${paddedProvider} │ ${paddedRetries} │ ${paddedDuration} │`,
			);
		}

		console.log(
			"└─────────────┴────────────┴──────────────┴─────────┴───────────┘",
		);
	}

	/**
	 * Gets the path to the event log file.
	 */
	public getEventFilePath(): string {
		return this.eventFilePath;
	}

	/**
	 * Gets the run ID.
	 */
	public getRunId(): string {
		return this.runId;
	}
}

// Re-export types for convenience
export type { DecomposedTask } from "./decomposer";

/**
 * Creates a new SubagentManager instance with default or custom config.
 */
export function createSubagentManager(
	config?: Partial<SubagentManagerConfig>,
): SubagentManager {
	return new SubagentManager(config);
}

export default SubagentManager;
