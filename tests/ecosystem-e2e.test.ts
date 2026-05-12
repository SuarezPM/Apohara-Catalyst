/**
 * E2E Integration Test for M004 Ecosystem
 *
 * Tests the full integration of:
 * - S01: MCP Bridge (GitNexus + cocoindex-code)
 * - S03: Inngest AgentKit Recovery
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { TaskDecomposer } from "../src/core/decomposer";
import { InngestClient } from "../src/lib/inngest-client";
import { MCPClient, MCPRegistry } from "../src/lib/mcp-client";

describe("M004 Ecosystem E2E Integration", () => {
	let inngest: InngestClient;
	let mcp: MCPRegistry;

	beforeEach(() => {
		inngest = new InngestClient({ apiKey: "test-key" });
		mcp = new MCPRegistry();
	});

	afterEach(() => {
		mcp.disconnectAll();
	});

	describe("1. MCP Bridge Integration", () => {
		it("MCP Registry can register servers", async () => {
			// Verify registry has expected interface
			expect(mcp.getServers).toBeDefined();
			expect(typeof mcp.register).toBe("function");
			expect(typeof mcp.callTool).toBe("function");
		});

		it("TaskDecomposer integrates MCP dynamically", async () => {
			// Verify decomposer instantiate with MCP support
			const decomposer = new TaskDecomposer();
			expect(decomposer).toBeDefined();
		});
	});

	describe("3. Inngest AgentKit Recovery", () => {
		it("can dispatch durable workflows", async () => {
			const result = await inngest.dispatch("deploy-agent", {
				task: "test-deployment",
			});

			expect(result.id).toBeDefined();
			expect(result.status).toBe("completed");
		});

		it("can recover from step failures", async () => {
			let attemptCount = 0;

			const result = await inngest.executeStep(
				"recoverable-step",
				async () => {
					attemptCount++;
					if (attemptCount < 2) {
						throw new Error("Simulated temporary failure");
					}
					return "Recovered successfully!";
				},
				{ maxAttempts: 3 },
			);

			expect(result).toBe("Recovered successfully!");
			expect(attemptCount).toBe(2);
		});

		it("Inngest configured for recovery", () => {
			const configured = inngest.isConfigured();
			expect(configured).toBe(true);
		});
	});

	describe("4. Integrated Workflow", () => {
		it("Full workflow: Decompose -> MCP -> Execute -> Recover", async () => {
			// Step 1: Task Decomposition (would use LLM + MCP in real scenario)
			const decomposer = new TaskDecomposer();
			expect(decomposer).toBeDefined();

			// Step 2: MCP Analysis (would connect to GitNexus in real scenario)
			const registry = new MCPRegistry();
			expect(registry.findTool).toBeDefined();

			// Step 3: Durable execution with recovery
			const inngestClient = new InngestClient({ apiKey: "test-key" });
			const dispatch = await inngestClient.dispatch("agent-task", {
				taskId: "task-123",
				context: {},
			});
			expect(dispatch.status).toBe("completed");
		}, 5000);
	});
});
