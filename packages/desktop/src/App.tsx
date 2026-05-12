import { useCallback, useEffect, useMemo, useState } from "react";
import { CodeDiffPane } from "./components/CodeDiffPane.js";
import { CostMeter } from "./components/CostMeter.js";
import { ObjectivePane } from "./components/ObjectivePane.js";
import {
	ALL_PROVIDERS,
	type ProviderId,
	RosterPicker,
} from "./components/RosterPicker.js";
import { SwarmCanvas } from "./components/SwarmCanvas.js";
import { useLedgerStream } from "./hooks/useLedgerStream.js";

/**
 * Three-column visual orchestrator layout per Roadmap v2.0 M017.
 *
 * | Objective | Swarm Canvas | Code + Diff |
 *
 * Top bar: AI roster picker (multi-AI core pitch) + GPU/Cloud routing
 * mode toggle + cost meter. Stream: SSE tail of .events/run-*.jsonl
 * from Bun.serve backend.
 */

type RoutingMode = "gpu" | "cloud";

const MODE_STORAGE_KEY = "apohara.routingMode";
const ROSTER_STORAGE_KEY = "apohara.providerRoster";

function loadRoster(): Set<ProviderId> {
	if (typeof window === "undefined") return new Set(ALL_PROVIDERS);
	const raw = window.localStorage.getItem(ROSTER_STORAGE_KEY);
	if (!raw) return new Set(ALL_PROVIDERS);
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
	return new Set(ALL_PROVIDERS);
}

export function App() {
	const [sessionId, setSessionId] = useState<string | null>(null);
	const [mode, setMode] = useState<RoutingMode>(() => {
		if (typeof window === "undefined") return "gpu";
		const stored = window.localStorage.getItem(MODE_STORAGE_KEY);
		return stored === "cloud" ? "cloud" : "gpu";
	});
	const [roster, setRoster] = useState<Set<ProviderId>>(() => loadRoster());

	const ledger = useLedgerStream(sessionId);

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

	const rosterCsv = useMemo(() => [...roster].sort().join(","), [roster]);

	return (
		<div className="apohara-app">
			<header className="topbar">
				<span className="brand">◈ Apohara</span>
				<span className="session">
					{sessionId ? `Session ${sessionId.slice(0, 12)}` : "No active run"}
				</span>
				<RosterPicker enabled={roster} onChange={setRoster} />
				<CostMeter
					events={ledger.events}
					mode={mode}
					onModeChange={handleModeChange}
				/>
			</header>
			<main className="three-pane">
				<ObjectivePane
					onRun={setSessionId}
					active={!!sessionId}
					mode={mode}
					rosterCsv={rosterCsv}
				/>
				<SwarmCanvas events={ledger.events} />
				<CodeDiffPane events={ledger.events} />
			</main>
		</div>
	);
}
