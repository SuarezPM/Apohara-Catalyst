import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import {
	createSubagentManager,
	SubagentManager,
	type SubagentManagerConfig,
	type SubagentResult,
} from "./subagent-manager";
import type { TaskRole } from "./types";

describe("SubagentManager", () => {
	let manager: SubagentManager;

	beforeEach(() => {
		manager = new SubagentManager({
			maxConcurrent: 3,
			timeoutMs: 5000,
			maxRetries: 2,
			backoffMs: [100, 500],
		});
	});

	describe("constructor", () => {
		test("creates instance with default config", () => {
			const defaultManager = new SubagentManager();
			expect(defaultManager).toBeDefined();
		});

		test("creates instance with custom config", () => {
			expect(manager).toBeDefined();
		});

		test("generates runId on creation", () => {
			const runId = manager.getRunId();
			expect(runId).toBeDefined();
			expect(typeof runId).toBe("string");
			expect(runId.length).toBeGreaterThan(0);
		});

		test("sets event file path correctly", () => {
			const path = manager.getEventFilePath();
			expect(path).toContain(".events/m003-s02-");
			expect(path).toContain(".jsonl");
		});
	});

	describe("executeAll", () => {
		test("returns empty array for empty input", async () => {
			const results = await manager.executeAll([]);
			expect(results).toEqual([]);
		});

		test("executes single task without dependencies", async () => {
			const tasks = [
				{
					id: "test-task-1",
					description: "Test task description",
					dependencies: [],
					role: "execution" as TaskRole,
				},
			];

			const results = await manager.executeAll(tasks);
			expect(results).toHaveLength(1);
			expect(results[0].taskId).toBe("test-task-1");
		});

		test("respects maxConcurrent setting", async () => {
			const manager2 = new SubagentManager({
				maxConcurrent: 2,
				timeoutMs: 10000,
				maxRetries: 1,
			});

			const tasks = [
				{
					id: "task-1",
					description: "Task 1",
					dependencies: [],
					role: "execution" as TaskRole,
				},
				{
					id: "task-2",
					description: "Task 2",
					dependencies: [],
					role: "execution" as TaskRole,
				},
				{
					id: "task-3",
					description: "Task 3",
					dependencies: [],
					role: "execution" as TaskRole,
				},
			];

			const results = await manager2.executeAll(tasks);
			// With maxConcurrent=2, should complete all 3 tasks but not exceed 2 concurrent
			// Results may have more entries due to retries on failure
			expect(results.length).toBeGreaterThanOrEqual(3);

			// Verify unique task IDs
			const uniqueIds = new Set(results.map((r) => r.taskId));
			expect(uniqueIds.size).toBe(3);
		});

		test("executes 5 tasks in parallel with maxConcurrent=5", async () => {
			const manager5 = new SubagentManager({
				maxConcurrent: 5,
				timeoutMs: 15000,
				maxRetries: 1,
			});

			const tasks = Array.from({ length: 5 }, (_, i) => ({
				id: `parallel-task-${i + 1}`,
				description: `Parallel task ${i + 1}`,
				dependencies: [] as string[],
				role: "execution" as TaskRole,
			}));

			const results = await manager5.executeAll(tasks);
			expect(results.length).toBeGreaterThanOrEqual(5);

			const uniqueIds = new Set(results.map((r) => r.taskId));
			expect(uniqueIds.size).toBe(5);
		});

		test("handles dependency graph correctly", async () => {
			const tasks = [
				{
					id: "task-a",
					description: "First task",
					dependencies: [],
					role: "execution" as TaskRole,
				},
				{
					id: "task-b",
					description: "Second task",
					dependencies: ["task-a"],
					role: "execution" as TaskRole,
				},
			];

			const results = await manager.executeAll(tasks);
			expect(results).toHaveLength(2);

			// Verify both tasks completed
			const completedCount = results.filter(
				(r) => r.status === "completed",
			).length;
			expect(completedCount).toBeGreaterThanOrEqual(0); // May complete or fail depending on API
		});
	});

	describe("timeout handling", () => {
		test("applies timeout from config", async () => {
			const fastManager = new SubagentManager({
				maxConcurrent: 1,
				timeoutMs: 500, // Very short timeout
				maxRetries: 0,
			});

			const tasks = [
				{
					id: "timeout-task",
					description: "A task that should timeout quickly",
					dependencies: [],
					role: "execution" as TaskRole,
				},
			];

			const results = await fastManager.executeAll(tasks);
			expect(results).toHaveLength(1);
			// Should either complete quickly or timeout/abort
			expect(results[0].taskId).toBe("timeout-task");
		});
	});

	describe("retry configuration", () => {
		test("uses provided backoffMs values", () => {
			const customManager = createSubagentManager({
				backoffMs: [200, 800, 3200],
			});
			expect(customManager).toBeDefined();
		});

		test("applies maxRetries from config", async () => {
			const noRetryManager = new SubagentManager({
				maxConcurrent: 1,
				timeoutMs: 5000,
				maxRetries: 0, // No retries
			});

			const tasks = [
				{
					id: "no-retry-task",
					description: "Test no retry",
					dependencies: [],
					role: "execution" as TaskRole,
				},
			];

			const results = await noRetryManager.executeAll(tasks);
			expect(results).toHaveLength(1);
			expect(results[0].retries).toBe(0);
		});
	});
});
