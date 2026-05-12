/**
 * Tests for Inngest AgentKit Recovery
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { InngestClient, type WorkflowStep } from "../src/lib/inngest-client";

describe("Inngest AgentKit Recovery", () => {
	describe("InngestClient", () => {
		it("should instantiate InngestClient", () => {
			const client = new InngestClient();
			expect(client).toBeDefined();
		});

		it("should be configurable with custom params", () => {
			const client = new InngestClient({
				appId: "test-app",
				apiKey: "test-key",
				baseUrl: "http://localhost:4000/fn",
			});

			expect(client).toBeDefined();
		});

		it("should report configuration status", () => {
			const client = new InngestClient();
			const configured = client.isConfigured();
			expect(typeof configured).toBe("boolean");
		});

		it("should have required methods", () => {
			const client = new InngestClient();

			expect(typeof client.dispatch).toBe("function");
			expect(typeof client.executeStep).toBe("function");
			expect(typeof client.getDispatch).toBe("function");
			expect(typeof client.cancelDispatch).toBe("function");
			expect(typeof client.isConfigured).toBe("function");
			expect(typeof client.sendEvent).toBe("function");
			expect(typeof client.createStepFunction).toBe("function");
		});

		it("should validate isConfigured with API key", () => {
			const client = new InngestClient({ apiKey: "inngest-key" });
			expect(client.isConfigured()).toBe(true);
		});
	});

	describe("Workflow dispatch", () => {
		it("should dispatch a workflow and return result", async () => {
			const client = new InngestClient();

			const result = await client.dispatch("test-workflow", { test: true });

			expect(result.id).toBeDefined();
			expect(result.status).toBe("completed");
		});

		it("should track active dispatches", async () => {
			const client = new InngestClient();

			const result = await client.dispatch("track-test", {});
			const retrieved = await client.getDispatch(result.id);

			expect(retrieved).not.toBeNull();
			expect(retrieved?.id).toBe(result.id);
		});

		it("should cancel a dispatch", async () => {
			const client = new InngestClient();

			const result = await client.dispatch("cancel-test", {});
			await client.cancelDispatch(result.id);

			const cancelled = await client.getDispatch(result.id);
			expect(cancelled?.status).toBe("cancelled");
		});
	});

	describe("Durable step execution", () => {
		it("should execute step successfully on first attempt", async () => {
			const client = new InngestClient();

			const result = await client.executeStep("simple-step", async () => {
				return "success";
			});

			expect(result).toBe("success");
		});

		it("should retry on failure up to max attempts", async () => {
			const client = new InngestClient();

			let attempts = 0;
			const result = await client.executeStep(
				"retry-step",
				async () => {
					attempts++;
					if (attempts < 3) {
						throw new Error("Temporary failure");
					}
					return "recovered";
				},
				{ maxAttempts: 3, retryInterval: 10 },
			);

			expect(result).toBe("recovered");
			expect(attempts).toBe(3);
		});

		it("should throw after all attempts exhausted", async () => {
			const client = new InngestClient();

			try {
				await client.executeStep(
					"fail-step",
					async () => {
						throw new Error("Permanent failure");
					},
					{ maxAttempts: 2 },
				);

				// Should not reach here
				expect(true).toBe(false);
			} catch (error: any) {
				expect(error.message).toBe("Permanent failure");
			}
		});
	});

	describe("WorkflowStep interface", () => {
		it("should create step functions", () => {
			const client = new InngestClient();

			const step: WorkflowStep<string> = client.createStepFunction(
				"test-step",
				async () => "step result",
			);

			expect(step.id).toBe("test-step");
			expect(step.name).toBe("test-step");
			expect(typeof step.execute).toBe("function");
		});
	});
});
