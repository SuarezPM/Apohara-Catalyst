import { describe, expect, it } from "bun:test";
import { extractAgents } from "../../packages/tui/components/AgentStatus.tsx";
import { extractCosts } from "../../packages/tui/hooks/useCostTable.tsx";
import { extractTasks } from "../../packages/tui/hooks/useTaskList.tsx";
import type { EventLog } from "../../src/core/types.ts";

function makeEvent(partial: Partial<EventLog>): EventLog {
	return {
		id: "evt-1",
		timestamp: "2026-04-30T12:00:00Z",
		type: "task_scheduled",
		severity: "info",
		payload: {},
		...partial,
	} as EventLog;
}

describe("TUI pure functions", () => {
	describe("extractTasks", () => {
		it("returns empty array for no events", () => {
			expect(extractTasks([])).toEqual([]);
		});

		it("extracts tasks from task events", () => {
			const events: EventLog[] = [
				makeEvent({
					type: "task_scheduled",
					taskId: "t1",
					payload: { description: "Build API" },
				}),
				makeEvent({
					type: "task_completed",
					taskId: "t1",
					payload: { description: "Build API" },
				}),
			];
			const tasks = extractTasks(events);
			expect(tasks).toHaveLength(1);
			expect(tasks[0].id).toBe("t1");
			expect(tasks[0].status).toBe("completed");
		});
	});

	describe("extractCosts", () => {
		it("returns empty results for no events", () => {
			const result = extractCosts([]);
			expect(result.rows).toEqual([]);
			expect(result.totalCostUsd).toBe(0);
		});

		it("aggregates costs by provider", () => {
			const events: EventLog[] = [
				makeEvent({
					type: "llm_request",
					metadata: {
						provider: "deepseek-v4",
						costUsd: 0.002,
						tokens: { prompt: 100, completion: 50, total: 150 },
					},
				}),
				makeEvent({
					type: "llm_request",
					metadata: {
						provider: "deepseek-v4",
						costUsd: 0.003,
						tokens: { prompt: 200, completion: 100, total: 300 },
					},
				}),
			];
			const result = extractCosts(events);
			expect(result.rows).toHaveLength(1);
			expect(result.rows[0].costUsd).toBeCloseTo(0.005, 3);
			expect(result.rows[0].tokensTotal).toBe(450);
		});
	});

	describe("extractAgents", () => {
		it("returns empty agents for no events", () => {
			const result = extractAgents([]);
			expect(result.agents).toEqual([]);
			expect(result.fallbackCount).toBe(0);
		});

		it("detects fallback events", () => {
			const events: EventLog[] = [
				makeEvent({
					type: "provider_fallback",
					metadata: {
						fromProvider: "opencode-go",
						toProvider: "minimax-m2.7",
						errorReason: "rate_limit",
					},
				}),
			];
			const result = extractAgents(events);
			expect(result.fallbackCount).toBe(1);
			expect(result.latestFallback?.from).toBe("opencode-go");
			expect(result.latestFallback?.to).toBe("minimax-m2.7");
		});
	});
});
