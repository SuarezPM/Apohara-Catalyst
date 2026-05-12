import { renderToString } from "ink";
import type React from "react";
import { describe, expect, it } from "vitest";
import { DashboardProvider } from "../hooks/useDashboard.tsx";
import type { EventLog, Run } from "../types.ts";
import { AgentStatus } from "./AgentStatus.tsx";

const mockEvents: EventLog[] = [
	{
		id: "e1",
		timestamp: "2026-04-30T12:00:00Z",
		type: "llm_request",
		severity: "info",
		payload: {},
		metadata: {
			provider: "deepseek-v4",
			modelName: "DeepSeek V4 Pro",
			role: "execution",
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
			modelName: "Kimi K2.6",
			role: "planning",
		},
	},
	{
		id: "e3",
		timestamp: "2026-04-30T12:10:00Z",
		type: "provider_fallback",
		severity: "warning",
		payload: {},
		metadata: {
			fromProvider: "deepseek-v4",
			toProvider: "moonshot-k2.6",
			errorReason: "rate_limit",
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

describe("AgentStatus", () => {
	it("renders active agents in normal mode", () => {
		const output = renderToString(
			<Wrapper>
				<AgentStatus mode="normal" />
			</Wrapper>,
		);
		expect(output).toContain("Active Agents");
		expect(output).toContain("deepseek-v4");
		expect(output).toContain("moonshot-k2.6");
		expect(output).toContain("DeepSeek V4 Pro");
		expect(output).toContain("[execution]");
	});

	it("renders compact mode without model names", () => {
		const output = renderToString(
			<Wrapper>
				<AgentStatus mode="compact" />
			</Wrapper>,
		);
		expect(output).toContain("deepseek-v4");
		expect(output).not.toContain("DeepSeek V4 Pro");
	});

	it("renders minimal mode with agent count", () => {
		const output = renderToString(
			<Wrapper>
				<AgentStatus mode="minimal" />
			</Wrapper>,
		);
		expect(output).toContain("Agents: 2");
	});

	it("shows fallback warning when present", () => {
		const output = renderToString(
			<Wrapper>
				<AgentStatus mode="normal" />
			</Wrapper>,
		);
		expect(output).toContain("1 fallback(s)");
		expect(output).toContain("deepseek-v4 → moonshot-k2.6");
		expect(output).toContain("rate_limit");
	});

	it("shows fallback count in minimal mode", () => {
		const output = renderToString(
			<Wrapper>
				<AgentStatus mode="minimal" />
			</Wrapper>,
		);
		expect(output).toContain("⚠ 1 fallback");
	});

	it("shows 'No agents active' when empty", () => {
		const output = renderToString(
			<DashboardProvider>
				<AgentStatus mode="normal" />
			</DashboardProvider>,
		);
		expect(output).toContain("No agents active");
	});
});
