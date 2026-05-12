import { renderToString } from "ink";
import type React from "react";
import { describe, expect, it } from "vitest";
import { DashboardProvider } from "../hooks/useDashboard.tsx";
import type { EventLog, Run } from "../types.ts";
import { TaskList } from "./TaskList.tsx";

const mockEvents: EventLog[] = [
	{
		id: "e1",
		timestamp: "2026-04-30T12:00:00Z",
		type: "task_scheduled",
		severity: "info",
		taskId: "task-1",
		payload: { description: "Research API design" },
		metadata: { role: "research" },
	},
	{
		id: "e2",
		timestamp: "2026-04-30T12:05:00Z",
		type: "task_scheduled",
		severity: "info",
		taskId: "task-2",
		payload: { description: "Implement auth module with OAuth2" },
		metadata: { role: "execution" },
	},
	{
		id: "e3",
		timestamp: "2026-04-30T12:10:00Z",
		type: "task_completed",
		severity: "info",
		taskId: "task-1",
		payload: { description: "Research API design" },
		metadata: { role: "research" },
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

describe("TaskList", () => {
	it("renders tasks in normal mode", () => {
		const output = renderToString(
			<Wrapper>
				<TaskList mode="normal" />
			</Wrapper>,
		);
		expect(output).toContain("Tasks");
		expect(output).toContain("Research API design");
		expect(output).toContain("Implement auth module");
		expect(output).toContain("(1/2)"); // 1 completed out of 2 tasks
	});

	it("renders compact mode with truncated descriptions", () => {
		const output = renderToString(
			<Wrapper>
				<TaskList mode="compact" />
			</Wrapper>,
		);
		expect(output).toContain("Implement auth module with OAu"); // truncated
		expect(output).not.toContain("(research)"); // role hidden in compact
	});

	it("renders minimal mode with counts only", () => {
		const output = renderToString(
			<Wrapper>
				<TaskList mode="minimal" />
			</Wrapper>,
		);
		expect(output).toContain("Tasks:");
		expect(output).toContain("1/2");
		expect(output).not.toContain("Research API design");
	});

	it("shows status icons", () => {
		const output = renderToString(
			<Wrapper>
				<TaskList mode="normal" />
			</Wrapper>,
		);
		expect(output).toContain("✅"); // completed
		expect(output).toContain("⏳"); // pending
	});

	it("shows 'No tasks yet' when empty", () => {
		const output = renderToString(
			<DashboardProvider>
				<TaskList mode="normal" />
			</DashboardProvider>,
		);
		expect(output).toContain("No tasks yet");
	});

	it("limits items when maxItems is set", () => {
		const output = renderToString(
			<Wrapper>
				<TaskList mode="normal" maxItems={1} />
			</Wrapper>,
		);
		expect(output).toContain("Research API design");
		// Should only show 1 task even though there are 2
	});
});
