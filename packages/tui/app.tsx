import { join } from "node:path";
import { Box, render, Text, useApp, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import { AgentStatus } from "./components/AgentStatus.tsx";
import { CostTable } from "./components/CostTable.tsx";
import { Dashboard } from "./components/Dashboard.tsx";
import { TaskList } from "./components/TaskList.tsx";
import {
	DashboardProvider,
	useActiveRun,
	useDashboard,
} from "./hooks/useDashboard.tsx";
import { RunManager } from "./lib/run-manager.ts";

const EVENTS_DIR = join(process.cwd(), ".events");

interface AppState {
	showCostTable: boolean;
	debugMode: boolean;
	debugCounters: { malformedLines: number; unknownEventTypes: number };
	loading: boolean;
	error?: string;
}

function DashboardApp() {
	const { state, dispatch } = useDashboard();
	const activeRun = useActiveRun();
	const { exit } = useApp();

	const [appState, setAppState] = useState<AppState>({
		showCostTable: false,
		debugMode: false,
		debugCounters: { malformedLines: 0, unknownEventTypes: 0 },
		loading: true,
	});

	const managerRef = useRef<RunManager | null>(null);

	useEffect(() => {
		const manager = new RunManager({
			eventsDir: EVENTS_DIR,
			onRunsChanged: (runs) => {
				// Reverse so newest run is first (matches previous loadRuns behavior)
				dispatch({ type: "SET_RUNS", payload: [...runs].reverse() });
				setAppState((prev) => ({ ...prev, loading: false }));
			},
			onCountersChanged: (counters) => {
				setAppState((prev) => ({ ...prev, debugCounters: counters }));
			},
			onError: (err) => {
				setAppState((prev) => ({
					...prev,
					loading: false,
					error: err.message,
				}));
			},
			debug: process.env.DEBUG === "true" || process.env.DEBUG === "1",
		});

		managerRef.current = manager;
		manager.start().catch((err) => {
			setAppState((prev) => ({
				...prev,
				loading: false,
				error: err instanceof Error ? err.message : String(err),
			}));
		});

		return () => {
			manager.close();
		};
	}, [dispatch]);

	useInput((input, key) => {
		if (input === "q") {
			exit();
		}
		if (input === "c") {
			setAppState((prev) => {
				const next = { ...prev, showCostTable: !prev.showCostTable };
				if (next.debugMode) {
					console.error(`[debug] costTable=${next.showCostTable}`);
				}
				return next;
			});
		}
		if (input === "d") {
			setAppState((prev) => {
				const next = { ...prev, debugMode: !prev.debugMode };
				console.error(`[debug] debugMode=${next.debugMode}`);
				return next;
			});
		}
		if (key.tab || key.rightArrow || key.downArrow) {
			const nextIndex =
				(state.activeRunIndex + 1) % Math.max(state.runs.length, 1);
			dispatch({ type: "SET_ACTIVE_RUN", payload: nextIndex });
			if (appState.debugMode) {
				console.error(`[debug] activeRunIndex=${nextIndex}`);
			}
		}
		if (key.leftArrow || key.upArrow) {
			const nextIndex =
				state.activeRunIndex === 0
					? Math.max(state.runs.length - 1, 0)
					: state.activeRunIndex - 1;
			dispatch({ type: "SET_ACTIVE_RUN", payload: nextIndex });
			if (appState.debugMode) {
				console.error(`[debug] activeRunIndex=${nextIndex}`);
			}
		}
	});

	if (appState.loading) {
		return (
			<Box>
				<Text>Loading dashboard...</Text>
			</Box>
		);
	}

	if (appState.error) {
		return (
			<Box flexDirection="column">
				<Text color="red">Error: {appState.error}</Text>
			</Box>
		);
	}

	if (state.runs.length === 0) {
		return (
			<Box flexDirection="column">
				<Text dimColor>Waiting for first execution...</Text>
				<Text dimColor>Run `apohara auto` to start.</Text>
			</Box>
		);
	}

	const completedTasks =
		activeRun?.events.filter((e) => e.type === "task_completed").length ?? 0;
	const totalTasks =
		activeRun?.events.filter((e) => e.type === "task_scheduled").length ?? 0;

	return (
		<Dashboard
			startedAt={activeRun?.startedAt}
			completedTasks={completedTasks}
			totalTasks={totalTasks}
			debugMode={appState.debugMode}
			debugCounters={appState.debugCounters}
			runId={activeRun?.id}
			totalRuns={state.runs.length}
			activeRunIndex={state.activeRunIndex}
		>
			<TaskList />
			<AgentStatus />
			{appState.showCostTable && <CostTable />}
		</Dashboard>
	);
}

function App() {
	return (
		<DashboardProvider>
			<DashboardApp />
		</DashboardProvider>
	);
}

render(<App />);
