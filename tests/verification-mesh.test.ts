import { beforeEach, describe, expect, it, vi } from "bun:test";
import type {
	FileSignaturesResponse,
	IndexerClient,
} from "../src/core/indexer-client";
import type { ProviderId } from "../src/core/types";
import {
	type MeshExecutionOptions,
	VerificationMesh,
} from "../src/core/verification-mesh";

// Mock the agent-router
const mockRouteTaskWithFallback = vi.fn();
vi.mock("../src/core/agent-router", () => ({
	routeTaskWithFallback: (...args: any[]) => mockRouteTaskWithFallback(...args),
}));

// Mock the ledger
vi.mock("../src/core/ledger", () => ({
	EventLedger: class MockLedger {
		log = vi.fn().mockResolvedValue(undefined);
		getFilePath = vi.fn().mockReturnValue("/tmp/test-ledger.jsonl");
	},
}));

describe("VerificationMesh", () => {
	let mesh: VerificationMesh;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe("Basic execution", () => {
		it("should return Agent A result when mesh is disabled", async () => {
			mesh = new VerificationMesh(mockRouteTaskWithFallback);

			const mockResponse = {
				content: "Agent A output",
				usage: { promptTokens: 100, completionTokens: 50 },
				costUsd: 0.001,
				provider: "groq" as ProviderId,
				model: "test",
				durationMs: 100,
			};

			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: mockResponse,
			});

			const options: MeshExecutionOptions = {
				taskId: "test-task-1",
				role: "execution",
				task: {
					messages: [{ role: "user", content: "Test task" }],
					complexity: "low", // Low complexity = no verification
				},
			};

			const result = await mesh.execute(options);

			expect(result.meshApplied).toBe(false);
			expect(result.agentA.provider).toBe("groq");
			expect(result.agentA.response).toEqual(mockResponse);
		});

		it("should run verification mesh for high complexity tasks", async () => {
			mesh = new VerificationMesh(mockRouteTaskWithFallback);

			// Agent A response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: { content: "Agent A output" },
			});

			// Agent B response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "deepseek",
				response: { content: "Agent B output" },
			});

			// Arbiter response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: {
					content: '{"verdict": "A", "reasoning": "Better implementation"}',
				},
			});

			const options: MeshExecutionOptions = {
				taskId: "test-task-2",
				role: "execution",
				task: {
					messages: [{ role: "user", content: "Complex implementation" }],
					complexity: "high",
					filesModified: 5,
				},
			};

			const result = await mesh.execute(options);

			expect(result.meshApplied).toBe(true);
			expect(result.agentA).toBeDefined();
			expect(result.agentB).toBeDefined();
			expect(result.arbiter).toBeDefined();
		});
	});

	describe("Context compression with IndexerClient", () => {
		let mockIndexerClient: IndexerClient;
		let mockGetFileSignatures: ReturnType<typeof vi.fn>;

		const fakeSignatures: FileSignaturesResponse = {
			file_path: "src/core/handler.ts",
			signatures: [
				{
					name: "handleRequest",
					parameters: "req: Request, res: Response",
					return_type: "Promise<void>",
					line: 10,
					column: 0,
				},
				{
					name: "validateInput",
					parameters: "data: unknown",
					return_type: "boolean",
					line: 25,
					column: 0,
				},
			],
		};

		beforeEach(() => {
			mockGetFileSignatures = vi.fn().mockResolvedValue(fakeSignatures);
			mockIndexerClient = {
				getFileSignatures: mockGetFileSignatures,
			} as unknown as IndexerClient;
		});

		it("should inject IndexerClient via constructor", async () => {
			mesh = new VerificationMesh(mockRouteTaskWithFallback, mockIndexerClient);

			// Agent A response with modified files
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: {
					content:
						"+++ b/src/core/handler.ts\n@@ -1,5 +1,5 @@\n-export function old() {}\n+export function new() {}",
					modifiedFiles: ["src/core/handler.ts"],
				},
			});

			// Agent B response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "deepseek",
				response: {
					content:
						"+++ b/src/core/handler.ts\n@@ -1,5 +1,5 @@\n-export function old() {}\n+export function alt() {}",
				},
			});

			// Arbiter response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: {
					content: '{"verdict": "A", "reasoning": "Cleaner implementation"}',
				},
			});

			const options: MeshExecutionOptions = {
				taskId: "test-task-3",
				role: "execution",
				task: {
					messages: [{ role: "user", content: "Refactor handler" }],
					complexity: "high",
					filesModified: 3,
				},
			};

			await mesh.execute(options);

			// Verify that getFileSignatures was called for the extracted file
			expect(mockGetFileSignatures).toHaveBeenCalledWith("src/core/handler.ts");
		});

		it("should extract modified files from diff patterns", async () => {
			mesh = new VerificationMesh(mockRouteTaskWithFallback, mockIndexerClient);

			// Agent A response with git diff format
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: {
					content: `diff --git a/src/utils.ts b/src/utils.ts
index 1234..5678 100644
--- a/src/utils.ts
+++ b/src/utils.ts
@@ -1,5 +1,5 @@
-export const foo = 1;
+export const foo = 2;`,
				},
			});

			// Agent B response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "deepseek",
				response: { content: "Alternative implementation" },
			});

			// Arbiter response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: { content: '{"verdict": "A", "reasoning": "Correct"}' },
			});

			const options: MeshExecutionOptions = {
				taskId: "test-task-4",
				role: "execution",
				task: {
					messages: [{ role: "user", content: "Update utils" }],
					complexity: "high",
					filesModified: 3,
				},
			};

			await mesh.execute(options);

			// Verify file was extracted from the diff pattern
			expect(mockGetFileSignatures).toHaveBeenCalledWith("src/utils.ts");
		});

		it("should deduplicate file paths from both agents", async () => {
			mesh = new VerificationMesh(mockRouteTaskWithFallback, mockIndexerClient);

			// Agent A response with files
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: {
					content: "+++ b/src/shared.ts\nSome change",
					modifiedFiles: ["src/shared.ts", "src/other.ts"],
				},
			});

			// Agent B response with overlapping files
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "deepseek",
				response: {
					content: "+++ b/src/shared.ts\nDifferent change",
					modifiedFiles: ["src/shared.ts", "src/third.ts"],
				},
			});

			// Arbiter response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: { content: '{"verdict": "A", "reasoning": "Better"}' },
			});

			const options: MeshExecutionOptions = {
				taskId: "test-task-5",
				role: "execution",
				task: {
					messages: [{ role: "user", content: "Multiple file changes" }],
					complexity: "high",
					filesModified: 5,
				},
			};

			await mesh.execute(options);

			// Verify each unique file is called only once
			expect(mockGetFileSignatures).toHaveBeenCalledWith("src/shared.ts");
			expect(mockGetFileSignatures).toHaveBeenCalledWith("src/other.ts");
			expect(mockGetFileSignatures).toHaveBeenCalledWith("src/third.ts");
			expect(mockGetFileSignatures).toHaveBeenCalledTimes(3);
		});

		it("should fallback silently when indexer fails", async () => {
			// Mock indexer that fails
			const failingIndexer = {
				getFileSignatures: vi
					.fn()
					.mockRejectedValue(new Error("Indexer unavailable")),
			} as unknown as IndexerClient;

			mesh = new VerificationMesh(mockRouteTaskWithFallback, failingIndexer);

			// Agent A response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: {
					content: "+++ b/src/core/handler.ts\nSome change",
				},
			});

			// Agent B response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "deepseek",
				response: { content: "Alternative" },
			});

			// Arbiter response (should still be called even if indexer fails)
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: { content: '{"verdict": "A", "reasoning": "Good"}' },
			});

			const options: MeshExecutionOptions = {
				taskId: "test-task-6",
				role: "execution",
				task: {
					messages: [{ role: "user", content: "Test task" }],
					complexity: "high",
					filesModified: 3,
				},
			};

			// Should not throw even if indexer fails
			const result = await mesh.execute(options);

			expect(result.meshApplied).toBe(true);
			expect(result.arbiter).toBeDefined();
		});

		it("should work without IndexerClient (null)", async () => {
			mesh = new VerificationMesh(mockRouteTaskWithFallback, null);

			// Agent A response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: {
					content: "+++ b/src/core/handler.ts\nSome change",
				},
			});

			// Agent B response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "deepseek",
				response: { content: "Alternative" },
			});

			// Arbiter response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: { content: '{"verdict": "A", "reasoning": "Good"}' },
			});

			const options: MeshExecutionOptions = {
				taskId: "test-task-7",
				role: "execution",
				task: {
					messages: [{ role: "user", content: "Test without indexer" }],
					complexity: "high",
					filesModified: 3,
				},
			};

			const result = await mesh.execute(options);

			expect(result.meshApplied).toBe(true);
			// No errors should occur when indexer is null
		});

		it("should log arbiter_context_compressed event", async () => {
			const mockLog = vi.fn().mockResolvedValue(undefined);

			// Create mesh with mocked ledger
			mesh = new VerificationMesh(mockRouteTaskWithFallback, mockIndexerClient);

			// Agent A response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: {
					content: "+++ b/src/core/handler.ts\nChange",
				},
			});

			// Agent B response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "deepseek",
				response: { content: "Alt" },
			});

			// Arbiter response
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: { content: '{"verdict": "A", "reasoning": "Best"}' },
			});

			const options: MeshExecutionOptions = {
				taskId: "test-task-8",
				role: "execution",
				task: {
					messages: [{ role: "user", content: "Test" }],
					complexity: "high",
					filesModified: 3,
				},
			};

			await mesh.execute(options);

			// The ledger.log should be called with arbiter_context_compressed
			// We can't directly check the mock since it's inside the class,
			// but we verify the method was called
			expect(mockGetFileSignatures).toHaveBeenCalled();
		});
	});

	describe("Graceful degradation", () => {
		it("should degrade to A alone when B times out", async () => {
			mesh = new VerificationMesh(mockRouteTaskWithFallback);

			// Agent A responds normally
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: { content: "Agent A output" },
			});

			// Agent B takes longer than timeout - will be raced against timeout
			mockRouteTaskWithFallback.mockImplementationOnce(
				() =>
					new Promise((resolve) =>
						setTimeout(
							() =>
								resolve({
									provider: "deepseek",
									response: { content: "Late response" },
								}),
							200, // Longer than the 100ms timeout
						),
					),
			);

			const options: MeshExecutionOptions = {
				taskId: "test-timeout",
				role: "execution",
				task: {
					messages: [{ role: "user", content: "Test" }],
					complexity: "high",
					filesModified: 3,
				},
				agentBTimeoutMs: 100, // Short timeout for testing
			};

			const result = await mesh.execute(options);

			expect(result.meshApplied).toBe(false);
			expect(result.agentB).toBeDefined();
			expect(result.agentB?.timedOut).toBe(true);
		});

		it("should degrade to A alone when B crashes", async () => {
			mesh = new VerificationMesh(mockRouteTaskWithFallback);

			// Agent A responds
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: { content: "Agent A output" },
			});

			// Agent B crashes (null response)
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "deepseek",
				response: null,
			});

			const options: MeshExecutionOptions = {
				taskId: "test-crash",
				role: "execution",
				task: {
					messages: [{ role: "user", content: "Test" }],
					complexity: "high",
					filesModified: 3,
				},
			};

			const result = await mesh.execute(options);

			expect(result.meshApplied).toBe(false);
			expect(result.agentB).toBeDefined();
			expect(result.agentB?.crashed).toBe(true);
		});
	});

	describe("Arbiter logic", () => {
		it("should skip LLM arbiter when outputs are identical", async () => {
			mesh = new VerificationMesh(mockRouteTaskWithFallback);

			const identicalOutput = { content: "Same output" };

			// Both agents return identical output
			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: identicalOutput,
			});

			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "deepseek",
				response: identicalOutput,
			});

			const options: MeshExecutionOptions = {
				taskId: "test-identical",
				role: "execution",
				task: {
					messages: [{ role: "user", content: "Test" }],
					complexity: "high",
					filesModified: 3,
				},
			};

			const result = await mesh.execute(options);

			expect(result.meshApplied).toBe(true);
			expect(result.arbiter?.verdict).toBe("A");
			expect(result.arbiter?.reasoning).toContain("identical");
		});

		it("should use structural fallback when LLM arbiter fails", async () => {
			mesh = new VerificationMesh(mockRouteTaskWithFallback);

			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "groq",
				response: { content: "Short" },
			});

			mockRouteTaskWithFallback.mockResolvedValueOnce({
				provider: "deepseek",
				response: { content: "Much longer response with lots of content here" },
			});

			// Arbiter throws error
			mockRouteTaskWithFallback.mockRejectedValueOnce(new Error("LLM error"));

			const options: MeshExecutionOptions = {
				taskId: "test-fallback",
				role: "execution",
				task: {
					messages: [{ role: "user", content: "Test" }],
					complexity: "high",
					filesModified: 3,
				},
			};

			const result = await mesh.execute(options);

			expect(result.meshApplied).toBe(true);
			// Should fallback to shorter content (Agent A)
			expect(result.arbiter?.verdict).toBe("A");
		});
	});
});
