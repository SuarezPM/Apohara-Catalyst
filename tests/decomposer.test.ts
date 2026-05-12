import { beforeEach, describe, expect, it, vi } from "bun:test";
import {
	type DecompositionResult,
	TaskDecomposer,
} from "../src/core/decomposer";
import type {
	BlastRadiusResponse,
	IndexerClient,
	SearchResult,
} from "../src/core/indexer-client";
import type { LLMResponse, ProviderRouter } from "../src/providers/router";

// NOTE: We intentionally do NOT mock ProviderRouter here because we need
// to test the real integration between TaskDecomposer and ProviderRouter
// The mock was causing issues with other test files that import the real class

describe("TaskDecomposer Integration", () => {
	let decomposer: TaskDecomposer;
	let mockRouter: ProviderRouter;
	let mockCompletion: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		mockCompletion = vi.fn();
		mockRouter = {
			completion: mockCompletion,
		} as unknown as ProviderRouter;
		decomposer = new TaskDecomposer(mockRouter);
	});

	it("should decompose a prompt into atomic tasks", async () => {
		// Mock LLM response
		const mockLLMResponse: LLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "setup-deps",
						description: "Install project dependencies",
						estimatedComplexity: "low",
						dependencies: [],
					},
					{
						id: "impl-auth",
						description: "Implement authentication logic",
						estimatedComplexity: "high",
						dependencies: ["setup-deps"],
					},
					{
						id: "write-tests",
						description: "Write unit tests for auth",
						estimatedComplexity: "medium",
						dependencies: ["impl-auth"],
					},
				],
			}),
			usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
			costUsd: 0.002,
			provider: "opencode-go",
			model: "test-model",
			durationMs: 500,
		};

		(mockRouter.completion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			mockLLMResponse,
		);

		const result = await decomposer.decompose("Build authentication system");

		expect(result).toBeDefined();
		expect(result.originalPrompt).toBe("Build authentication system");
		expect(result.tasks).toHaveLength(3);
		expect(result.tasks[0].id).toBe("setup-deps");
		expect(result.tasks[0].dependencies).toEqual([]);
		expect(result.tasks[1].dependencies).toContain("setup-deps");
	});

	it("should handle JSON wrapped in markdown code blocks", async () => {
		const mockLLMResponse: LLMResponse = {
			content: `\`\`\`json
{
  "tasks": [
    {
      "id": "init-project",
      "description": "Initialize project",
      "estimatedComplexity": "low",
      "dependencies": []
    }
  ]
}
\`\`\`
`,
			usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
			costUsd: 0.001,
			provider: "deepseek",
			model: "deepseek-coder",
			durationMs: 300,
		};

		(mockRouter.completion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			mockLLMResponse,
		);

		const result = await decomposer.decompose("Initialize project");

		expect(result.tasks).toHaveLength(1);
		expect(result.tasks[0].id).toBe("init-project");
	});

	it("should validate task dependencies reference valid task IDs", async () => {
		const mockLLMResponse: LLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "task-a",
						description: "Task A",
						estimatedComplexity: "low",
						dependencies: ["nonexistent-task"],
					},
				],
			}),
			usage: { promptTokens: 50, completionTokens: 20, totalTokens: 70 },
			costUsd: 0.001,
			provider: "opencode-go",
			model: "test",
			durationMs: 100,
		};

		(mockRouter.completion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			mockLLMResponse,
		);

		await expect(decomposer.decompose("Test")).rejects.toThrow(
			"has invalid dependency",
		);
	});

	it("should throw when LLM response has invalid structure", async () => {
		const mockLLMResponse: LLMResponse = {
			content: "This is not JSON",
			usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
			costUsd: 0.001,
			provider: "test",
			model: "test",
			durationMs: 100,
		};

		(mockRouter.completion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			mockLLMResponse,
		);

		await expect(decomposer.decompose("Test")).rejects.toThrow(
			"Failed to parse",
		);
	});

	it("should throw when response is missing tasks array", async () => {
		const mockLLMResponse: LLMResponse = {
			content: JSON.stringify({ other: "data" }),
			usage: { promptTokens: 50, completionTokens: 10, totalTokens: 60 },
			costUsd: 0.001,
			provider: "test",
			model: "test",
			durationMs: 100,
		};

		(mockRouter.completion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			mockLLMResponse,
		);

		await expect(decomposer.decompose("Test")).rejects.toThrow(
			"missing tasks array",
		);
	});

	it("should accept all complexity levels", async () => {
		const mockLLMResponse: LLMResponse = {
			content: JSON.stringify({
				tasks: [
					{
						id: "low",
						description: "Low",
						estimatedComplexity: "low",
						dependencies: [],
					},
					{
						id: "medium",
						description: "Medium",
						estimatedComplexity: "medium",
						dependencies: [],
					},
					{
						id: "high",
						description: "High",
						estimatedComplexity: "high",
						dependencies: [],
					},
				],
			}),
			usage: { promptTokens: 50, completionTokens: 30, totalTokens: 80 },
			costUsd: 0.001,
			provider: "test",
			model: "test",
			durationMs: 100,
		};

		(mockRouter.completion as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			mockLLMResponse,
		);

		const result = await decomposer.decompose("Test all levels");

		expect(result.tasks[0].estimatedComplexity).toBe("low");
		expect(result.tasks[1].estimatedComplexity).toBe("medium");
		expect(result.tasks[2].estimatedComplexity).toBe("high");
	});
});

