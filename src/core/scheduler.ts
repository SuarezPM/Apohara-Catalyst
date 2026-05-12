import type { LLMMessage } from "../providers/router";
import { type ProviderId, ProviderRouter } from "../providers/router";
import { ContextForgeClient } from "./contextforge-client";
import type { DecomposedTask } from "./decomposer";
import { IsolationEngine, type IsolationResult } from "./isolation";
import { EventLedger } from "./ledger";
import { StateMachine } from "./state";
import type { Task } from "./types";

export interface SchedulerConfig {
	worktreePoolSize: number;
	cwd?: string;
}

export interface TaskExecutionResult {
	taskId: string;
	status: "success" | "error";
	output?: string;
	error?: string;
	worktreeId: string;
}

export class ParallelScheduler {
	private isolationEngine: IsolationEngine;
	private stateMachine: StateMachine;
	private ledger: EventLedger;
	private providerRouter: ProviderRouter;
	// M015.2 — best-effort sidecar client. `null` unless CONTEXTFORGE_ENABLED=1.
	private contextforge: ContextForgeClient | null = null;
	private config: SchedulerConfig;
	private worktrees: Map<string, string>; // worktreeId -> path
	private activeTasks: Map<string, DecomposedTask>; // worktreeId -> task
	private initialized = false;

	constructor(
		isolationEngine?: IsolationEngine,
		stateMachine?: StateMachine,
		ledger?: EventLedger,
		providerRouter?: ProviderRouter,
		config?: Partial<SchedulerConfig>,
	) {
		this.isolationEngine = isolationEngine || new IsolationEngine();
		this.stateMachine = stateMachine || new StateMachine();
		this.ledger = ledger || new EventLedger();
		this.providerRouter = providerRouter || new ProviderRouter();
		// M015.2 — one ContextForge client per scheduler; reuses the same
		// ledger so register/optimize/unavailable events join the chain.
		this.contextforge = ContextForgeClient.fromEnv(this.ledger);
		this.config = {
			worktreePoolSize: config?.worktreePoolSize || 3,
			cwd: config?.cwd,
		};
		this.worktrees = new Map();
		this.activeTasks = new Map();
	}

	/**
	 * Initializes the worktree pool by creating all worktrees upfront.
	 */
	public async initialize(): Promise<void> {
		if (this.initialized) return;

		const initPromises: Promise<void>[] = [];
		for (let i = 0; i < this.config.worktreePoolSize; i++) {
			const worktreeId = `lane-${i}`;
			const path = `.apohara/worktrees/${worktreeId}`;

			// Create worktree asynchronously
			const promise = this.isolationEngine
				.createWorktree(path, worktreeId, this.config.cwd)
				.then(async (result: IsolationResult) => {
					if (result.status === "success") {
						this.worktrees.set(worktreeId, path);
						await this.ledger.log(
							"worktree_created",
							{ worktreeId, path },
							"info",
						);
					} else {
						await this.ledger.log(
							"worktree_creation_failed",
							{ worktreeId, path, error: result.error },
							"error",
						);
					}
				});
			initPromises.push(promise);
		}

		await Promise.all(initPromises);
		this.initialized = true;
	}

	/**
	 * Finds an available worktree lane.
	 */
	private findAvailableWorktree(): string | null {
		for (const [id] of this.worktrees) {
			if (!this.activeTasks.has(id)) {
				return id;
			}
		}
		return null;
	}

	/**
	 * Checks if all dependencies for a task are completed.
	 */
	private checkDependencies(dependencies: string[]): boolean {
		const state = this.stateMachine.get();
		return dependencies.every((dep) => {
			const task = state.tasks.find((t) => t.id === dep);
			return task?.status === "completed";
		});
	}

