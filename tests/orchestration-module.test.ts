/**
 * M018 Pattern A — OrchestrationModule contract tests.
 *
 * Verifies two things:
 *
 *   1) MockOrchestrationModule can run a full subagent-style loop end-to-end
 *      with zero real I/O — no LLM calls, no git worktrees, no Rust binaries.
 *      This is the load-bearing requirement: if the interface is too narrow,
 *      the mock can't drive the loop; if too wide, the mock has to fake too
 *      much.
 *
 *   2) The real concrete classes structurally satisfy the adapter contracts
 *      via `createDefaultOrchestrationModule`. The `satisfies` checks in
 *      default-module.ts enforce this at compile time, so this test merely
 *      asserts the module is constructible and exposes all 8 adapters.
 */

import { describe, expect, it } from "bun:test";
import { createDefaultOrchestrationModule } from "../src/core/orchestration/default-module";
import type {
	ConsolidatorAdapter,
	DecomposerAdapter,
	LedgerAdapter,
	OrchestrationModule,
	PlannerAdapter,
	SchedulerAdapter,
	SubagentAdapter,
	VerifierAdapter,
	WorktreeAdapter,
} from "../src/core/orchestration/module";
import type { DecomposedTask, DecompositionResult } from "../src/core/decomposer";
import type { TaskExecutionResult } from "../src/core/scheduler";
import type { SubagentResult } from "../src/core/subagent-manager";
import type { ConsolidationResult } from "../src/core/consolidator";
import type {
	MeshExecutionOptions,
	MeshResult,
} from "../src/core/verification-mesh";
import type { WorktreeEntry } from "../src/core/worktree-manager";
import type { EventLog, EventSeverity, ProviderId, TaskRole } from "../src/core/types";

/**
 * Hand-rolled mock that drives the subagent loop without any real I/O.
 *
 * Each adapter records its calls so the test can assert ordering.
 */
class MockOrchestrationModule implements OrchestrationModule {
	calls: string[] = [];
	worktreeMap = new Map<string, string>();
	logEvents: Array<{ type: string; payload: Record<string, unknown> }> = [];

	planner: PlannerAdapter = {
		planSlice: async (prompt: string): Promise<DecomposedTask[]> => {
			this.calls.push(`planSlice:${prompt}`);
			return [
				{
					id: "t1",
					description: "first slice",
					estimatedComplexity: "low",
					dependencies: [],
					role: "execution",
				},
			];
		},
	};

	decomposer: DecomposerAdapter = {
		decompose: async (prompt: string): Promise<DecompositionResult> => {
			this.calls.push(`decompose:${prompt}`);
			return {
				originalPrompt: prompt,
				tasks: [
					{
						id: "t1",
						description: "execute the work",
						estimatedComplexity: "low",
						dependencies: [],
						role: "execution",
					},
				],
			};
		},
	};

	scheduler: SchedulerAdapter = {
		executeAll: async (
			tasks: DecomposedTask[],
		): Promise<TaskExecutionResult[]> => {
			this.calls.push(`schedule:${tasks.map((t) => t.id).join(",")}`);
			return tasks.map((t) => ({
				taskId: t.id,
				status: "success" as const,
				output: "ok",
				worktreeId: `lane-${t.id}`,
			}));
		},
	};

	subagent: SubagentAdapter = {
		executeAll: async (
			tasks: Array<{
				id: string;
				description: string;
				dependencies: string[];
				role: TaskRole;
			}>,
		): Promise<SubagentResult[]> => {
			this.calls.push(`subagent:${tasks.length}`);
			return tasks.map((t) => ({
				taskId: t.id,
				role: t.role,
				status: "completed" as const,
				provider: "groq" as ProviderId,
				retries: 0,
				durationMs: 1,
				output: "mock output",
			}));
		},
	};

	verifier: VerifierAdapter = {
		execute: async (options: MeshExecutionOptions): Promise<MeshResult> => {
			this.calls.push(`verify:${options.taskId}`);
			return {
				agentA: { provider: "groq", response: { content: "ok" }, exitCode: 0 },
				meshApplied: false,
				meshCostDelta: 0,
				totalCost: 0,
			};
		},
	};

	consolidator: ConsolidatorAdapter = {
		run: async (): Promise<ConsolidationResult> => {
			this.calls.push("consolidate");
			return {
				branch: "mock-branch",
				successfulWorktrees: Array.from(this.worktreeMap.keys()),
				failedWorktrees: [],
				exitCode: 0,
			};
		},
	};