describe("TaskDecomposer — Indexer Context Injection", () => {
	let mockRouter: ProviderRouter;
	let mockCompletion: ReturnType<typeof vi.fn>;
	let mockIndexerClient: IndexerClient;
	let mockSearch: ReturnType<typeof vi.fn>;
	let mockGetBlastRadius: ReturnType<typeof vi.fn>;

	const twoTaskLLMResponse = (): LLMResponse => ({
		content: JSON.stringify({
			tasks: [
				{
					id: "impl-core",
					description: "Implement core logic",
					estimatedComplexity: "high",
					dependencies: [],
					role: "execution",
					files: ["src/core/handler.ts"],
				},
				{
					id: "write-tests",
					description: "Write tests",
					estimatedComplexity: "medium",
					dependencies: ["impl-core"],
					role: "verification",
					files: [],
				},
			],
		}),
		usage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
		costUsd: 0.001,
		provider: "opencode-go",
		model: "test-model",
		durationMs: 200,
	});

	const fakeSearchResults: SearchResult[] = [
		{
			id: 1,
			distance: 0.2,
			metadata: {
				file_path: "src/core/handler.ts",
				function_name: "handleRequest",
				parameters: "(req: Request)",
				return_type: "Promise<Response>",
				line: 42,
				column: 0,
			},
		},
		{
			id: 2,
			distance: 0.35,
			metadata: {
				file_path: "src/lib/utils.ts",
				function_name: "formatResponse",
				parameters: "(data: unknown)",
				return_type: "string",
				line: 10,
				column: 0,
			},
		},
	];

	const fakeBlastRadius: BlastRadiusResponse = {
		files: ["src/core/handler.ts", "src/middleware/auth.ts", "src/types.ts"],
	};

	beforeEach(() => {
		mockCompletion = vi.fn();
		mockRouter = { completion: mockCompletion } as unknown as ProviderRouter;

		mockSearch = vi.fn().mockResolvedValue(fakeSearchResults);
		mockGetBlastRadius = vi.fn().mockResolvedValue(fakeBlastRadius);
		mockIndexerClient = {
			search: mockSearch,
			getBlastRadius: mockGetBlastRadius,
		} as unknown as IndexerClient;
	});

	it("should attach indexerContext to every task when indexer is available", async () => {
		mockCompletion.mockResolvedValueOnce(twoTaskLLMResponse());
		const decomposer = new TaskDecomposer(mockRouter, mockIndexerClient);

		const result = await decomposer.decompose("Build authentication system");

		expect(result.tasks).toHaveLength(2);
		for (const task of result.tasks) {
			expect(task.indexerContext).toBeDefined();
			expect(task.indexerContext!.searchHits).toHaveLength(2);
		}
	});

	it("should perform exactly one broad search call regardless of task count", async () => {
		mockCompletion.mockResolvedValueOnce(twoTaskLLMResponse());
		const decomposer = new TaskDecomposer(mockRouter, mockIndexerClient);

		await decomposer.decompose("Build authentication system");

		expect(mockSearch).toHaveBeenCalledTimes(1);
		expect(mockSearch).toHaveBeenCalledWith("Build authentication system", 10);
	});

	it("should call getBlastRadius once per task that has a primary file", async () => {
		mockCompletion.mockResolvedValueOnce(twoTaskLLMResponse());
		const decomposer = new TaskDecomposer(mockRouter, mockIndexerClient);

		await decomposer.decompose("Build authentication system");

		// impl-core has files[0] = "src/core/handler.ts"; write-tests has no files
		expect(mockGetBlastRadius).toHaveBeenCalledTimes(1);
		expect(mockGetBlastRadius).toHaveBeenCalledWith("src/core/handler.ts");
	});

	it("should populate blastRadius only for tasks with a primary file target", async () => {
		mockCompletion.mockResolvedValueOnce(twoTaskLLMResponse());
		const decomposer = new TaskDecomposer(mockRouter, mockIndexerClient);

		const result = await decomposer.decompose("Build authentication system");

		const implTask = result.tasks.find((t) => t.id === "impl-core")!;
		const testTask = result.tasks.find((t) => t.id === "write-tests")!;

		expect(implTask.indexerContext!.blastRadius).toEqual(fakeBlastRadius.files);
		expect(testTask.indexerContext!.blastRadius).toEqual([]);
	});

	it("should map search hit distance to a similarity score (1 - distance)", async () => {
		mockCompletion.mockResolvedValueOnce(twoTaskLLMResponse());
		const decomposer = new TaskDecomposer(mockRouter, mockIndexerClient);

		const result = await decomposer.decompose("Build authentication system");

		const hits = result.tasks[0].indexerContext!.searchHits;
		expect(hits[0].score).toBeCloseTo(1 - fakeSearchResults[0].distance);
		expect(hits[1].score).toBeCloseTo(1 - fakeSearchResults[1].distance);
		expect(hits[0].filePath).toBe("src/core/handler.ts");
		expect(hits[0].functionName).toBe("handleRequest");
		expect(hits[0].line).toBe(42);
	});

	it("should degrade gracefully when indexer search throws", async () => {
		mockSearch.mockRejectedValueOnce(new Error("daemon unreachable"));
		mockCompletion.mockResolvedValueOnce(twoTaskLLMResponse());
		const decomposer = new TaskDecomposer(mockRouter, mockIndexerClient);

		const result = await decomposer.decompose("Build authentication system");

		// Decomposition succeeds; tasks have no indexerContext
		expect(result.tasks).toHaveLength(2);
		for (const task of result.tasks) {
			expect(task.indexerContext).toBeUndefined();
		}
	});

	it("should degrade gracefully when getBlastRadius throws for a specific task", async () => {
		mockGetBlastRadius.mockRejectedValueOnce(new Error("target not indexed"));
		mockCompletion.mockResolvedValueOnce(twoTaskLLMResponse());
		const decomposer = new TaskDecomposer(mockRouter, mockIndexerClient);

		const result = await decomposer.decompose("Build authentication system");

		// indexerContext is still attached; blastRadius falls back to empty array
		const implTask = result.tasks.find((t) => t.id === "impl-core")!;
		expect(implTask.indexerContext).toBeDefined();
		expect(implTask.indexerContext!.blastRadius).toEqual([]);
		// searchHits still populated from the successful broad search
		expect(implTask.indexerContext!.searchHits).toHaveLength(2);
	});

	it("should not attach indexerContext when indexer is explicitly disabled (null)", async () => {
		mockCompletion.mockResolvedValueOnce(twoTaskLLMResponse());
		const decomposer = new TaskDecomposer(mockRouter, null);

		const result = await decomposer.decompose("Build authentication system");

		expect(mockSearch).not.toHaveBeenCalled();
		for (const task of result.tasks) {
			expect(task.indexerContext).toBeUndefined();
		}
	});

	it("should preserve the existing files field alongside indexerContext", async () => {
		mockCompletion.mockResolvedValueOnce(twoTaskLLMResponse());
		const decomposer = new TaskDecomposer(mockRouter, mockIndexerClient);

		const result = await decomposer.decompose("Build authentication system");

		const implTask = result.tasks.find((t) => t.id === "impl-core")!;
		// Original files from LLM are untouched
		expect(implTask.files).toContain("src/core/handler.ts");
		// indexerContext sits alongside, not replacing
		expect(implTask.indexerContext).toBeDefined();
	});
});
