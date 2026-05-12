import { beforeEach, describe, expect, test, vi } from "vitest";
import {
	type DecomposedTask,
	type DecompositionResult,
	TaskDecomposer,
} from "./decomposer";
import type { TaskRole } from "./types";

// Mock the routeTaskWithFallback function - it returns { provider, response }
vi.mock("./agent-router", () => ({
	routeTaskWithFallback: vi.fn(),
}));

import { routeTaskWithFallback } from "./agent-router";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockRouteTaskWithFallback = routeTaskWithFallback as any;

describe("TaskDecomposer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	// Test 1: files field serialization/deserialization
	test("files field is preserved through decomposition round-trip", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "setup-deps",
						description: "Install project dependencies",
						estimatedComplexity: "low",
						dependencies: [],
						role: "execution",
						files: ["package.json", "bun.lockb"],
					},
					{
						id: "impl-core",
						description: "Implement core functionality",
						estimatedComplexity: "high",
						dependencies: ["setup-deps"],
						role: "execution",
						files: [
							"src/core/handler.ts",
							"src/types.ts",
							"tests/core.test.ts",
						],
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		const result = await decomposer.decompose("Build a task manager");

		expect(result.tasks).toHaveLength(2);
		expect(result.tasks[0].files).toEqual(["package.json", "bun.lockb"]);
		expect(result.tasks[1].files).toEqual([
			"src/core/handler.ts",
			"src/types.ts",
			"tests/core.test.ts",
		]);
	});

	// Test 2: dependency cycle detection with clear error
	test("throws descriptive error when dependency cycle is detected", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "task-a",
						description: "Task A",
						estimatedComplexity: "medium",
						dependencies: ["task-c"], // Cycle: A -> C -> B -> A
						role: "execution",
						files: [],
					},
					{
						id: "task-b",
						description: "Task B",
						estimatedComplexity: "medium",
						dependencies: ["task-a"],
						role: "execution",
						files: [],
					},
					{
						id: "task-c",
						description: "Task C",
						estimatedComplexity: "medium",
						dependencies: ["task-b"],
						role: "execution",
						files: [],
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		await expect(decomposer.decompose("Test cycle")).rejects.toThrow(
			/Dependency cycle detected/,
		);
	});

	// Test 3: role defaults to execution when invalid
	test("defaults role to execution when invalid role is provided", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "invalid-role-task",
						description: "Task with invalid role",
						estimatedComplexity: "medium",
						dependencies: [],
						role: "invalid-role" as TaskRole,
						files: [],
					},
					{
						id: "missing-role-task",
						description: "Task without role field",
						estimatedComplexity: "low",
						dependencies: [],
						// role field omitted entirely
						files: [],
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		const result = await decomposer.decompose("Test role defaults");

		expect(result.tasks[0].role).toBe("execution");
		expect(result.tasks[1].role).toBe("execution");
	});

	// Test 4: empty files array handling
	test("handles empty files array correctly", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "no-files-task",
						description: "Task with no files",
						estimatedComplexity: "low",
						dependencies: [],
						role: "verification",
						files: [] as string[],
					},
					{
						id: "missing-files-task",
						description: "Task missing files field",
						estimatedComplexity: "medium",
						dependencies: ["no-files-task"],
						role: "verification",
						// files field completely missing
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		const result = await decomposer.decompose("Test empty files");

		expect(result.tasks[0].files).toEqual([]);
		expect(result.tasks[1].files).toEqual([]);
		expect(Array.isArray(result.tasks[0].files)).toBe(true);
	});

	// Test 5: LLM response parse errors produce helpful messages
	test("provides helpful error message when LLM response cannot be parsed", async () => {
		const mockLLMResponse = {
			content: "This is not valid JSON at all { broken: json",
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		await expect(decomposer.decompose("Test parse error")).rejects.toThrow(
			/Failed to parse LLM decomposition response/,
		);
	});

	test("provides helpful error message for non-object JSON response", async () => {
		const mockLLMResponse = {
			content: "Just a plain string response",
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		await expect(decomposer.decompose("Test parse error")).rejects.toThrow(
			/Failed to parse LLM decomposition response/,
		);
	});

	test("validates that tasks array exists in parsed response", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				notTasks: "this is wrong",
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		await expect(decomposer.decompose("Test missing tasks")).rejects.toThrow(
			/Invalid decomposition: missing tasks array/,
		);
	});

	// Additional test: cycle detection with self-referencing dependency
	test("detects self-referencing dependency as cycle", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "self-cycle",
						description: "Task that depends on itself",
						estimatedComplexity: "low",
						dependencies: ["self-cycle"], // Direct self-reference
						role: "execution",
						files: [],
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		await expect(decomposer.decompose("Test self cycle")).rejects.toThrow(
			/Dependency cycle detected/,
		);
	});

	// Additional test: estimatedFiles field mapping
	test("maps estimatedFiles to files when files is empty", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "mapped-task",
						description: "Task using estimatedFiles field",
						estimatedComplexity: "medium",
						dependencies: [],
						role: "execution",
						estimatedFiles: ["src/mapped.ts", "tests/mapped.test.ts"],
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		const result = await decomposer.decompose("Test field mapping");

		// Should map estimatedFiles to files
		expect(result.tasks[0].files).toEqual([
			"src/mapped.ts",
			"tests/mapped.test.ts",
		]);
	});

	// Test: Invalid dependency reference error
	test("throws error when task references non-existent dependency", async () => {
		const mockLLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "valid-task",
						description: "Valid task",
						estimatedComplexity: "low",
						dependencies: ["non-existent-task"],
						role: "execution",
						files: [],
					},
				],
			}),
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		await expect(decomposer.decompose("Test invalid dep")).rejects.toThrow(
			/has invalid dependency/,
		);
	});

	// Test: Markdown-wrapped JSON parsing
	test("parses JSON wrapped in markdown code blocks", async () => {
		const mockLLMResponse = {
			content:
				"```json\n" +
				JSON.stringify({
					tasks: [
						{
							id: "markdown-task",
							description: "Task in markdown",
							estimatedComplexity: "low",
							dependencies: [],
							role: "research",
							files: ["src/research.ts"],
						},
					],
				}) +
				"\n```",
			usage: { inputTokens: 100, outputTokens: 200 },
		};

		mockRouteTaskWithFallback.mockResolvedValue({
			provider: "gemini",
			response: mockLLMResponse,
		});

		const decomposer = new TaskDecomposer();
		const result = await decomposer.decompose("Test markdown parse");

		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0].id).toBe("markdown-task");
	});
});
