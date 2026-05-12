import { Box, renderToString, Text } from "ink";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dashboard } from "./Dashboard.tsx";

describe("Dashboard", () => {
	let originalColumns: number | undefined;

	beforeEach(() => {
		originalColumns = process.stdout.columns;
	});

	afterEach(() => {
		Object.defineProperty(process.stdout, "columns", {
			value: originalColumns,
			configurable: true,
			writable: true,
		});
	});

	function setColumns(cols: number) {
		Object.defineProperty(process.stdout, "columns", {
			value: cols,
			configurable: true,
			writable: true,
		});
	}

	it("renders header with title in normal mode", () => {
		setColumns(120);
		const output = renderToString(<Dashboard />);
		expect(output).toContain("Clarity Dashboard");
	});

	it("renders timer when startedAt is provided", () => {
		setColumns(120);
		const startedAt = new Date(Date.now() - 10000).toISOString();
		const output = renderToString(<Dashboard startedAt={startedAt} />);
		expect(output).toContain("Elapsed:");
		expect(output).toMatch(/00:00:1\d/);
	});

	it("shows minimal layout when columns < 60", () => {
		setColumns(40);
		const output = renderToString(<Dashboard />);
		expect(output).toContain("Clarity");
		expect(output).not.toContain("Clarity Dashboard");
		expect(output).toContain("[q]uit");
		expect(output).not.toContain("[d]ebug");
	});

	it("shows compact layout when columns between 60 and 99", () => {
		setColumns(80);
		const output = renderToString(
			<Dashboard completedTasks={5} totalTasks={10} />,
		);
		expect(output).toContain("Clarity Dashboard");
		expect(output).toContain("[q]uit [d]ebug");
		expect(output).toContain("50%");
	});

	it("shows normal layout when columns >= 100", () => {
		setColumns(120);
		const output = renderToString(
			<Dashboard completedTasks={5} totalTasks={10} />,
		);
		expect(output).toContain("Clarity Dashboard");
		expect(output).toContain("[q]uit [d]ebug [r]efresh");
		expect(output).toContain("50%");
	});

	it("renders children in body area", () => {
		setColumns(120);
		const output = renderToString(
			<Dashboard>
				<Text>Hello Body</Text>
			</Dashboard>,
		);
		expect(output).toContain("Hello Body");
	});

	it("shows debug counters in debug mode", () => {
		setColumns(120);
		const output = renderToString(
			<Dashboard
				debugMode={true}
				debugCounters={{ malformedLines: 3, unknownEventTypes: 7 }}
			/>,
		);
		expect(output).toContain("Debug: malformed=3 unknown=7");
	});

	it("does not show debug counters when debugMode is false", () => {
		setColumns(120);
		const output = renderToString(
			<Dashboard
				debugMode={false}
				debugCounters={{ malformedLines: 3, unknownEventTypes: 7 }}
			/>,
		);
		expect(output).not.toContain("Debug: malformed");
	});

	it("does not show progress bar in minimal mode", () => {
		setColumns(40);
		const output = renderToString(
			<Dashboard completedTasks={5} totalTasks={10} />,
		);
		expect(output).not.toContain("50%");
	});

	it("shows run indicator when runId and totalRuns > 1", () => {
		setColumns(120);
		const output = renderToString(
			<Dashboard runId="abc-123" totalRuns={5} activeRunIndex={1} />,
		);
		expect(output).toContain("Run: abc-123 (2/5)");
	});

	it("does not show run indicator when only one run exists", () => {
		setColumns(120);
		const output = renderToString(
			<Dashboard runId="abc-123" totalRuns={1} activeRunIndex={0} />,
		);
		expect(output).not.toContain("Run:");
	});
});