	/**
	 * Schedules a single task if its dependencies are met and a worktree is available.
	 * Returns the worktree ID if scheduled, null otherwise.
	 */
	public async scheduleTask(task: DecomposedTask): Promise<string | null> {
		// Check if dependencies are met
		if (!this.checkDependencies(task.dependencies)) {
			return null;
		}

		// Find available worktree
		const worktreeId = this.findAvailableWorktree();
		if (!worktreeId) {
			return null;
		}

		const path = this.worktrees.get(worktreeId);
		if (!path) return null;

		// Add to active tasks first (before state update for atomicity)
		this.activeTasks.set(worktreeId, task);

		// M015.2 — fire-and-forget register_context. The sidecar uses this to
		// index the task's prompt for later dedup/compression in optimize().
		// We do NOT await: register is purely optimization; if it fails the
		// optimize() path falls back to passthrough on its own.
		if (this.contextforge) {
			void this.contextforge.register(task.id, task.description);
		}

		// Update state with the new task
		await this.stateMachine.update((state) => {
			// Check if task already exists
			const existingTask = state.tasks.find((t) => t.id === task.id);
			if (existingTask) {
				// Update existing task status
				const updatedTasks = state.tasks.map((t) =>
					t.id === task.id
						? { ...t, status: "in_progress" as const, updatedAt: new Date() }
						: t,
				);
				return { ...state, currentTaskId: task.id, tasks: updatedTasks };
			}

			// Create new task
			const newTask: Task = {
				id: task.id,
				description: task.description,
				status: "in_progress",
				createdAt: new Date(),
				updatedAt: new Date(),
			};
			return {
				...state,
				currentTaskId: task.id,
				tasks: [...state.tasks, newTask],
				status: "running",
			};
		});

		// Log task request in ledger
		await this.ledger.log(
			"task_scheduled",
			{ taskId: task.id, worktreeId, path, dependencies: task.dependencies },
			"info",
			task.id,
		);

		return worktreeId;
	}

	/**
	 * Marks a task as completed or failed.
	 */
	public async completeTask(
		taskId: string,
		worktreeId: string,
		result: TaskExecutionResult,
	): Promise<void> {
		// Update state
		await this.stateMachine.update((state) => {
			const updatedTasks = state.tasks.map((t) =>
				t.id === taskId
					? {
							...t,
							status: (result.status === "success"
								? "completed"
								: "failed") as Task["status"],
							updatedAt: new Date(),
						}
					: t,
			);
			return {
				...state,
				currentTaskId: null,
				tasks: updatedTasks,
				status: this.activeTasks.size <= 1 ? "idle" : "running",
			};
		});

		// Log completion in ledger
		await this.ledger.log(
			result.status === "success" ? "task_completed" : "task_failed",
			{
				taskId,
				worktreeId,
				output: result.output,
				error: result.error,
			},
			result.status === "success" ? "info" : "error",
			taskId,
		);

		// Clear from active tasks
		this.activeTasks.delete(worktreeId);
	}

	/**
	 * Executes a single task using the provider router with automatic fallback.
	 * Handles 429, timeout, and network errors with provider fallback.
	 * Returns the execution result.
	 */
	public async executeTaskWithFallback(
		task: DecomposedTask,
		messages: LLMMessage[],
	): Promise<{
		output: string;
		error?: string;
		fallbackOccurred: boolean;
		finalProvider?: ProviderId;
	}> {
		let fallbackOccurred = false;
		let lastError: string | undefined;
		let finalProvider: ProviderId | undefined;

		try {
			const response = await this.providerRouter.completion({ messages });
			finalProvider = response.provider;
			return {
				output: response.content,
				fallbackOccurred: false,
				finalProvider,
			};
		} catch (error) {
			lastError = error instanceof Error ? error.message : String(error);

			// Check if this was a retryable error that triggered fallback
			const retryableError = lastError.toLowerCase();
			if (
				retryableError.includes("429") ||
				retryableError.includes("timeout") ||
				retryableError.includes("network")
			) {
				fallbackOccurred = true;
				// Log the fallback in EventLedger
				await this.ledger.log(
					"provider_fallback",
					{
						taskId: task.id,
						error: lastError,
						message: `Provider fallback occurred for task ${task.id}`,
					},
					"warning",
					task.id,
				);
			}

			// Check if all providers are exhausted
			if (
				retryableError.includes("exhausted") ||
				retryableError.includes("unavailable")
			) {
				await this.ledger.log(
					"task_exhausted",
					{
						taskId: task.id,
						error: lastError,
						message: `All providers exhausted for task ${task.id}`,
					},
					"error",
					task.id,
				);
			}

			return {
				output: "",
				error: lastError,
				fallbackOccurred,
				finalProvider: this.providerRouter.fallback(undefined),
			};
		}
	}

