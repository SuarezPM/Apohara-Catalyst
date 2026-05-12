import type React from "react";
import { createContext, useCallback, useContext, useReducer } from "react";
import type {
	DashboardAction,
	DashboardState,
	EventLog,
	Run,
} from "../types.ts";

const initialState: DashboardState = {
	runs: [],
	activeRunIndex: 0,
};

function dashboardReducer(
	state: DashboardState,
	action: DashboardAction,
): DashboardState {
	switch (action.type) {
		case "SET_RUNS":
			return { ...state, runs: action.payload, activeRunIndex: 0 };
		case "SET_ACTIVE_RUN":
			return { ...state, activeRunIndex: action.payload };
		case "ADD_RUN":
			return { ...state, runs: [...state.runs, action.payload] };
		case "APPEND_EVENT": {
			const { runId, event } = action.payload;
			const runs = state.runs.map((run) =>
				run.id === runId ? { ...run, events: [...run.events, event] } : run,
			);
			return { ...state, runs };
		}
		case "APPEND_EVENTS": {
			const { runId, events } = action.payload;
			const runs = state.runs.map((run) =>
				run.id === runId ? { ...run, events: [...run.events, ...events] } : run,
			);
			return { ...state, runs };
		}
		default:
			return state;
	}
}

const DashboardContext = createContext<{
	state: DashboardState;
	dispatch: React.Dispatch<DashboardAction>;
} | null>(null);

export interface DashboardProviderProps {
	children: React.ReactNode;
	initialRuns?: Run[];
}

/**
 * Provides dashboard state to the component tree.
 * Accepts optional initial runs for testing / hydration.
 */
export function DashboardProvider({
	children,
	initialRuns,
}: DashboardProviderProps) {
	const [state, dispatch] = useReducer(dashboardReducer, {
		...initialState,
		runs: initialRuns ?? initialState.runs,
	});

	return (
		<DashboardContext.Provider value={{ state, dispatch }}>
			{children}
		</DashboardContext.Provider>
	);
}

/**
 * Hook to access the full dashboard state and dispatch function.
 */
export function useDashboard() {
	const context = useContext(DashboardContext);
	if (!context) {
		throw new Error("useDashboard must be used within a DashboardProvider");
	}
	return context;
}

/**
 * Hook to access the currently active run.
 */
export function useActiveRun(): Run | undefined {
	const { state } = useDashboard();
	return state.runs[state.activeRunIndex];
}
