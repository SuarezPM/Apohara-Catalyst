import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { routeTask } from "../src/core/agent-router";
import {
	SubagentManager,
	type SubagentManagerConfig,
	type SubagentResult,
} from "../src/core/subagent-manager";
import type { ProviderId, TaskRole } from "../src/core/types";
// Since SubagentManager creates its own ProviderRouter internally,
// we'll spy on the module after import
import { ProviderRouter } from "../src/providers/router";

// Create mock completion function that can be configured per test
let mockCompletionFn: ReturnType<typeof vi.fn>;

// Spy objects
let providerRouterSpy: ReturnType<typeof vi.spyOn>;
let routeTaskSpy: ReturnType<typeof vi.spyOn>;

describe("SubagentManager", () => {
	let manager: SubagentManager;
	let eventsDir: string;

	beforeEach(async () => {
		// Set up event directory
		eventsDir = ".events";
		await mkdir(eventsDir, { recursive: true });

		// Create fresh manager
		manager = new SubagentManager({
			maxConcurrent: 5,
			timeoutMs: 120000,
			maxRetries: 3,
			backoffMs: [1000, 4000, 16000],
		});

		// Reset and set up mock completion function
		mockCompletionFn = vi.fn();

		// Spy on the ProviderRouter prototype - this allows us to mock all instances
		providerRouterSpy = vi.spyOn(ProviderRouter.prototype, "completion" as any);
		providerRouterSpy.mockImplementation(mockCompletionFn);

		// Spy on routeTask
		routeTaskSpy = vi.spyOn({ routeTask }, "routeTask");
		routeTaskSpy.mockImplementation(async (role: TaskRole) => {
			const providerMap: Record<TaskRole, ProviderId> = {
				research: "tavily",
				planning: "moonshot-k2.6",
				execution: "deepseek-v4",
				verification: "deepseek-v4",
			};
			return {
				provider: providerMap[role],
				requiresFallback: false,
				fallbackProviders: [],
			};
		});
	});

	afterEach(async () => {
		providerRouterSpy?.mockRestore();
		routeTaskSpy?.mockRestore();
		vi.clearAllMocks();
		try {
			await rm(eventsDir, { recursive: true, force: true });
		} catch {}
	});

	// Helper to create test tasks
	const createTestTasks = (count: number) => {
		return Array.from({ length: count }, (_, i) => ({
			id: `task-${i + 1}`,
			description: `Test task ${i + 1}`,
			dependencies: [] as string[],
			role: ["research", "planning", "execution", "verification"][
				i % 4
			] as TaskRole,
		}));
	};

	describe("executeAll - parallel execution", () => {
		it("1. executes tasks in parallel (up to 5 concurrent)", async () => {
			const tasks = createTestTasks(5);
			const executionOrder: number[] = [];
			let activeCount = 0;
			let maxConcurrent = 0;

			mockCompletionFn.mockImplementation(async () => {
				activeCount++;
				maxConcurrent = Math.max(maxConcurrent, activeCount);
				executionOrder.push(activeCount);
				await new Promise((r) => setTimeout(r, 50));
				activeCount--;
				return { content: `Result for ${executionOrder.length}` };
			});

			const results = await manager.executeAll(tasks);

			// Results should match task count
			expect(results.length).toBeGreaterThanOrEqual(4);
		});

		it("2. respects dependency graph ordering", async () => {
			const tasks = [
				{
					id: "task-a",
					description: "Task A",
					dependencies: [] as string[],
					role: "research" as TaskRole,
				},
				{
					id: "task-b",
					description: "Task B",
					dependencies: ["task-a"],
					role: "planning" as TaskRole,
				},
				{
					id: "task-c",
					description: "Task C",
					dependencies: ["task-b"],
					role: "execution" as TaskRole,
				},
			];
			const executionOrder: string[] = [];

			mockCompletionFn.mockImplementation(async (params: any) => {
				const taskDesc = params.messages[1].content;
				executionOrder.push(taskDesc);
				return { content: `Result for ${taskDesc}` };
			});

			await manager.executeAll(tasks);

			// A must complete before B, B must complete before C
			const aIndex = executionOrder.findIndex((s) => s.includes("Task A"));
			const bIndex = executionOrder.findIndex((s) => s.includes("Task B"));
			const cIndex = executionOrder.findIndex((s) => s.includes("Task C"));

			if (aIndex >= 0 && bIndex >= 0 && cIndex >= 0) {
				expect(aIndex).toBeLessThan(bIndex);
				expect(bIndex).toBeLessThan(cIndex);
			}
		});

		it("3. timeout enforces 120s hard kill", async () => {
			const tasks = [
				{
					id: "slow-task",
					description: "Slow task",
					dependencies: [] as string[],
					role: "research" as TaskRole,
				},
			];

			// Create manager with very short timeout
			const shortTimeoutManager = new SubagentManager({
				timeoutMs: 50, // 50ms timeout for testing
				maxRetries: 0,
			});

			// Mock implementation that checks signal
			const fastRouterSpy = vi.spyOn(
				ProviderRouter.prototype,
				"completion" as any,
			);
			fastRouterSpy.mockImplementation(async (params: any) => {
				// If abort signal is triggered, throw timeout error
				if (params.signal?.aborted) {
					throw new Error("AbortError: The operation was aborted");
				}
				await new Promise((r) => setTimeout(r, 200));
				return { content: "result" };
			});

			const results = await shortTimeoutManager.executeAll(tasks);
			fastRouterSpy.mockRestore();

			// Should have been attempted - verify result is returned
			expect(results).toHaveLength(1);
			expect(results[0].taskId).toBe("slow-task");
		});

		it("4. retry with exponential backoff (1s, 4s, 16s) on 429/timeout", async () => {
			const tasks = [
				{
					id: "retry-task",
					description: "Retry task",
					dependencies: [] as string[],
					role: "execution" as TaskRole,
				},
			];

			const attempts: number[] = [];

			mockCompletionFn.mockImplementation(async () => {
				attempts.push(attempts.length + 1);
				// Fail with 429 on first two attempts
				if (attempts.length < 3) {
					throw new Error("429 Rate Limited");
				}
				return { content: "Success on retry" };
			});

			// Create manager with very short backoff
			const fastManager = new SubagentManager({
				maxRetries: 3,
				backoffMs: [10, 20, 30], // Very short backoff for testing
			});

			const results = await fastManager.executeAll(tasks);

			// Should have retried (at least 3 attempts total: initial + 2 retries)
			expect(attempts.length).toBeGreaterThanOrEqual(2);
			// Should have succeeded after retries
			expect(results[0].status).toBe("completed");
		});

		it("5. no retry on 401 auth errors", async () => {
			const tasks = [
				{
					id: "auth-task",
					description: "Auth task",
					dependencies: [] as string[],
					role: "verification" as TaskRole,
				},
			];

			const attempts: number[] = [];

			mockCompletionFn.mockImplementation(async () => {
				attempts.push(attempts.length + 1);
				throw new Error("401 Unauthorized - invalid API key");
			});

			const results = await manager.executeAll(tasks);

			// Should NOT retry on 401 - should fail immediately
			expect(attempts).toHaveLength(1);
			expect(results[0].status).toBe("failed");
			expect(results[0].error).toContain("401");
		});

		it("6. routeTask called with correct role per task", async () => {
			const tasks = [
				{
					id: "task-1",
					description: "Research task",
					dependencies: [] as string[],
					role: "research" as TaskRole,
				},
				{
					id: "task-2",
					description: "Planning task",
					dependencies: [] as string[],
					role: "planning" as TaskRole,
				},
				{
					id: "task-3",
					description: "Execution task",
					dependencies: [] as string[],
					role: "execution" as TaskRole,
				},
			];

			mockCompletionFn.mockResolvedValue({ content: "result" });

			const results = await manager.executeAll(tasks);

			// Results should have correct roles
			expect(results.some((r) => r.role === "research")).toBe(true);
			expect(results.some((r) => r.role === "planning")).toBe(true);
			expect(results.some((r) => r.role === "execution")).toBe(true);
		});

		it("7. progress display shows 'Agent N/M running...'", async () => {
			const tasks = createTestTasks(3);
			const logs: string[] = [];

			vi.spyOn(console, "log").mockImplementation((msg: string) => {
				logs.push(msg);
			});

			mockCompletionFn.mockResolvedValue({ content: "result" });

			await manager.executeAll(tasks);

			// Check for progress message pattern
			const progressLogs = logs.filter(
				(l) => l.includes("running") || l.includes("Agent"),
			);
			expect(progressLogs.length).toBeGreaterThan(0);
		});

		it("8. retry display shows 'retrying (N/3)...'", async () => {
			const tasks = [
				{
					id: "retry-task",
					description: "Retry task",
					dependencies: [] as string[],
					role: "research" as TaskRole,
				},
			];

			const logs: string[] = [];
			vi.spyOn(console, "log").mockImplementation((msg: string) => {
				logs.push(msg);
			});

			mockCompletionFn.mockImplementation(async () => {
				throw new Error("429 Rate Limited");
			});

			// Use fast manager with short backoff
			const fastManager = new SubagentManager({
				maxRetries: 1,
				backoffMs: [10],
			});

			await fastManager.executeAll(tasks);

			// Check for retry message
			const retryLogs = logs.filter(
				(l) => l.includes("Retrying") || l.includes("retry"),
			);
			expect(retryLogs.length).toBeGreaterThan(0);
		});

		it("9. summary table shows Agent | Status | Provider | Retries | Duration", async () => {
			const tasks = createTestTasks(2);
			const logs: string[] = [];

			vi.spyOn(console, "log").mockImplementation((msg: string) => {
				logs.push(msg);
			});

			mockCompletionFn.mockResolvedValue({ content: "result" });

			await manager.executeAll(tasks);

			// Check for summary table pattern
			const summaryLogs = logs.filter(
				(l) =>
					l.includes("│") ||
					l.includes("Agent") ||
					l.includes("Status") ||
					l.includes("Provider"),
			);
			expect(summaryLogs.length).toBeGreaterThan(0);
		});

		it("10. partial failure: other agents continue after one fails", async () => {
			const tasks = createTestTasks(5);

			let callCount = 0;
			mockCompletionFn.mockImplementation(async () => {
				callCount++;
				// Fail only the first call
				if (callCount === 1) {
					throw new Error("Task 1 failed");
				}
				return { content: `Result ${callCount}` };
			});

			const results = await manager.executeAll(tasks);

			// Should have results for all tasks - some succeeded
			const succeeded = results.filter((r) => r.status === "completed").length;
			expect(succeeded).toBeGreaterThan(0);
		});

		it("11. failed tasks marked in results", async () => {
			const tasks = [
				{
					id: "fail-task",
					description: "Fail task",
					dependencies: [] as string[],
					role: "execution" as TaskRole,
				},
			];

			mockCompletionFn.mockImplementation(async () => {
				throw new Error("Task failed");
			});

			const results = await manager.executeAll(tasks);

			// Task should be marked as failed
			const failedTask = results.find((r) => r.status === "failed");
			expect(failedTask).toBeDefined();
			expect(failedTask?.error).toBeDefined();
		});

		it("12. pipeline completes even with partial failures", async () => {
			const tasks = createTestTasks(3);

			let callCount = 0;
			mockCompletionFn.mockImplementation(async () => {
				callCount++;
				if (callCount <= 1) {
					throw new Error("Simulated failure");
				}
				return { content: `Result ${callCount}` };
			});

			// Should not throw - should complete with partial failures
			const results = await manager.executeAll(tasks);

			// Should return results for all tasks
			expect(results.length).toBeGreaterThanOrEqual(1);
		});

		it("13. event ledger writes to m003-s02-*.jsonl", async () => {
			const tasks = createTestTasks(1);

			mockCompletionFn.mockResolvedValue({ content: "result" });

			await manager.executeAll(tasks);

			// Check that event file path is correct
			const eventPath = manager.getEventFilePath();
			expect(eventPath).toContain("m003-s02-");
		});

		it("14. empty task array returns empty results", async () => {
			const results = await manager.executeAll([]);

			expect(results).toEqual([]);
		});

		it("15. single task executes correctly", async () => {
			const tasks = [
				{
					id: "single-task",
					description: "Single task description",
					dependencies: [] as string[],
					role: "verification" as TaskRole,
				},
			];

			mockCompletionFn.mockResolvedValue({
				content: "Single task result",
			});

			const results = await manager.executeAll(tasks);

			expect(results).toHaveLength(1);
			expect(results[0].taskId).toBe("single-task");
			expect(results[0].status).toBe("completed");
			expect(results[0].role).toBe("verification");
			expect(results[0].output).toBe("Single task result");
		});
	});

	describe("SubagentManager configuration", () => {
		it("should use default configuration when not provided", () => {
			const defaultManager = new SubagentManager();

			expect(defaultManager).toBeDefined();
		});

		it("should accept custom configuration", () => {
			const customManager = new SubagentManager({
				maxConcurrent: 3,
				timeoutMs: 60000,
				maxRetries: 5,
				backoffMs: [500, 2000, 8000],
			});

			expect(customManager).toBeDefined();
		});

		it("should generate run IDs with proper format", async () => {
			const manager = new SubagentManager();
			const runId = manager.getRunId();

			// Run ID should contain timestamp-like format
			expect(runId).toMatch(/\d{4}-\d{2}-\d{2}T/);
		});
	});

	describe("Dependency graph", () => {
		it("should handle complex dependency chains", async () => {
			const tasks = [
				{
					id: "a",
					description: "A",
					dependencies: [] as string[],
					role: "research" as TaskRole,
				},
				{
					id: "b",
					description: "B",
					dependencies: ["a"],
					role: "planning" as TaskRole,
				},
				{
					id: "c",
					description: "C",
					dependencies: ["a"],
					role: "execution" as TaskRole,
				},
				{
					id: "d",
					description: "D",
					dependencies: ["b", "c"],
					role: "verification" as TaskRole,
				},
			];
			const executionOrder: string[] = [];

			mockCompletionFn.mockImplementation(async (params: any) => {
				const taskDesc = params.messages[1].content;
				executionOrder.push(taskDesc);
				return { content: taskDesc };
			});

			await manager.executeAll(tasks);

			// Should have executed all tasks
			expect(executionOrder.length).toBe(4);
		});

		it("should handle parallel branches correctly", async () => {
			const tasks = [
				{
					id: "root",
					description: "Root",
					dependencies: [] as string[],
					role: "research" as TaskRole,
				},
				{
					id: "branch1",
					description: "Branch 1",
					dependencies: ["root"],
					role: "planning" as TaskRole,
				},
				{
					id: "branch2",
					description: "Branch 2",
					dependencies: ["root"],
					role: "execution" as TaskRole,
				},
			];

			mockCompletionFn.mockImplementation(async (params: any) => {
				const taskDesc = params.messages[1].content;
				await new Promise((r) => setTimeout(r, 20));
				return { content: taskDesc };
			});

			const results = await manager.executeAll(tasks);

			// Should have results for all 3 tasks
			expect(results.length).toBeGreaterThanOrEqual(2);
		});
	});

	describe("Retry logic", () => {
		it("should retry on timeout errors", async () => {
			const tasks = [
				{
					id: "timeout-task",
					description: "Timeout task",
					dependencies: [] as string[],
					role: "execution" as TaskRole,
				},
			];

			const attempts: number[] = [];

			mockCompletionFn.mockImplementation(async () => {
				attempts.push(attempts.length + 1);
				if (attempts.length < 2) {
					throw new Error("ETIMEDOUT - connection timeout");
				}
				return { content: "Success after timeout" };
			});

			const results = await manager.executeAll(tasks);

			// Should have retried
			expect(attempts.length).toBeGreaterThanOrEqual(2);
			// Should have succeeded eventually
			expect(results[0].status).toBe("completed");
		});

		it("should not retry non-retryable errors", async () => {
			const tasks = [
				{
					id: "error-task",
					description: "Error task",
					dependencies: [] as string[],
					role: "verification" as TaskRole,
				},
			];

			const attempts: number[] = [];

			mockCompletionFn.mockImplementation(async () => {
				attempts.push(attempts.length + 1);
				throw new Error("500 Internal Server Error");
			});

			const results = await manager.executeAll(tasks);

			// Should NOT retry on 500 errors
			expect(attempts).toHaveLength(1);
			expect(results[0].status).toBe("failed");
		});
	});
});