	/**
	 * Logs a fallback event with console notification.
	 * Call this when provider fallback occurs for visibility.
	 */
	public async logFallbackEvent(
		fromProvider: ProviderId,
		toProvider: ProviderId,
		taskId: string,
		reason: string,
	): Promise<void> {
		// Console notification with the specified format
		console.warn(
			`⚠ ${fromProvider} ${reason} → reasignando a ${toProvider}...`,
		);

		// Log to EventLedger
		await this.ledger.log(
			"provider_fallback",
			{
				taskId,
				fromProvider,
				toProvider,
				reason,
				message: `${fromProvider} ${reason} → reasignando a ${toProvider}`,
			},
			"warning",
			taskId,
		);
	}

	/**
	 * Checks if a provider is on cooldown.
	 */
	public isProviderOnCooldown(provider: ProviderId): boolean {
		return this.providerRouter.isOnCooldown(provider);
	}

	/**
	 * Executes all tasks from the decomposition result in parallel across worktrees.
	 * Returns an array of execution results.
	 */
	public async executeAll(
		tasks: DecomposedTask[],
	): Promise<TaskExecutionResult[]> {
		const results: TaskExecutionResult[] = [];
		const pendingTasks = [...tasks];

		// Schedule initial batch of tasks
		const _scheduledWorktrees: Promise<string | null | undefined>[] = [];
		while (pendingTasks.length > 0) {
			const task = pendingTasks.shift();
			if (!task) break;

			const worktreeId = await this.scheduleTask(task);
			if (worktreeId === null) {
				// Re-add to pending if no worktree available
				pendingTasks.unshift(task);
				break;
			}
		}

		// Process until all tasks complete
		while (this.activeTasks.size > 0 || pendingTasks.length > 0) {
			// Wait a bit before checking for available worktrees
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Try to schedule more pending tasks
			while (pendingTasks.length > 0) {
				const task = pendingTasks.shift();
				if (!task) break;

				const worktreeId = await this.scheduleTask(task);
				if (worktreeId === null) {
					pendingTasks.unshift(task);
					break;
				}
			}
		}

		return results;
	}

	/**
	 * Gets the current state of scheduled tasks.
	 */
	public getActiveTasks(): Map<string, DecomposedTask> {
		return this.activeTasks;
	}

	/**
	 * Gets the number of available worktree lanes.
	 */
	public getPoolSize(): number {
		return this.config.worktreePoolSize;
	}

	/**
	 * Cleans up all worktrees.
	 */
	public async shutdown(): Promise<void> {
		const destroyPromises: Promise<void>[] = [];

		for (const [worktreeId, path] of this.worktrees) {
			const promise = this.isolationEngine
				.destroyWorktree(path, this.config.cwd)
				.then(async (result: IsolationResult) => {
					if (result.status === "success") {
						await this.ledger.log(
							"worktree_destroyed",
							{ worktreeId, path },
							"info",
						);
					}
				});
			destroyPromises.push(promise);
		}

		await Promise.all(destroyPromises);
		this.worktrees.clear();
		this.activeTasks.clear();
		this.initialized = false;
	}
}
