import { appendFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderHook, waitFor } from "@testing-library/react";
import type React from "react";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { EventLog } from "../../src/core/types.ts";
import { DashboardProvider, useDashboard } from "./hooks/useDashboard.tsx";
import { RunManager } from "./lib/run-manager.ts";

function makeEvent(overrides: Partial<EventLog> = {}): EventLog {
	return {
		id: "evt-1",
		timestamp: "2026-04-30T12:00:00Z",
		type: "task_completed",
		severity: "info",
		payload: { ok: true },
		...overrides,
	};
}

function useRunManagerIntegration(eventsDir: string) {
	const { state, dispatch } = useDashboard();
	const managerRef = useRef<RunManager | null>(null);

	useEffect(() => {
		const manager = new RunManager({
			eventsDir,
			onRunsChanged: (runs) => {
				// Reverse so newest run is first (matches app.tsx behavior)
				dispatch({ type: "SET_RUNS", payload: [...runs].reverse() });
			},
			onCountersChanged: () => {},
			debug: false,
		});
		managerRef.current = manager;
		manager.start().catch(() => {});
		return () => manager.close();
	}, [eventsDir, dispatch]);

	return { state, managerRef };
}

describe("live updates integration", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "tui-integration-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
	});

	it("discovers initial runs and appends live events through RunManager to dashboard state", async () => {
		const filePath = join(tmpDir, "run-20260430-120000.jsonl");
		await writeFile(
			filePath,
			`${JSON.stringify(
				makeEvent({ id: "e1", timestamp: "2026-04-30T12:00:00Z" }),
			)}\n`,
		);

		function wrapper({ children }: { children: React.ReactNode }) {
			return <DashboardProvider>{children}</DashboardProvider>;
		}

		const { result } = renderHook(() => useRunManagerIntegration(tmpDir), {
			wrapper,
		});

		await waitFor(() => expect(result.current.state.runs.length).toBe(1));
		expect(result.current.state.runs[0].id).toBe("run-20260430-120000");
		expect(result.current.state.runs[0].events).toHaveLength(1);
		expect(result.current.state.runs[0].events[0].id).toBe("e1");

		// Append a new event and force a scan to pick it up
		await appendFile(
			filePath,
			`${JSON.stringify(
				makeEvent({ id: "e2", timestamp: "2026-04-30T12:01:00Z" }),
			)}\n`,
		);

		// Force scan since fs.watch may not fire in test environment
		await (
			result.current.managerRef.current as unknown as {
				watcher: { scan: () => Promise<void> };
			}
		)?.watcher?.scan();

		await waitFor(() =>
			expect(result.current.state.runs[0].events.length).toBe(2),
		);
		expect(result.current.state.runs[0].events[1].id).toBe("e2");
	});

	it("handles multiple runs and keeps newest first ordering", async () => {
		await writeFile(
			join(tmpDir, "run-20260430-100000.jsonl"),
			`${JSON.stringify(makeEvent({ timestamp: "2026-04-30T10:00:00Z" }))}\n`,
		);
		await writeFile(
			join(tmpDir, "run-20260430-120000.jsonl"),
			`${JSON.stringify(makeEvent({ timestamp: "2026-04-30T12:00:00Z" }))}\n`,
		);

		function wrapper({ children }: { children: React.ReactNode }) {
			return <DashboardProvider>{children}</DashboardProvider>;
		}

		const { result } = renderHook(() => useRunManagerIntegration(tmpDir), {
			wrapper,
		});

		await waitFor(() => expect(result.current.state.runs.length).toBe(2));
		// Newest first because of the .reverse() in the hook
		expect(result.current.state.runs[0].startedAt).toBe("2026-04-30T12:00:00Z");
		expect(result.current.state.runs[1].startedAt).toBe("2026-04-30T10:00:00Z");
	});

	it("exposes debug counters through onCountersChanged", async () => {
		const filePath = join(tmpDir, "run-counters.jsonl");
		await writeFile(
			filePath,
			`${JSON.stringify(makeEvent())}\nbad json line\n`,
		);

		function wrapper({ children }: { children: React.ReactNode }) {
			return <DashboardProvider>{children}</DashboardProvider>;
		}

		const { result } = renderHook(() => useRunManagerIntegration(tmpDir), {
			wrapper,
		});

		await waitFor(() => expect(result.current.state.runs.length).toBe(1));

		// counters are not stored in dashboard state by default, but we can verify
		// the manager itself tracks them
		expect(
			(
				result.current.managerRef.current as unknown as {
					getCounters: () => unknown;
				}
			)?.getCounters?.(),
		).toBeDefined();
	});
});
