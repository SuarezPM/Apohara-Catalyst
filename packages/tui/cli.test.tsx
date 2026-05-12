import { execSync } from "node:child_process";
import { renderToString } from "ink";
import React from "react";
import { describe, expect, it } from "vitest";
import { AgentStatus } from "./components/AgentStatus.tsx";
import { CostTable } from "./components/CostTable.tsx";
import { Dashboard } from "./components/Dashboard.tsx";
import { TaskList } from "./components/TaskList.tsx";
import { DashboardProvider } from "./hooks/useDashboard.tsx";
import type { EventLog, Run } from "./types.ts";

const mockEvents: EventLog[] = [
	{
		id: "e1",
		timestamp: "2026-04-30T12:00:00Z",
		type: "task_scheduled",
		severity: "info",
		taskId: "task-1",
		payload: { description: "Setup project" },
		metadata: { role: "execution" },
	},
	{
		id: "e2",
		timestamp: "2026-04-30T12:05:00Z",
		type: "task_completed",
		severity: "info",
		taskId: "task-1",
		payload: { description: "Setup project" },
		metadata: { role: "execution" },
	},
	{
		id: "e3",
		timestamp: "2026-04-30T12:10:00Z",
		type: "llm_request",
		severity: "info",
		payload: {},
		metadata: {
			provider: "deepseek-v4",
			modelName: "DeepSeek V4 Pro",
			role: "execution",
			costUsd: 0.005,
			tokens: { prompt: 100, completion: 50, total: 150 },
		},
	},
];

const mockRun: Run = {
	id: "run-test-1",
	startedAt: "2026-04-30T12:00:00Z",
	events: mockEvents,
};

function MockApp({
	showCostTable = false,
	debugMode = false,
}: {
	showCostTable?: boolean;
	debugMode?: boolean;
}) {
	return (
		<DashboardProvider initialRuns={[mockRun]}>
			<Dashboard
				startedAt={mockRun.startedAt}
				completedTasks={1}
				totalTasks={1}
				debugMode={debugMode}
				debugCounters={{ malformedLines: 0, unknownEventTypes: 0 }}
			>
				<TaskList />
				<AgentStatus />
				{showCostTable && <CostTable />}
			</Dashboard>
		</DashboardProvider>
	);
}

describe("dashboard CLI", () => {
	it("outputs help for dashboard --help", () => {
		const output = execSync("bun run ../../src/cli.ts dashboard --help", {
			encoding: "utf-8",
			stdio: ["pipe", "pipe", "pipe"],
		});
		expect(output).toContain("Usage:");
		expect(output).toContain("dashboard");
		expect(output).toContain("--run");
	});

	it("renders the app with mock data", () => {
		const output = renderToString(<MockApp />);
		expect(output).toContain("Clarity Dashboard");
		expect(output).toContain("Setup project");
		expect(output).toContain("deepseek-v4");
		expect(output).toContain("100%");
	});

	it("renders cost table when toggled", () => {
		const output = renderToString(<MockApp showCostTable />);
		expect(output).toContain("Cost Breakdown");
		expect(output).toContain("deepseek-v4");
		expect(output).toContain("$0.0050");
	});

	it("renders debug counters in debug mode", () => {
		const output = renderToString(<MockApp debugMode />);
		expect(output).toContain("Debug: malformed=0 unknown=0");
	});
});
