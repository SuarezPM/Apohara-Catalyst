import { renderHook } from "@testing-library/react";
import type React from "react";
import { describe, expect, it } from "vitest";
import type { EventLog, Run } from "../types.ts";
import { useCostTable } from "./useCostTable.tsx";
import { DashboardProvider } from "./useDashboard.tsx";

function wrapper({ children }: { children: React.ReactNode }) {
	return <DashboardProvider>{children}</DashboardProvider>;
}

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
			provider: "deepseek-v4",
			costUsd: 0.0015,
			tokens: { prompt: 800, completion: 200, total: 1000 },
		},
	},
	{
		id: "e3",
		timestamp: "2026-04-30T12:10:00Z",
		type: "llm_request",
		severity: "info",
		payload: {},
		metadata: {
			provider: "moonshot-k2.6",
			costUsd: 0.005,
			tokens: { prompt: 2000, completion: 1000, total: 3000 },
		},
	},
	{
		id: "e4",
		timestamp: "2026-04-30T12:15:00Z",
		type: "task_completed",
		severity: "info",
		payload: {},
		// No cost metadata
	},
];

const mockRun: Run = {
	id: "run-1",
	startedAt: "2026-04-30T12:00:00Z",
	events: mockEvents,
};

describe("useCostTable", () => {
	it("returns empty results when no active run", () => {
		const { result } = renderHook(() => useCostTable(), { wrapper });
		expect(result.current.rows).toEqual([]);
		expect(result.current.totalCostUsd).toBe(0);
		expect(result.current.totalTokens).toBe(0);
	});

	it("aggregates costs and tokens by provider", () => {
		const { result } = renderHook(() => useCostTable(), {
			wrapper: ({ children }) => (
				<DashboardProvider initialRuns={[mockRun]}>
					{children}
				</DashboardProvider>
			),
		});

		expect(result.current.rows).toHaveLength(2);

		const deepseek = result.current.rows.find(
			(r) => r.provider === "deepseek-v4",
		);
		expect(deepseek?.costUsd).toBeCloseTo(0.004, 3);
		expect(deepseek?.tokensTotal).toBe(2500);

		const moonshot = result.current.rows.find(
			(r) => r.provider === "moonshot-k2.6",
		);
		expect(moonshot?.costUsd).toBeCloseTo(0.005, 3);
		expect(moonshot?.tokensTotal).toBe(3000);

		expect(result.current.totalCostUsd).toBeCloseTo(0.009, 3);
		expect(result.current.totalTokens).toBe(5500);
	});

	it("skips events without cost metadata", () => {
		const { result } = renderHook(() => useCostTable(), {
			wrapper: ({ children }) => (
				<DashboardProvider initialRuns={[mockRun]}>
					{children}
				</DashboardProvider>
			),
		});

		// Only 3 events have cost metadata, but grouped into 2 providers
		expect(result.current.rows).toHaveLength(2);
	});

	it("handles events without token data", () => {
		const events: EventLog[] = [
			{
				id: "e1",
				timestamp: "2026-04-30T12:00:00Z",
				type: "llm_request",
				severity: "info",
				payload: {},
				metadata: {
					provider: "deepseek-v4",
					costUsd: 0.001,
					// No tokens field
				},
			},
		];

		const run: Run = {
			id: "run-notokens",
			startedAt: "2026-04-30T12:00:00Z",
			events,
		};

		const { result } = renderHook(() => useCostTable(), {
			wrapper: ({ children }) => (
				<DashboardProvider initialRuns={[run]}>{children}</DashboardProvider>
			),
		});

		expect(result.current.rows[0].tokensPrompt).toBe(0);
		expect(result.current.rows[0].tokensCompletion).toBe(0);
		expect(result.current.rows[0].tokensTotal).toBe(0);
	});
});
