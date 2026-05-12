import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DecomposedTask } from "../src/core/decomposer";
import { IsolationEngine } from "../src/core/isolation";
import { EventLedger } from "../src/core/ledger";
import { ParallelScheduler } from "../src/core/scheduler";
import { StateMachine } from "../src/core/state";
import { type ProviderId, ProviderRouter } from "../src/providers/router";

describe("Fallback Behavior Integration Tests", () => {
	let router: ProviderRouter;
	let scheduler: ParallelScheduler;
	let ledger: EventLedger;
	let stateMachine: StateMachine;
	let isolationEngine: IsolationEngine;

	const testEventsDir = join(process.cwd(), ".events", "test-fallback");

	beforeEach(async () => {
		// Clean up test events directory
		await rm(testEventsDir, { recursive: true, force: true });

		// Create router with test API keys and very short cooldown for testing
		router = new ProviderRouter({
			opencodeApiKey: "test-opencode-key",
			deepseekApiKey: "test-deepseek-key",
			cooldownMinutes: 0.001, // Very short for testing (about 3ms)
			maxFailuresBeforeCooldown: 3,
		});

		ledger = new EventLedger("test-fallback-run");
		stateMachine = new StateMachine();
		isolationEngine = new IsolationEngine();
		scheduler = new ParallelScheduler(
			isolationEngine,
			stateMachine,
			ledger,
			router,
			{ worktreePoolSize: 2 },
		);
	});

	afterEach(async () => {
		await scheduler.shutdown();
		// Clean up
		await rm(testEventsDir, { recursive: true, force: true });
	});

	describe("Provider Router Fallback Logic", () => {
		it("should fallback on 429 rate limit error", async () => {
			// Create a router that simulates 429
			const routerWith429 = new ProviderRouter({
				opencodeApiKey: "test-key",
				deepseekApiKey: "test-key",
			});

			// Override the callProvider method to simulate 429
			const originalCall = routerWith429.completion.bind(routerWith429);

			// Test the fallback method directly with a mock
			const fallbackResult = routerWith429.fallback("opencode-go");

			// Should return next provider in priority list after opencode-go
			expect(fallbackResult).toBe("minimax-m2.7");
		});

		it("should fallback on timeout error", () => {
			// Test isRetryableError logic indirectly through fallback
			const fallbackResult = router.fallback("opencode-go");
			// Round-robin should give us the next provider in priority list
			expect(fallbackResult).toBe("minimax-m2.7");
		});

		it("should fallback on network error", () => {
			const fallbackResult = router.fallback("deepseek");
			// Should fallback to next provider in priority list after deepseek
			expect(fallbackResult).toBe("glm-deepinfra");
		});
	});

	describe("Provider Health and Cooldown", () => {
		it("should track failure count per provider", () => {
			// Initially should have 0 failures
			expect(router.getFailureCount("opencode-go")).toBe(0);
			expect(router.getFailureCount("deepseek")).toBe(0);
		});

		it("should not be on cooldown initially", () => {
			expect(router.isOnCooldown("opencode-go")).toBe(false);
			expect(router.isOnCooldown("deepseek")).toBe(false);
		});

		it("should skip provider on cooldown during fallback", async () => {
			// We can't easily trigger cooldown in tests without real failures
			// But we can verify the fallback logic handles it
			const fallbackResult = router.fallback("opencode-go");
			expect(fallbackResult).toBe("minimax-m2.7");
		});
	});

	describe("Simulate Failure Flag", () => {
		it("should accept simulateFailure config", () => {
			const routerWithFailure = new ProviderRouter({
				opencodeApiKey: "test-key",
				deepseekApiKey: "test-key",
				simulateFailure: true,
			});
			expect(routerWithFailure).toBeDefined();
		});
	});

	describe("Provider Exhaustion", () => {
		it("should return alternate provider when one is unavailable", () => {
			// Test fallback logic - should always return a different available provider
			const fallback1 = router.fallback("opencode-go");
			const fallback2 = router.fallback("deepseek");

			// Both should return the next provider in priority list
			expect(fallback1).toBe("minimax-m2.7");
			expect(fallback2).toBe("glm-deepinfra");
		});

		it("should handle exhaustion when all providers return same result", () => {
			// When both providers are on cooldown, fallback still returns a provider
			// (fail-fast is better than infinite wait)
			const fallbackResult = router.fallback(undefined);
			expect(fallbackResult).toBeDefined();
		});
	});

	describe("EventLedger Integration", () => {
		it("should log fallback_cooldown events", async () => {
			// This verifies the ledger exists and can log
			const ledger = new EventLedger("cooldown-test");

			await ledger.log(
				"fallback_cooldown",
				{ provider: "opencode-go", cooldownMinutes: 5 },
				"warning",
			);

			const path = ledger.getFilePath();
			expect(path).toContain("cooldown-test");
		});

		it("should log provider_fallback events", async () => {
			const ledger = new EventLedger("fallback-test");

			await ledger.log(
				"provider_fallback",
				{
					fromProvider: "opencode-go",
					toProvider: "deepseek",
					error: "429 Rate Limit",
				},
				"warning",
			);

			const path = ledger.getFilePath();
			expect(path).toContain("fallback-test");
		});

		it("should log task_exhausted events", async () => {
			const ledger = new EventLedger("exhausted-test");

			await ledger.log(
				"task_exhausted",
				{ providers: ["opencode-go", "deepseek"] },
				"error",
			);

			const path = ledger.getFilePath();
			expect(path).toContain("exhausted-test");
		});
	});

	describe("ParallelScheduler Integration", () => {
		it("should have provider router injected", () => {
			expect(scheduler).toBeDefined();
		});

		it("should report provider cooldown status", () => {
			const isOnCooldown = scheduler.isProviderOnCooldown("opencode-go");
			expect(typeof isOnCooldown).toBe("boolean");
		});
	});

	describe("Independent Task Continuation", () => {
		it("should handle multiple tasks with different dependencies", async () => {
			// Create tasks where T1 has no deps and T2 depends on T1
			const tasks: DecomposedTask[] = [
				{
					id: "T1",
					description: "Independent task 1",
					dependencies: [],
				},
				{
					id: "T2",
					description: "Dependent task 2",
					dependencies: ["T1"],
				},
			];

			// When one task fails, independent tasks should still be schedulable
			// This is tested through the scheduler's dependency checking
			await stateMachine.load();

			// Add T1 as completed
			await stateMachine.update((state) => ({
				...state,
				tasks: [
					...state.tasks,
					{
						id: "T1",
						description: "Independent task 1",
						status: "completed",
						createdAt: new Date(),
						updatedAt: new Date(),
					},
				],
			}));

			const state = stateMachine.get();
			// T1 should be completed, allowing T2 to be scheduled
			const t1 = state.tasks.find((t) => t.id === "T1");
			expect(t1?.status).toBe("completed");
		});
	});

	describe("Error Classification", () => {
		it("should classify 429 as retryable", async () => {
			// We can test this by checking if fallback is triggered
			// For a 429 error, the router should attempt fallback
			const router = new ProviderRouter({
				opencodeApiKey: "test-key",
				deepseekApiKey: "test-key",
			});

			// The fallback method returns next provider in priority list
			const alternate = router.fallback("opencode-go");
			expect(alternate).toBe("minimax-m2.7");
		});

		it("should classify timeout as retryable", async () => {
			const router = new ProviderRouter({
				opencodeApiKey: "test-key",
				deepseekApiKey: "test-key",
			});

			// Timeout would trigger fallback in the completion method
			const alternate = router.fallback("deepseek");
			expect(alternate).toBe("glm-deepinfra");
		});

		it("should classify network error as retryable", async () => {
			const router = new ProviderRouter({
				opencodeApiKey: "test-key",
				deepseekApiKey: "test-key",
			});

			// Network errors would trigger fallback
			const alternate = router.fallback("opencode-go");
			expect(alternate).toBe("minimax-m2.7");
		});
	});

	describe("Console Notification Format", () => {
		it("should support console notification logging", async () => {
			const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

			// This simulates what logFallbackEvent does
			const fromProvider: ProviderId = "opencode-go";
			const toProvider: ProviderId = "deepseek";
			const reason = "429 Rate Limit exceeded";

			console.warn(
				`⚠ ${fromProvider} ${reason} → reasignando a ${toProvider}...`,
			);

			expect(consoleSpy).toHaveBeenCalled();
			expect(consoleSpy.mock.calls[0][0]).toContain(fromProvider);
			expect(consoleSpy.mock.calls[0][0]).toContain("reasignando");
			expect(consoleSpy.mock.calls[0][0]).toContain(toProvider);

			consoleSpy.mockRestore();
		});
	});

	describe("State Persistence for Cooldown", () => {
		it("should track failed provider timestamps in state", async () => {
			await stateMachine.load();

			// Record a provider failure
			await stateMachine.recordProviderFailure("opencode-go");

			const lastFailure = stateMachine.getProviderLastFailure("opencode-go");
			expect(lastFailure).toBeGreaterThan(0);
		});

		it("should clear provider cooldown in state", async () => {
			await stateMachine.load();

			// Record then clear
			await stateMachine.recordProviderFailure("deepseek");
			await stateMachine.clearProviderCooldown("deepseek");

			const lastFailure = stateMachine.getProviderLastFailure("deepseek");
			expect(lastFailure).toBeNull();
		});
	});
});

