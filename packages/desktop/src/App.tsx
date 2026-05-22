import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai/react";
import { getDefaultStore } from "jotai/vanilla";
import { AgentConfigPanel } from "./components/AgentConfigPanel.js";
import { CostMeter } from "./components/CostMeter.js";
import { ObjectivePane } from "./components/ObjectivePane.js";
import { PermissionDialog } from "./components/PermissionDialog.js";
import { PlansPanel } from "./components/PlansPanel.js";
import {
	ALL_PROVIDERS,
	DEFAULT_PROVIDERS,
	type ProviderId,
	RosterPicker,
} from "./components/RosterPicker.js";
import { SwarmCanvas } from "./components/SwarmCanvas.js";
import { TaskBoard } from "./components/TaskBoard/TaskBoard.js";
import { TerminalView } from "./components/TerminalView.js";
import { VerificationTimeline } from "./components/VerificationTimeline.js";
import { ViewToggle } from "./components/ViewToggle.js";
import { useLedgerStream } from "./hooks/useLedgerStream.js";
import { createBus, type EventBus } from "./lib/bus.js";
import { upsertTaskAtom, type DagTask } from "./store/dagStore.js";
import { registerAllListeners } from "./store/listeners/index.js";
import { setViewModeAtom, viewModeAtom } from "./store/viewStore.js";

declare global {
	interface Window {
		__apoharaBus?: EventBus;
	}
}

/**
 * Apohara v1.0 desktop shell.
 *
 * Wires all Stage 7 components: TaskBoard (kanban), PlansPanel,
 * AgentConfigPanel, PermissionDialog (modal), VerificationTimeline,
 * ViewToggle. Legacy SwarmCanvas + ObjectivePane retained — toggled
 * via ViewToggle (graph ↔ board).
 *
 * Layout: topbar + sidebar-left (Plans) + main + sidebar-right
 * (Agents) + footer (Verification). PermissionDialog overlays.
 */

type RoutingMode = "gpu" | "cloud";

const MODE_STORAGE_KEY = "apohara.routingMode";
// v2 bump: pre-v2 stored "All AIs" (25 providers) as default, which routed
// GPU runs to `carnice-9b-local`. v2 defaults to the 3 active CLI drivers
// per the project's hard rule.
const ROSTER_STORAGE_KEY = "apohara.providerRoster.v2";

function loadRoster(): Set<ProviderId> {
	if (typeof window === "undefined") return new Set(DEFAULT_PROVIDERS);
	const raw = window.localStorage.getItem(ROSTER_STORAGE_KEY);
	if (!raw) return new Set(DEFAULT_PROVIDERS);
	try {
		const arr = JSON.parse(raw) as unknown;
		if (Array.isArray(arr)) {
			return new Set(
				arr.filter(
					(x): x is ProviderId =>
						typeof x === "string" &&
						(ALL_PROVIDERS as readonly string[]).includes(x),
				),
			);
		}
	} catch {
		// fall through to default
	}
	return new Set(DEFAULT_PROVIDERS);
}

const DEMO_TASKS: DagTask[] = [
	{
		id: "demo-spec-parser",
		title: "Parse SPEC.md sections",
		status: "ready",
		agentRole: "coder",
		providerId: "claude-code-cli",
	},
	{
		id: "demo-jwt-fix",
		title: "Fix JWT signing in /auth/login (HS256)",
		status: "dispatched",
		agentRole: "coder",
		providerId: "codex-cli",
		tokensIn: 1240,
		tokensOut: 380,
	},
	{
		id: "demo-blocked",
		title: "Add users CRUD",
		status: "blocked",
		agentRole: "coder",
		providerId: "opencode-go",
		blockedReason: "writes overlap on createUser",
		waitingForTaskId: "demo-jwt-fix",
		overlapSymbols: ["packages/api/src/db/schema.ts::createUser"],
	},
	{
		id: "demo-verify-running",
		title: "Verify ledger SHA chain on r-001",
		status: "in_verification",
		agentRole: "judge",
		providerId: "claude-code-cli",
	},
	{
		id: "demo-done",
		title: "Backfill audit log rotation policy",
		status: "done",
		agentRole: "planner",
		providerId: "claude-code-cli",
		durationMs: 4820,
		costUsd: 0.02,
	},
	{
		id: "demo-pending",
		title: "Decompose: refactor session token storage (legal compliance)",
		status: "pending",
		agentRole: "planner",
	},
	{
		id: "demo-failed",
		title: "Add HS256 JWT — failed: critic rejected",
		status: "failed",
		agentRole: "coder",
		providerId: "codex-cli",
	},
];

