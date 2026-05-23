/**
 * Statusline — G5.C.2 (claude-octopus #3).
 *
 * Footer-row badges driven by `statusAtom`. Hook events flow into the
 * store via `statusLineListener` (registered in `store/listeners/`).
 *
 * Visible badges:
 *   - Session label / "no session"
 *   - Token usage (used/limit + %)
 *   - Context band (caution/warning/critical color)
 *   - Active tool count
 *   - Last hook + latency
 *
 * A red banner spans the row when bannerMessage is set (e.g. compaction
 * imminent).
 */
import { useAtomValue } from "jotai/react";
import { statusAtom, type ContextLevel } from "../store/statusStore.js";

const LEVEL_STYLE: Record<ContextLevel, { color: string; bg: string; label: string }> = {
	ok: { color: "#3fb950", bg: "#0d2818", label: "OK" },
	caution: { color: "#d29922", bg: "#2d2510", label: "CAUTION" },
	warning: { color: "#db6d28", bg: "#2d1d10", label: "WARNING" },
	critical: { color: "#f85149", bg: "#2d1010", label: "CRITICAL" },
};

function pct(used: number, limit: number): number {
	if (limit <= 0) return 0;
	return Math.round((used / limit) * 100);
}

export function Statusline() {
	const status = useAtomValue(statusAtom);
	const levelStyle = LEVEL_STYLE[status.contextLevel];

	return (
		<div
			data-testid="statusline"
			role="status"
			aria-live="polite"
			style={{
				display: "flex",
				alignItems: "center",
				gap: "0.8rem",
				padding: "0.3rem 0.8rem",
				background: "#0d1117",
				borderTop: "1px solid #21262d",
				color: "#8b949e",
				fontSize: "0.75rem",
				fontFamily: "var(--mono, monospace)",
				minHeight: 24,
			}}
		>
			<span data-testid="status-session">
				{status.session ? `◇ ${status.session.slice(0, 14)}` : "◇ no session"}
			</span>

			<span data-testid="status-tokens" title={`${status.tokensUsed} / ${status.tokensLimit}`}>
				⊞ {status.tokensUsed.toLocaleString()}
				{status.tokensLimit > 0 ? ` / ${status.tokensLimit.toLocaleString()} (${pct(status.tokensUsed, status.tokensLimit)}%)` : ""}
			</span>

			<span
				data-testid="status-level"
				data-level={status.contextLevel}
				style={{
					padding: "1px 6px",
					borderRadius: 3,
					color: levelStyle.color,
					background: levelStyle.bg,
					fontWeight: 600,
				}}
			>
				{levelStyle.label}
			</span>

			<span data-testid="status-tools">
				⚙ {status.activeToolCount} active
			</span>

			{status.lastHook && (
				<span data-testid="status-last-hook" style={{ color: "#7d8590" }}>
					last: {status.lastHook}
					{status.lastToolLatencyMs != null && ` (${status.lastToolLatencyMs}ms)`}
				</span>
			)}

			<div style={{ flex: 1 }} />

			{status.bannerMessage && (
				<span
					data-testid="status-banner"
					style={{
						padding: "1px 8px",
						borderRadius: 3,
						color: "#f85149",
						background: "#2d1010",
						fontWeight: 600,
					}}
				>
					! {status.bannerMessage}
				</span>
			)}
		</div>
	);
}