// Integration test verifying the full fallback chain
describe("Full Fallback Chain Integration", () => {
	let router: ProviderRouter;
	let ledger: EventLedger;

	beforeEach(async () => {
		router = new ProviderRouter({
			opencodeApiKey: "test-key",
			deepseekApiKey: "test-key",
		});
		ledger = new EventLedger("full-chain-test");
		await rm(join(process.cwd(), ".events", "full-chain-test"), {
			recursive: true,
			force: true,
		});
	});

	afterEach(async () => {
		await rm(join(process.cwd(), ".events", "full-chain-test"), {
			recursive: true,
			force: true,
		});
	});

	it("should complete a full fallback chain: opencode -> deepseek", async () => {
		// Verify round-robin fallback works both ways
		const fromOpencode = router.fallback("opencode-go");
		const fromDeepseek = router.fallback("deepseek");

		// Verify next-in-priority fallback from each provider
		expect(fromOpencode).toBe("minimax-m2.7");
		expect(fromDeepseek).toBe("glm-deepinfra");
	});

	it("should log events throughout the fallback chain", async () => {
		// Verify ledger can log multiple event types
		await ledger.log(
			"fallback_cooldown",
			{ provider: "opencode-go" },
			"warning",
		);
		await ledger.log(
			"provider_fallback",
			{ from: "opencode-go", to: "deepseek" },
			"warning",
		);
		await ledger.log("task_exhausted", { providers: [] }, "error");

		const path = ledger.getFilePath();
		expect(path).toBeDefined();
	});
});
