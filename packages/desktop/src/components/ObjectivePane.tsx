import { useState } from "react";

interface ObjectivePaneProps {
	active: boolean;
	onRun: (sessionId: string) => void;
	mode: "gpu" | "cloud";
	rosterCsv: string;
}

export function ObjectivePane({
	active,
	onRun,
	mode,
	rosterCsv,
}: ObjectivePaneProps) {
	const [prompt, setPrompt] = useState("");
	const [enhanced, setEnhanced] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	async function handleEnhance() {
		setBusy(true);
		setError(null);
		try {
			const r = await fetch("/api/enhance", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Apohara-Mode": mode,
					"X-Apohara-Roster": rosterCsv,
				},
				body: JSON.stringify({ prompt, mode }),
			});
			// Server may return JSON even on 5xx; tolerate a non-JSON body too.
			const data = (await r.json().catch(() => ({}))) as {
				enhanced?: string;
				error?: string;
				fallback?: boolean;
			};
			if (!r.ok || data.error) {
				setError(data.error ?? `Enhance failed (HTTP ${r.status})`);
				// When the server returns the original prompt as a "fallback"
				// it adds noise — hide the Enhanced block so the user only
				// sees the actual error.
				setEnhanced(data.fallback ? null : (data.enhanced ?? null));
				return;
			}
			setEnhanced(data.enhanced ?? null);
		} catch (err) {
			setError((err as Error).message);
			setEnhanced(null);
		} finally {
			setBusy(false);
		}
	}

	async function handleRun() {
		setBusy(true);
		setError(null);
		try {
			const r = await fetch("/api/run", {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Apohara-Mode": mode,
					"X-Apohara-Roster": rosterCsv,
				},
				body: JSON.stringify({ prompt: enhanced ?? prompt, mode }),
			});
			const data = (await r.json()) as { sessionId: string; error?: string };
			if (data.error) {
				setError(data.error);
				return;
			}
			onRun(data.sessionId);
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<aside className="pane pane-objective">
			<h2 className="pane-title">Objective</h2>
			<textarea
				className="objective-input"
				placeholder="Describe what to build…"
				value={prompt}
				onChange={(e) => setPrompt(e.target.value)}
				disabled={active || busy}
				rows={8}
			/>
			<div className="objective-actions">
				<button
					type="button"
					onClick={handleEnhance}
					disabled={!prompt || active || busy}
				>
					Enhance ▾
				</button>
				<button
					type="button"
					className="primary"
					onClick={handleRun}
					disabled={!prompt || active || busy}
				>
					Run ▶
				</button>
			</div>
			{error && (
				<div className="enhanced" style={{ borderLeftColor: "var(--error)" }}>
					<h3 style={{ color: "var(--error)" }}>Error</h3>
					<pre className="mono">{error}</pre>
				</div>
			)}
			{enhanced && (
				<div className="enhanced">
					<h3>Enhanced</h3>
					<pre className="mono">{enhanced}</pre>
				</div>
			)}
		</aside>
	);
}
