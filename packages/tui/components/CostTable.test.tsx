import { renderToString } from "ink";
import type React from "react";
import { describe, expect, it } from "vitest";
import { DashboardProvider } from "../hooks/useDashboard.tsx";
import type { EventLog, Run } from "../types.ts";
import { CostTable } from "./CostTable.tsx";

const mockEvents: EventLog[] = [
	{
		id: "e1",
		timestamp: "2026-04-30T12:00:00Z",
		type: "llm_request",
		severity: "info",
		payload: {},
		metadata: {
			provider: "deepseek-v4",
			costUsd: 0.0025,
			tokens: { prompt: 1000, completion: 500, total: 1500 },
		},
	},
	{
		id: "e2",
		timestamp: "2026-04-30T12:05:00Z",
		type: "llm_request",
		severity: "info",
		payload: {},
		metadata: {
			provider: "moonshot-k2.6",
			costUsd: 0.005,
			tokens: { prompt: 2000, completion: 1000, total: 3000 },
		},
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

describe("CostTable", () => {
	it("renders cost breakdown in normal mode", () => {
		const output = renderToString(
			<Wrapper>
				<CostTable mode="normal" />
			</Wrapper>,
		);
		expect(output).toContain("Cost Breakdown");
		expect(output).toContain("deepseek-v4");
		expect(output).toContain("moonshot-k2.6");
		expect(output).toContain("Total");
	});

	it("renders compact mode without header", () => {
		const output = renderToString(
			<Wrapper>
				<CostTable mode="compact" />
			</Wrapper>,
		);
		expect(output).toContain("deepseek-v4");
		expect(output).toContain("$0.0025");
		expect(output).not.toContain("Provider"); // No column header
	});

	it("renders minimal mode with total only", () => {
		const output = renderToString(
			<Wrapper>
				<CostTable mode="minimal" />
			</Wrapper>,
		);
		expect(output).toContain("Cost:");
		expect(output).toContain("$0.0075");
		expect(output).not.toContain("deepseek-v4");
	});

	it("shows 'No cost data yet' when empty", () => {
		const output = renderToString(
			<DashboardProvider>
				<CostTable mode="normal" />
			</DashboardProvider>,
		);
		expect(output).toContain("No cost data yet");
	});

	it("formats large token counts with K/M suffix", () => {
		const events: EventLog[] = [
			{
				id: "e1",
				timestamp: "2026-04-30T12:00:00Z",
				type: "llm_request",
				severity: "info",
				payload: {},
				metadata: {
					provider: "deepseek-v4",
					costUsd: 0.01,
					tokens: { prompt: 1_500_000, completion: 500_000, total: 2_000_000 },
				},
			},
		];

		const run: Run = {
			id: "run-big",
			startedAt: "2026-04-30T12:00:00Z",
			events,
		};

		const output = renderToString(
			<DashboardProvider initialRuns={[run]}>
				<CostTable mode="normal" />
			</DashboardProvider>,
		);
		expect(output).toContain("2.0M");
	});
});
