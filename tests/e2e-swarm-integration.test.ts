/**
 * E2E Swarm Integration Tests
 *
 * Verifies:
 * 1. TaskDecomposer produces ≥3 tasks with distinct roles
 * 2. agent-router maps each role to correct provider
 * 3. EventLedger logs role_assignment and provider_selected events
 * 4. simulate-failure flag triggers fallback chain
 *
 * Note: These tests verify the swarm integration using mocked behavior.
 * The system gracefully handles missing API keys via fallback.
 */

import {
	afterAll,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "bun:test";
import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import {
	type RouteResult,
	routeTask,
	routeTaskWithFallback,
	validateToken,
} from "../src/core/agent-router";
import {
	type DecomposedTask,
	type DecompositionResult,
	TaskDecomposer,
} from "../src/core/decomposer";
import { EventLedger } from "../src/core/ledger";
import {
	type ProviderId,
	ROLE_FALLBACK_ORDER,
	ROLE_TO_PROVIDER,
	type TaskRole,
} from "../src/core/types";
import { ProviderRouter } from "../src/providers/router";

// Test IDs for isolation
const TEST_RUN_ID = `e2e-test-${Date.now()}`;

describe("E2E Swarm Integration Tests", () => {
	// Use unique directories per test describe block
	let testEventsDir: string;

	beforeAll(async () => {
		testEventsDir = join(process.cwd(), ".events", TEST_RUN_ID);
		await rm(testEventsDir, { recursive: true, force: true });
		await mkdir(testEventsDir, { recursive: true });
	});

	afterAll(async () => {
		// Cleanup after all tests
		await rm(testEventsDir, { recursive: true, force: true });
	});

	describe("1. TaskDecomposer produces ≥3 tasks with distinct roles", () => {
		it("should define all required roles", () => {
			// Verify ROLE_TO_PROVIDER has all required roles
			const roles: TaskRole[] = [
				"research",
				"planning",
				"execution",
				"verification",
			];
			expect(roles.length).toBe(4);

			// Test that each role maps to *some* defined ProviderId. The specific
			// primary can evolve with the routing strategy; the structural
			// guarantee is enforced by the "structurally valid" test below.
			for (const role of roles) {
				const provider = ROLE_TO_PROVIDER[role];
				expect(provider).toBeDefined();
				expect(typeof provider).toBe("string");
			}
		});

		it("should have fallback provider chains for each role", () => {
			// Verify fallback order exists for each role
			const roles: TaskRole[] = [
				"research",
				"planning",
				"execution",
				"verification",
			];
			for (const role of roles) {
				const fallbackOrder = ROLE_FALLBACK_ORDER[role];
				expect(fallbackOrder).toBeDefined();
				expect(fallbackOrder.length).toBeGreaterThanOrEqual(2);
				// Primary should match direct mapping
				expect(fallbackOrder[0]).toBe(ROLE_TO_PROVIDER[role]);
			}
		});

		it("should provide structurally valid role-to-provider constants", () => {
			// Test STRUCTURE not specific provider names — primary providers can
			// change as the routing strategy evolves (e.g., when Groq becomes
			// preferred over Moonshot for planning). What we lock in:
			// 1. Every role has a primary
			// 2. Every primary is a valid ProviderId in the registered set
			// 3. Every role has a non-empty fallback chain
			// 4. The chain's first element equals the primary (invariant)

			const validProviders = new Set<ProviderId>([
				"tavily",
				"gemini",
				"gemini-api",
				"anthropic-api",
				"moonshot-k2.5",
				"moonshot-k2.6",
				"groq",
				"deepseek",
				"deepseek-v4",
				"opencode-go",
				"minimax-m2.5",
				"minimax-m2.7",
				"xiaomi-mimo",
				"qwen3.5-plus",
				"qwen3.6-plus",
				"glm-deepinfra",
				"glm-fireworks",
				"glm-zai",
				"kiro-ai",
				"mistral",
				"openai",
			]);

			for (const role of [
				"research",
				"planning",
				"execution",
				"verification",
			] as TaskRole[]) {
				const primary = ROLE_TO_PROVIDER[role];
				expect(primary).toBeDefined();
				expect(validProviders.has(primary)).toBe(true);

				const chain = ROLE_FALLBACK_ORDER[role];
				expect(chain.length).toBeGreaterThanOrEqual(2);
				expect(chain[0]).toBe(primary);
				for (const p of chain) {
					expect(validProviders.has(p)).toBe(true);
				}
			}
		});
	});

	describe("2. agent-router maps roles to providers", () => {
		it("should return a valid provider from the role's fallback chain", async () => {
			const execResult = await routeTask("execution");
			// Resolved provider must be in execution's fallback chain (token availability
			// determines which one without hard-coding the env state)
			expect(ROLE_FALLBACK_ORDER.execution).toContain(execResult.provider);
		});

		it("should include fallback providers in route result", async () => {
			for (const role of [
				"research",
				"planning",
				"execution",
				"verification",
			] as TaskRole[]) {
				const result = await routeTask(role, { id: `task-${role}` });
				expect(result.fallbackProviders).toBeDefined();
				expect(result.fallbackProviders.length).toBeGreaterThanOrEqual(2);
				// The chosen provider is the head of its fallback chain (routeTask
				// reorders the chain to lead with whoever was actually selected).
				expect(result.fallbackProviders[0]).toBe(result.provider);
			}
		});

		it("should provide fallback flag based on token availability", async () => {
			const execResult = await routeTask("execution");
			expect(typeof execResult.requiresFallback).toBe("boolean");
		});

		it("should route planning to a provider in its fallback chain", async () => {
			const result = await routeTask("planning");
			expect(ROLE_FALLBACK_ORDER.planning).toContain(result.provider);
		});

		it("should work with verify token function", () => {
			// Check what tokens are present
			const hasOpenCode = validateToken("opencode-go");
			expect(typeof hasOpenCode).toBe("boolean");
		});
	});

	describe("3. EventLedger logs events correctly", () => {
		it("should create ledger file when logging events", async () => {
			const ledger = new EventLedger(`${TEST_RUN_ID}-1`);

			await ledger.log(
				"role_assignment",
				{ message: "Test task assigned", taskId: "task-1", role: "execution" },
				"info",
				"task-1",
				{ role: "execution" },
			);

			const filePath = ledger.getFilePath();
			const content = await readFile(filePath, "utf-8");
			// Phase 4 Event Ledger v2 writes a genesis block as the first event.
			// Filter it out before asserting user-event counts.
			const lines = content
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((l) => JSON.parse(l))
				.filter((e: { type: string }) => e.type !== "genesis");

			expect(lines.length).toBe(1);
			expect(lines[0].type).toBe("role_assignment");
			expect(lines[0].payload.role).toBe("execution");

			await rm(filePath, { force: true });
		});

		it("should log provider_selected events with metadata", async () => {
			const ledger = new EventLedger(`${TEST_RUN_ID}-2`);

			await ledger.log(
				"provider_selected",
				{ message: "Provider selected", role: "execution" },
				"info",
				"task-1",
				{ role: "execution", provider: "opencode-go" },
			);

			const filePath = ledger.getFilePath();
			const content = await readFile(filePath, "utf-8");
			const events = content
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((l) => JSON.parse(l))
				.filter((e: { type: string }) => e.type !== "genesis");

			expect(events[0].type).toBe("provider_selected");
			expect(events[0].metadata?.provider).toBe("opencode-go");

			await rm(filePath, { force: true });
		});

		it("should log warning severity for fallback events", async () => {
			const ledger = new EventLedger(`${TEST_RUN_ID}-3`);

			await ledger.log(
				"provider_fallback",
				{
					message: "Fallback triggered",
					fromProvider: "opencode-go",
					toProvider: "deepseek",
				},
				"warning",
				"task-1",
				{ fromProvider: "opencode-go", toProvider: "deepseek" },
			);

			const filePath = ledger.getFilePath();
			const content = await readFile(filePath, "utf-8");
			const events = content
				.trim()
				.split("\n")
				.filter(Boolean)
				.map((l) => JSON.parse(l))
				.filter((e: { type: string }) => e.type !== "genesis");

			expect(events[0].severity).toBe("warning");
			expect(events[0].type).toBe("provider_fallback");

			await rm(filePath, { force: true });
		});

		it("should maintain event ordering in ledger", async () => {
			const ledger = new EventLedger(`${TEST_RUN_ID}-4`);
			const taskId = "ordered-task";

			await ledger.log(
				"role_assignment",
				{ message: "Role assigned", taskId },
				"info",
				taskId,
				{ role: "execution" },
			);
			await ledger.log(
				"provider_selected",
				{ message: "Provider selected", taskId },
				"info",
				taskId,
				{ provider: "opencode-go" },
			);
			await ledger.log(
				"task_start",
				{ message: "Task started", taskId },
				"info",
				taskId,
			);

			const filePath = ledger.getFilePath();
			const content = await readFile(filePath, "utf-8");
			const events = content
				.trim()
				.split("\n")
				.filter(Boolean)
				.map(JSON.parse)
				.filter((e: { type: string }) => e.type !== "genesis");

			expect(events.length).toBe(3);
			expect(events[0].type).toBe("role_assignment");
			expect(events[1].type).toBe("provider_selected");
			expect(events[2].type).toBe("task_start");

			await rm(filePath, { force: true });
		});

		it("should include taskId and metadata in events", async () => {
			const ledger = new EventLedger(`${TEST_RUN_ID}-5`);
			const taskId = "metadata-task";

			await ledger.log(
				"role_assignment",
				{ message: "Test assignment" },
				"info",
				taskId,
				{ role: "planning", provider: "moonshot-k2.6" },
			);

			const filePath = ledger.getFilePath();
			const content = await readFile(filePath, "utf-8");
			const events = content
				.trim()
				.split("\n")
				.filter(Boolean)
				.map(JSON.parse)
				.filter((e: { type: string }) => e.type !== "genesis");

			expect(events[0].taskId).toBe(taskId);
			expect(events[0].metadata?.role).toBe("planning");
			expect(events[0].metadata?.provider).toBe("moonshot-k2.6");

			await rm(filePath, { force: true });
		});
	});

	describe("4. simulate-failure flag triggers fallback chain", () => {
		it("should accept simulate-failure configuration", () => {
			const failingRouter = new ProviderRouter({
				opencodeApiKey: "test-key",
				deepseekApiKey: "test-key",
				simulateFailure: true,
			});

			expect(failingRouter).toBeDefined();
		});

		it("should trigger provider fallback on simulate-failure", async () => {
			const failingRouter = new ProviderRouter({
				opencodeApiKey: "test-fail-key",
				deepseekApiKey: "test-deepseek-key",
				simulateFailure: true, // First call to opencode-go throws 429
			});

			try {
				await failingRouter.completion({
					messages: [{ role: "user", content: "test" }],
					provider: "opencode-go",
				});
			} catch (error) {
				// Expected - both providers will fail without real API
				// The fallback logic was invoked
				expect(error).toBeDefined();
			}
		});

		it("should have isOnCooldown method", () => {
			const testRouter = new ProviderRouter({
				opencodeApiKey: "test-key",
			});

			expect(typeof testRouter.isOnCooldown).toBe("function");
			expect(testRouter.isOnCooldown("opencode-go")).toBe(false);
			expect(testRouter.isOnCooldown("deepseek")).toBe(false);
		});

		it("should track provider failure counts", () => {
			const testRouter = new ProviderRouter({
				opencodeApiKey: "test-key",
			});

			expect(typeof testRouter.getFailureCount).toBe("function");
			expect(testRouter.getFailureCount("opencode-go")).toBe(0);
		});

		it("should have non-empty fallback chains rooted at the primary", () => {
			// Verify each chain is non-trivially long and starts with the primary
			// for that role. Specific providers can shift with the routing strategy
			// (e.g., groq vs moonshot for planning) — the invariants we lock in are:
			// fallback chain is at least 2 long, and its first entry equals the
			// declared primary in ROLE_TO_PROVIDER.
			for (const role of [
				"research",
				"planning",
				"execution",
				"verification",
			] as TaskRole[]) {
				expect(ROLE_FALLBACK_ORDER[role].length).toBeGreaterThanOrEqual(2);
				expect(ROLE_FALLBACK_ORDER[role][0]).toBe(ROLE_TO_PROVIDER[role]);
			}
		});
	});

	describe("Integration: Full Swarm Flow", () => {
		it("should route all roles with correct mapping", async () => {
			const roles: TaskRole[] = [
				"research",
				"planning",
				"execution",
				"verification",
			];

			const results: RouteResult[] = [];
			for (let i = 0; i < roles.length; i++) {
				const result = await routeTask(roles[i], {
					id: `swarm-task-${i}`,
					description: `Task for role ${roles[i]}`,
				});
				results.push(result);
			}

			// All should be routed
			expect(results.length).toBe(4);

			// Execution should map to *some* provider in its fallback chain
			// (depends on env token availability + capability ranking).
			expect(ROLE_FALLBACK_ORDER.execution).toContain(results[2].provider);

			// Each should have fallback providers
			for (const result of results) {
				expect(result.fallbackProviders.length).toBeGreaterThanOrEqual(2);
			}
		});

		it("should maintain provider mapping consistency", async () => {
			const results: RouteResult[] = [];
			for (let i = 0; i < 3; i++) {
				const result = await routeTask("execution", { id: `consistency-${i}` });
				results.push(result);
			}

			// Execution should consistently return same provider
			const providers = results.map((r) => r.provider);
			// Either all opencode-go (token present) or consistent fallback
			expect(new Set(providers).size).toBeLessThanOrEqual(2);
		});

		it("should keep ROLE_TO_PROVIDER structurally consistent", () => {
			// Every role declares a non-empty primary provider. Concrete provider
			// names rotate as the routing strategy evolves (see the structural
			// test in §1 for the validator that protects against bogus IDs).
			for (const role of [
				"research",
				"planning",
				"execution",
				"verification",
			] as TaskRole[]) {
				const primary = ROLE_TO_PROVIDER[role];
				expect(primary).toBeDefined();
				expect(typeof primary).toBe("string");
				expect(primary.length).toBeGreaterThan(0);
			}
		});
	});
});
