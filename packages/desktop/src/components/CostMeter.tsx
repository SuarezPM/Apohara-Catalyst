import { useMemo } from "react";
import type { EventLog } from "../lib/types.js";

interface CostMeterProps {
	events: EventLog[];
	mode: "gpu" | "cloud";
	onModeChange: (mode: "gpu" | "cloud") => void;
}

/**
 * Top-bar cost meter — cumulative tokens, USD spent, USD saved by ContextForge.
 *
 * Token + cost totals are derived from `event.metadata.{tokens,costUsd}`.
 *
 * Savings come from `contextforge_savings` events, where the ledger records
 * `costUsdLocal=0` and a `costUsdBaselineEstimate` against a cheap cloud
 * reference (Groq llama-3.3-70b). `saved = baseline - local`.
 *
 * GPU/Cloud toggle (M015.5) is the user-facing surface for the routing
 * preference. Persistence + server-side honoring lands when /api/mode wires
 * to the ProviderRouter's enabled-providers set.
 */
export function CostMeter({ events, mode, onModeChange }: CostMeterProps) {
	const { tokens, costUsd, savedUsd } = useMemo(() => {
		let tokens = 0;
		let costUsd = 0;
		let savedUsd = 0;
		for (const e of events) {
			const tok = e.metadata?.tokens?.total;
			if (typeof tok === "number") tokens += tok;
			const cost = e.metadata?.costUsd;
			if (typeof cost === "number") costUsd += cost;
			if (e.type === "contextforge_savings") {
				const local =
					typeof e.payload?.costUsdLocal === "number"
						? e.payload.costUsdLocal
						: 0;
				const baseline =
					typeof e.payload?.costUsdBaselineEstimate === "number"
						? e.payload.costUsdBaselineEstimate
						: 0;
				savedUsd += Math.max(0, baseline - local);
			}
		}
		return { tokens, costUsd, savedUsd };
	}, [events]);

	return (
		<div className="cost-meter mono">
			<span>
				<span className="cost-tokens">{tokens.toLocaleString()}</span> tok
			</span>
			<span>
				<span className="cost-usd">${costUsd.toFixed(4)}</span> spent
			</span>
			{savedUsd > 0 && (
				<span title="Saved via Apohara ContextForge / local Carnice routing">
					<span className="cost-savings">${savedUsd.toFixed(4)}</span> saved
				</span>
			)}
			<div className="mode-toggle" role="radiogroup" aria-label="routing mode">
				<button
					type="button"
					role="radio"
					aria-checked={mode === "gpu"}
					className={mode === "gpu" ? "active" : ""}
					onClick={() => onModeChange("gpu")}
					title="Prefer local GPU (Carnice / ContextForge)"
				>
					GPU
				</button>
				<button
					type="button"
					role="radio"
					aria-checked={mode === "cloud"}
					className={mode === "cloud" ? "active" : ""}
					onClick={() => onModeChange("cloud")}
					title="Prefer cloud providers"
				>
					Cloud
				</button>
			</div>
		</div>
	);
}