	ledger: LedgerAdapter = {
		log: async (
			type: string,
			payload: Record<string, unknown>,
			_severity?: EventSeverity,
			_taskId?: string,
			_metadata?: EventLog["metadata"],
		): Promise<void> => {
			this.logEvents.push({ type, payload });
		},
		logProviderOutcome: async (
			provider: ProviderId,
			role: TaskRole,
			success: boolean,
		): Promise<void> => {
			this.logEvents.push({
				type: "provider_outcome",
				payload: { provider, role, success },
			});
		},
	};

	worktree: WorktreeAdapter = {
		create: async (taskId: string): Promise<string> => {
			const path = `/mock/wt/${taskId}`;
			this.worktreeMap.set(taskId, path);
			this.calls.push(`wt.create:${taskId}`);
			return path;
		},
		cleanup: async (taskId: string): Promise<void> => {
			this.worktreeMap.delete(taskId);
			this.calls.push(`wt.cleanup:${taskId}`);
		},
		list: async (): Promise<WorktreeEntry[]> => {
			return Array.from(this.worktreeMap.entries()).map(([taskId, path]) => ({
				taskId,
				path,
				createdAt: new Date(0).toISOString(),
				branch: `mock/${taskId}`,
			}));
		},
	};
}

describe("OrchestrationModule — Pattern A", () => {
	it("MockOrchestrationModule can drive a full subagent loop without real I/O", async () => {
		const mod = new MockOrchestrationModule();

		// 1) Decompose prompt → tasks
		const decomposed = await mod.decomposer.decompose("ship feature X");
		expect(decomposed.tasks.length).toBe(1);

		// 2) Provision worktrees for each task
		for (const t of decomposed.tasks) {
			await mod.worktree.create(t.id);
		}
		expect((await mod.worktree.list()).length).toBe(1);

		// 3) Dispatch subagents in parallel
		const subagentResults = await mod.subagent.executeAll(
			decomposed.tasks.map((t) => ({
				id: t.id,
				description: t.description,
				dependencies: t.dependencies,
				role: t.role,
			})),
		);
		expect(subagentResults.every((r) => r.status === "completed")).toBe(true);

		// 4) Verify the critical task
		const verdict = await mod.verifier.execute({
			taskId: subagentResults[0].taskId,
			role: subagentResults[0].role,
			task: {
				id: subagentResults[0].taskId,
				messages: [{ role: "user", content: "verify" }],
				complexity: "high",
				filesModified: 5,
			},
		});
		expect(verdict.agentA.exitCode).toBe(0);

		// 5) Log the outcome
		await mod.ledger.log(
			"task_completed",
			{ taskId: subagentResults[0].taskId },
			"info",
		);
		await mod.ledger.logProviderOutcome("groq", "execution", true);
		expect(mod.logEvents.length).toBe(2);

		// 6) Consolidate
		const consolidation = await mod.consolidator.run();
		expect(consolidation.exitCode).toBe(0);
		expect(consolidation.successfulWorktrees.length).toBe(1);

		// 7) Cleanup
		for (const t of decomposed.tasks) {
			await mod.worktree.cleanup(t.id);
		}
		expect((await mod.worktree.list()).length).toBe(0);

		// Ordering sanity — every adapter participated.
		expect(mod.calls).toEqual([
			"decompose:ship feature X",
			"wt.create:t1",
			"subagent:1",
			"verify:t1",
			"consolidate",
			"wt.cleanup:t1",
		]);
	});

	it("createDefaultOrchestrationModule wires all 8 adapters from real classes", () => {
		const mod = createDefaultOrchestrationModule();
		expect(typeof mod.planner.planSlice).toBe("function");
		expect(typeof mod.decomposer.decompose).toBe("function");
		expect(typeof mod.scheduler.executeAll).toBe("function");
		expect(typeof mod.subagent.executeAll).toBe("function");
		expect(typeof mod.verifier.execute).toBe("function");
		expect(typeof mod.consolidator.run).toBe("function");
		expect(typeof mod.ledger.log).toBe("function");
		expect(typeof mod.ledger.logProviderOutcome).toBe("function");
		expect(typeof mod.worktree.create).toBe("function");
		expect(typeof mod.worktree.cleanup).toBe("function");
		expect(typeof mod.worktree.list).toBe("function");
	});
});
