import { renderToString } from "ink";
import type React from "react";
import { describe, expect, it } from "vitest";
import { DashboardProvider } from "../hooks/useDashboard.tsx";
import type { EventLog, Run } from "../types.ts";
import { AgentCostTable, extractAgentCosts } from "./AgentCostTable.tsx";

const mockEvents: EventLog[] = [
	{
		id: "e1",
		timestamp: "2026-04-30T12:00:00Z",
		type: "task_scheduled",
		severity: "info",
		taskId: "agent-alpha",
		payload: {},
		metadata: { provider: "deepseek-v4" },
	},
	{
		id: "e2",
		timestamp: "2026-04-30T12:00:01Z",
		type: "llm_request",
		severity: "info",
		taskId: "agent-alpha",
		payload: {},
		metadata: {
			provider: "deepseek-v4",
			costUsd: 0.0025,
			tokens: { prompt: 1000, completion: 500, total: 1500 },
		},
	},
	{
		id: "e3",
		timestamp: "2026-04-30T12:05:00Z",
		type: "task_scheduled",
		severity: "info",
		taskId: "agent-beta",
		payload: {},
		metadata: { provider: "moonshot-k2.6" },
	},
	{
		id: "e4",
		timestamp: "2026-04-30T12:05:01Z",
		type: "llm_request",
		severity: "info",
		taskId: "agent-beta",
		payload: {},
		metadata: {
			provider: "moonshot-k2.6",
			costUsd: 0.005,
			tokens: { prompt: 2000, completion: 1000, total: 3000 },
		},
	},
	{
		id: "e5",
		timestamp: "2026-04-30T12:10:00Z",
		type: "task_completed",
		severity: "info",
		taskId: "agent-alpha",
		payload: {},
		metadata: {},
	},
];

const mockRun: Run = {
	id: "run-1",
	startedAt: "2026-04-30T12:00:00Z",
	events: mockEvents,
};

function Wrapper({ children }: { children: React.ReactNode }) {
	return (
		<DashboardProvider initialRuns={[mockRun]}>{children}</DashboardProvider>
	);
}

describe("extractAgentCosts", () => {
	it("aggregates costs by taskId", () => {
		const rows = extractAgentCosts(mockEvents);
		expect(rows).toHaveLength(2);

		const alpha = rows.find((r) => r.taskId === "agent-alpha");
		expect(alpha).toBeDefined();
		expect(alpha!.costUsd).toBe(0.0025);
		expect(alpha!.tokensTotal).toBe(1500);
		expect(alpha!.provider).toBe("deepseek-v4");
	});

	it("derives completed status from task_completed event", () => {
		const rows = extractAgentCosts(mockEvents);
		const alpha = rows.find((r) => r.taskId === "agent-alpha");
		expect(alpha!.status).toBe("completed");
	});

	it("derives in_progress status from llm_request without completion", () => {
		const rows = extractAgentCosts(mockEvents);
		const beta = rows.find((r) => r.taskId === "agent-beta");
		expect(beta!.status).toBe("in_progress");
	});

	it("sorts rows by cost descending", () => {
		const rows = extractAgentCosts(mockEvents);
		expect(rows[0].taskId).toBe("agent-beta"); // 0.005 > 0.0025
		expect(rows[1].taskId).toBe("agent-alpha");
	});

	it("handles failed status", () => {
		const events: EventLog[] = [
			{
				id: "f1",
				timestamp: "2026-04-30T12:00:00Z",
				type: "task_scheduled",
				severity: "info",
				taskId: "agent-bad",
				payload: {},
			},
			{
				id: "f2",
				timestamp: "2026-04-30T12:00:01Z",
				type: "task_failed",
				severity: "error",
				taskId: "agent-bad",
				payload: {},
			},
		];
		const rows = extractAgentCosts(events);
		expect(rows[0].status).toBe("failed");
	});

	it("returns empty array for events without taskId", () => {
		const events: EventLog[] = [
			{
				id: "x1",
				timestamp: "2026-04-30T12:00:00Z",
				type: "llm_request",
				severity: "info",
				payload: {},
				metadata: {
					costUsd: 0.01,
					tokens: { prompt: 100, completion: 50, total: 150 },
				},
			},
		];
		expect(extractAgentCosts(events)).toHaveLength(0);
	});
});

describe("AgentCostTable", () => {
	it("renders agent breakdown in normal mode", () => {
		const output = renderToString(
			<Wrapper>
				<AgentCostTable mode="normal" />
			</Wrapper>,
		);
		expect(output).toContain("Agent Cost Breakdown");
		expect(output).toContain("agent-alpha");
		expect(output).toContain("agent-beta");
		expect(output).toContain("deepseek-v4");
		expect(output).toContain("moonshot-k2.6");
		expect(output).toContain("Total");
	});

	it("renders compact mode with taskId and cost only", () => {
		const output = renderToString(
			<Wrapper>
				<AgentCostTable mode="compact" />
			</Wrapper>,
		);
		expect(output).toContain("agent-alpha");
		expect(output).toContain("$0.0025");
		expect(output).not.toContain("Tokens"); // No column header row
	});

	it("renders minimal mode with total only", () => {
		const output = renderToString(
			<Wrapper>
				<AgentCostTable mode="minimal" />
			</Wrapper>,
		);
		expect(output).toContain("Agent Cost:");
		expect(output).toContain("$0.0075");
		expect(output).not.toContain("agent-alpha");
	});

	it("shows 'No agent cost data yet' when empty", () => {
		const output = renderToString(
			<DashboardProvider>
				<AgentCostTable mode="normal" />
			</DashboardProvider>,
		);
		expect(output).toContain("No agent cost data yet");
	});

	it("displays status symbols in normal mode", () => {
		const output = renderToString(
			<Wrapper>
				<AgentCostTable mode="normal" />
			</Wrapper>,
		);
		expect(output).toContain("✓"); // completed
		expect(output).toContain("●"); // in_progress
	});
});
