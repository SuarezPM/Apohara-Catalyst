import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { DecomposedTask } from "../src/core/decomposer";
import type { IsolationEngine, IsolationResult } from "../src/core/isolation";
import { EventLedger } from "../src/core/ledger";
import {
	ParallelScheduler,
	type TaskExecutionResult,
} from "../src/core/scheduler";
import { StateMachine } from "../src/core/state";

// Create a mock IsolationEngine that doesn't actually create worktrees
class MockIsolationEngine {
	private worktrees: Map<string, string> = new Map();

	async createWorktree(
		path: string,
		worktreeId: string,
		_cwd?: string,
	): Promise<IsolationResult> {
		this.worktrees.set(worktreeId, path);
		return { status: "success", message: `Mock worktree created: ${path}` };
	}

	async destroyWorktree(path: string, _cwd?: string): Promise<IsolationResult> {
		for (const [id, p] of this.worktrees.entries()) {
			if (p === path) {
				this.worktrees.delete(id);
				break;
			}
		}
		return { status: "success", message: `Mock worktree destroyed: ${path}` };
	}

	getWorktrees() {
		return this.worktrees;
	}
}

describe("ParallelScheduler Integration", () => {
	let scheduler: ParallelScheduler;
	let mockIsolation: MockIsolationEngine;
	let ledger: EventLedger;
	let stateMachine: StateMachine;

	beforeEach(async () => {
		// Clean up event files from previous tests
		await rm(join(process.cwd(), ".events"), { recursive: true, force: true });

		mockIsolation = new MockIsolationEngine();
		stateMachine = new StateMachine();
		ledger = new EventLedger("test-scheduler");

		scheduler = new ParallelScheduler(
			mockIsolation as unknown as IsolationEngine,
			stateMachine,
			ledger,
			undefined,
			{ worktreePoolSize: 2 },
		);

		await scheduler.initialize();
	});

	afterEach(async () => {
		await scheduler.shutdown();
		await rm(join(process.cwd(), ".events"), { recursive: true, force: true });
	});

	it("should initialize with configured worktree pool size", async () => {
		expect(scheduler.getPoolSize()).toBe(2);
	});

	it("should schedule a task when dependencies are met", async () => {
		const task: DecomposedTask = {
			id: "task-1",
			description: "First task",
			estimatedComplexity: "low",
			dependencies: [],
		};

		const worktreeId = await scheduler.scheduleTask(task);

		expect(worktreeId).toBeDefined();
		expect(worktreeId).toMatch(/^lane-\d+$/);
	});

	it("should not schedule a task when dependencies are not met", async () => {
		const task: DecomposedTask = {
			id: "task-2",
			description: "Dependent task",
			estimatedComplexity: "medium",
			dependencies: ["nonexistent-id"],
		};

		const worktreeId = await scheduler.scheduleTask(task);

		expect(worktreeId).toBeNull();
	});

	it("should block tasks with incomplete dependencies", async () => {
		// Schedule first task
		const task1: DecomposedTask = {
			id: "dep-task",
			description: "Task with no deps",
			estimatedComplexity: "low",
			dependencies: [],
		};
		await scheduler.scheduleTask(task1);

		// Create result for first task to complete it
		const result1: TaskExecutionResult = {
			taskId: "dep-task",
			status: "success",
			worktreeId: "lane-0",
			output: "completed",
		};

		// Complete the task
		await scheduler.completeTask("dep-task", "lane-0", result1);

		// Now schedule dependent task
		const task2: DecomposedTask = {
			id: "dependent-task",
			description: "Task depending on dep-task",
			estimatedComplexity: "medium",
			dependencies: ["dep-task"],
		};

		const worktreeId = await scheduler.scheduleTask(task2);

		// Should be scheduled now that dependency is complete
		expect(worktreeId).toBeDefined();
	});

	it("should execute multiple tasks in parallel across worktrees", async () => {
		const tasks: DecomposedTask[] = [
			{
				id: "parallel-1",
				description: "Parallel task 1",
				estimatedComplexity: "low",
				dependencies: [],
			},
			{
				id: "parallel-2",
				description: "Parallel task 2",
				estimatedComplexity: "low",
				dependencies: [],
			},
		];

		// Schedule first batch
		const worktree1 = await scheduler.scheduleTask(tasks[0]);
		const worktree2 = await scheduler.scheduleTask(tasks[1]);

		expect(worktree1).toBeDefined();
		expect(worktree2).toBeDefined();
		expect(worktree1).not.toBe(worktree2); // Different worktrees
	});

	it("should queue tasks when worktrees are exhausted", async () => {
		// Fill up worktrees
		const task1: DecomposedTask = {
			id: "task-a",
			description: "Task A",
			estimatedComplexity: "low",
			dependencies: [],
		};
		const task2: DecomposedTask = {
			id: "task-b",
			description: "Task B",
			estimatedComplexity: "low",
			dependencies: [],
		};
		const task3: DecomposedTask = {
			id: "task-c",
			description: "Task C",
			estimatedComplexity: "low",
			dependencies: [],
		};

		const wt1 = await scheduler.scheduleTask(task1);
		const wt2 = await scheduler.scheduleTask(task2);
		const wt3 = await scheduler.scheduleTask(task3); // Should be null (no worktrees)

		expect(wt1).toBeDefined();
		expect(wt2).toBeDefined();
		expect(wt3).toBeNull(); // Pool exhausted
	});

	it("should log task events to the ledger", async () => {
		const task: DecomposedTask = {
			id: "logged-task",
			description: "Task to be logged",
			estimatedComplexity: "low",
			dependencies: [],
		};

		await scheduler.scheduleTask(task);

		// Ledger should have logged the task
		const filePath = ledger.getFilePath();
		expect(filePath).toContain(".events/run-test-scheduler.jsonl");
	});

	it("should complete tasks and record results", async () => {
		const task: DecomposedTask = {
			id: "completable-task",
			description: "Task to complete",
			estimatedComplexity: "low",
			dependencies: [],
		};

		const worktreeId = await scheduler.scheduleTask(task);
		expect(worktreeId).toBeDefined();

		const result: TaskExecutionResult = {
			taskId: "completable-task",
			status: "success",
			output: "Task executed successfully",
			worktreeId: worktreeId!,
		};

		await scheduler.completeTask("completable-task", worktreeId!, result);

		// Verify the active task is cleared
		const activeTasks = scheduler.getActiveTasks();
		expect(activeTasks.size).toBe(0);
	});

	it("should handle failed task execution", async () => {
		const task: DecomposedTask = {
			id: "failing-task",
			description: "Task that will fail",
			estimatedComplexity: "medium",
			dependencies: [],
		};

		const worktreeId = await scheduler.scheduleTask(task);
		expect(worktreeId).toBeDefined();

		const result: TaskExecutionResult = {
			taskId: "failing-task",
			status: "error",
			error: "Task execution failed: missing dependency",
			worktreeId: worktreeId!,
		};

		await scheduler.completeTask("failing-task", worktreeId!, result);

		// Verify the active task is cleared even on failure
		const activeTasks = scheduler.getActiveTasks();
		expect(activeTasks.size).toBe(0);
	});

	it("should return the active tasks map", async () => {
		const task: DecomposedTask = {
			id: "check-active",
			description: "Check active tasks",
			estimatedComplexity: "low",
			dependencies: [],
		};

		await scheduler.scheduleTask(task);

		const activeTasks = scheduler.getActiveTasks();
		expect(activeTasks.size).toBe(1);
		expect(activeTasks.has("lane-0")).toBe(true);
	});
});
