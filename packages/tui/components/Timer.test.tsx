import { renderToString } from "ink";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Timer } from "./Timer.tsx";

describe("Timer", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders 00:00:00 when startedAt is now", () => {
		const now = new Date().toISOString();
		const output = renderToString(<Timer startedAt={now} />);
		expect(output).toContain("00:00:00");
	});

	it("renders correct elapsed time for 5 minutes", () => {
		const startedAt = new Date(Date.now() - 5 * 60 * 1000).toISOString();
		const output = renderToString(<Timer startedAt={startedAt} />);
		expect(output).toContain("00:05:00");
	});

	it("renders correct elapsed time for 1 hour 23 minutes 45 seconds", () => {
		const startedAt = new Date(
			Date.now() - (1 * 3600 + 23 * 60 + 45) * 1000,
		).toISOString();
		const output = renderToString(<Timer startedAt={startedAt} />);
		expect(output).toContain("01:23:45");
	});

	it("updates elapsed time after mocked intervals", () => {
		const startedAt = new Date(Date.now() - 3000).toISOString();
		const output = renderToString(<Timer startedAt={startedAt} />);
		expect(output).toContain("00:00:03");
	});
});