export function App() {
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [mode, setMode] = useState<RoutingMode>(() => {
		if (typeof window === "undefined") return "gpu";
		const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
		return stored === "cloud" ? "cloud" : "gpu";
	});
	const [roster, setRoster] = useState<Set<ProviderId>>(() => loadRoster());

	const ledger = useLedgerStream(sessionId);
	const viewMode = useAtomValue(viewModeAtom);
	const setViewMode = useSetAtom(setViewModeAtom);
	const upsertTask = useSetAtom(upsertTaskAtom);

	// §0.1 centralized IPC listeners — registered once at mount.
	// Without this, every `apohara://*` event from the (future) Tauri
	// bridge / SSE adapter would be dropped and the kanban / plans /
	// verification panels would render permanently empty.
	useEffect(() => {
		if (typeof window === "undefined") return;
		const bus = createBus();
		window.__apoharaBus = bus;
		const handle = registerAllListeners({ store: getDefaultStore(), bus });
		return () => {
			handle.dispose();
			if (window.__apoharaBus === bus) delete window.__apoharaBus;
		};
	}, []);

	// SSE → bus adapter: re-publish ledger events the orchestrator
	// emits as `apohara://*` so listeners that expect the Stage 8
	// Tauri shape see them in Stage 7 dev mode too. Dedupe by event id
	// so React StrictMode double-renders don't republish the same event.
	const lastBridgedEventId = useRef<string | null>(null);
	useEffect(() => {
		const bus = typeof window === "undefined" ? undefined : window.__apoharaBus;
		if (!bus) return;
		for (const ev of ledger.events) {
			if (ev.id === lastBridgedEventId.current) continue;
			// Only forward events that newly arrived AFTER the previously
			// bridged one. The replay-then-tail SSE handler resets the
			// array on session change (see useLedgerStream), so a simple
			// "skip until we pass the last id" cursor is enough.
		}
		// Walk forward from the cursor and forward each unseen event.
		let resumeAt = 0;
		if (lastBridgedEventId.current !== null) {
			const idx = ledger.events.findIndex(
				(e) => e.id === lastBridgedEventId.current,
			);
			resumeAt = idx === -1 ? 0 : idx + 1;
		}
		for (let i = resumeAt; i < ledger.events.length; i++) {
			const ev = ledger.events[i];
			switch (ev.type) {
				case "task_completed":
					bus.emit("apohara://task-completed", {
						id: ev.taskId,
						status: "done",
						title: ev.payload?.title,
						providerId: ev.metadata?.provider,
						durationMs: ev.metadata?.durationMs,
						costUsd: ev.metadata?.costUsd,
					});
					break;
				case "task_failed":
				case "failure":
					bus.emit("apohara://task-completed", {
						id: ev.taskId,
						status: "failed",
						title: ev.payload?.title,
						providerId: ev.metadata?.provider,
					});
					break;
				case "task_scheduled":
				case "dispatch":
				case "start":
					if (ev.taskId) {
						bus.emit("apohara://task-completed", {
							id: ev.taskId,
							status: ev.type === "start" ? "dispatched" : "ready",
							title: ev.payload?.title,
							providerId: ev.metadata?.provider,
						});
					}
					break;
				case "hook_event":
					bus.emit("apohara://hook-event", ev.payload);
					break;
				case "task_phase":
					// Per-task progress beat from the dispatch runner
					// (symphony §7.1 phases: preparing_workspace →
					// launching_agent_process → finishing → succeeded /
					// failed / timed_out). The Stage 8
					// VerificationTimeline UI subscribes to this to render
					// live phase progress; today it's mostly observability.
					bus.emit("apohara://task-phase", {
						taskId: ev.taskId,
						phase: ev.payload?.phase,
						detail: ev.payload?.detail,
						providerId: ev.metadata?.provider,
					});
					break;
				case "mesh_verdict":
					bus.emit("apohara://verifier-conflict", ev.payload);
					break;
				case "session_started":
				case "run_started":
					bus.emit("apohara://run-started", ev.payload);
					break;
				case "plan_changed":
					bus.emit("apohara://plan-changed", ev.payload);
					break;
				case "plan_added":
					bus.emit("apohara://plan-added", ev.payload);
					break;
				case "plan_removed":
					bus.emit("apohara://plan-removed", ev.payload);
					break;
			}
			lastBridgedEventId.current = ev.id;
		}
	}, [ledger.events]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		window.localStorage.setItem(MODE_STORAGE_KEY, mode);
	}, [mode]);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const arr = [...roster].sort();
		window.localStorage.setItem(ROSTER_STORAGE_KEY, JSON.stringify(arr));
		fetch("/api/roster", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ providers: arr }),
		}).catch(() => {
			// Best-effort: client side still has the source of truth.
		});
	}, [roster]);

	const handleModeChange = useCallback((next: RoutingMode) => {
		setMode(next);
		fetch("/api/mode", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ mode: next }),
		}).catch(() => {});
	}, []);

	const seedDemo = useCallback(() => {
		for (const t of DEMO_TASKS) upsertTask(t);
		// Seed only writes the kanban store; the graph view reads from the
		// ledger stream so it would render nothing. Switch automatically.
		setViewMode("board");
	}, [upsertTask, setViewMode]);

	const rosterCsv = useMemo(() => [...roster].sort().join(","), [roster]);

	return (
		<div className="apohara-app" style={{ display: "flex", flexDirection: "column", height: "100vh", background: "#0c0c10", color: "#e6edf3" }}>
			<header
				className="topbar"
				style={{
					display: "flex",
					alignItems: "center",
					gap: "1rem",
					padding: "0.5rem 1rem",
					borderBottom: "1px solid #30363d",
					background: "#0d1117",
				}}
			>
				<span className="brand" style={{ fontWeight: 700, fontSize: "1.05rem" }}>◈ Apohara</span>
				<ViewToggle />
				<span className="session" style={{ color: "#8b949e", fontSize: "0.85rem" }}>
					{sessionId ? `Session ${sessionId.slice(0, 12)}` : "No active run"}
				</span>
				<button
					data-testid="seed-demo"
					onClick={seedDemo}
					style={{
						padding: "0.3rem 0.6rem",
						background: "#21262d",
						color: "#e6edf3",
						border: "1px solid #30363d",
						borderRadius: 4,
						cursor: "pointer",
						fontSize: "0.75rem",
					}}
					title="Inject 5 sample tasks across lanes — dev-mode helper for empty-state demo"
				>
					Seed demo tasks
				</button>
				<div style={{ flex: 1 }} />
				<RosterPicker enabled={roster} onChange={setRoster} />
				<CostMeter events={ledger.events} mode={mode} onModeChange={handleModeChange} />
			</header>

			<main style={{ flex: 1, display: "flex", overflow: "hidden" }}>
				<PlansPanel />

				<section style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
					<ObjectivePane
						onRun={setSessionId}
						active={!!sessionId}
						mode={mode}
						rosterCsv={rosterCsv}
					/>
					<div style={{ flex: 1, overflow: "hidden", borderTop: "1px solid #30363d" }}>
						{viewMode === "board" ? (
						<TaskBoard />
					) : viewMode === "terminal" ? (
						<TerminalView />
					) : (
						<SwarmCanvas events={ledger.events} />
					)}
					</div>
				</section>

				<AgentConfigPanel />
			</main>

			<footer style={{ padding: "0.5rem 1rem", borderTop: "1px solid #30363d", background: "#0d1117" }}>
				<VerificationTimeline />
			</footer>

			<PermissionDialog
				onUserDecision={(resp) => {
					// Best-effort wire to backend (Stage 8 will replace with Tauri event bus).
					fetch("/api/permission/respond", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(resp),
					}).catch(() => {});
				}}
			/>
		</div>
	);
}
