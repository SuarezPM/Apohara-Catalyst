import { renderToString } from "ink";
import React from "react";
import { describe, expect, it } from "vitest";
import { ProgressBar } from "./ProgressBar.tsx";

describe("ProgressBar", () => {
	it("renders empty bar at 0%", () => {
		const output = renderToString(
			<ProgressBar completed={0} total={10} width={10} />,
		);
		expect(output).toContain("0%");
		expect(output).toContain("░░░░░░░░░░");
	});

	it("renders full bar at 100%", () => {
		const output = renderToString(
			<ProgressBar completed={10} total={10} width={10} />,
		);
		expect(output).toContain("100%");
		expect(output).toContain("██████████");
	});

	it("renders partial bar correctly (50%)", () => {
		const output = renderToString(
			<ProgressBar completed={5} total={10} width={10} />,
		);
		expect(output).toContain("50%");
		expect(output).toContain("█████░░░░░");
	});

	it("renders partial bar correctly (25%)", () => {
		const output = renderToString(
			<ProgressBar completed={2} total={8} width={8} />,
		);
		expect(output).toContain("25%");
		expect(output).toContain("██░░░░░░");
	});

	it("handles zero total gracefully", () => {
		const output = renderToString(
			<ProgressBar completed={0} total={0} width={10} />,
		);
		expect(output).toContain("0%");
		expect(output).toContain("░░░░░░░░░░");
	});

	it("uses default width when not specified", () => {
		const output = renderToString(<ProgressBar completed={15} total={30} />);
		expect(output).toContain("50%");
	});

	it("caps percentage at 100% for over-completion", () => {
		const output = renderToString(
			<ProgressBar completed={15} total={10} width={10} />,
		);
		expect(output).toContain("100%");
		expect(output).toContain("██████████");
	});
});
