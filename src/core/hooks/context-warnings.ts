/**
 * Context warnings — G5.C.3 (claude-octopus #4).
 *
 * Watches token usage per session and emits warning events when the agent
 * approaches its context limit. Bands:
 *
 *   - ok       (<75%): silent
 *   - caution  (>=75%): "context filling, consider summarizing soon"
 *   - warning  (>=85%): "compaction likely imminent"
 *   - critical (>=95%): "compaction expected within next tool call"
 *
 * The UI consumes these events for the Statusline (G5.C.2). The compactor
 * (G5.C.1) hooks the pre_compact event independently.
 *
 * De-duplication: we only emit on transitions to a strictly higher band.
 * Drop-backs are silent because the band is monotonic-by-design (context
 * usage only grows mid-session). If the band drops, we keep the higher
 * mark so a subsequent escalation doesn't double-fire on the same level.
 *
 * Sessions ending should call `forget(sessionId)` to release the band entry.
 */

export type ContextLevel = "ok" | "caution" | "warning" | "critical";

export interface ContextUsageClassification {
	level: ContextLevel;
	percent: number;
}

export interface ContextUsageEvent {
	sessionId: string;
	level: ContextLevel;
	percent: number;
	tokensUsed: number;
	tokensLimit: number;
}

export interface MonitorOptions {
	emit(event: ContextUsageEvent): void;
}

export interface ObserveInput {
	sessionId: string;
	tokensUsed: number;
	tokensLimit: number;
}

const ORDER: ContextLevel[] = ["ok", "caution", "warning", "critical"];

export function classifyContextUsage(
	tokensUsed: number,
	tokensLimit: number,
): ContextUsageClassification {
	if (tokensLimit <= 0) return { level: "ok", percent: 0 };
	const ratio = tokensUsed / tokensLimit;
	const percent = Math.round(ratio * 1000) / 10; // 1 decimal
	let level: ContextLevel = "ok";
	if (ratio >= 0.95) level = "critical";
	else if (ratio >= 0.85) level = "warning";
	else if (ratio >= 0.75) level = "caution";
	return { level, percent };
}

export class ContextWarningMonitor {
	private bands = new Map<string, ContextLevel>();

	constructor(private readonly opts: MonitorOptions) {}

	observe(input: ObserveInput): void {
		const { level, percent } = classifyContextUsage(
			input.tokensUsed,
			input.tokensLimit,
		);
		const previous = this.bands.get(input.sessionId) ?? "ok";
		if (ORDER.indexOf(level) > ORDER.indexOf(previous)) {
			this.bands.set(input.sessionId, level);
			this.opts.emit({
				sessionId: input.sessionId,
				level,
				percent,
				tokensUsed: input.tokensUsed,
				tokensLimit: input.tokensLimit,
			});
		} else if (level === "ok" && previous !== "ok") {
			// silent drop — keep the high-water mark
		}
	}

	forget(sessionId: string): void {
		this.bands.delete(sessionId);
	}

	currentBand(sessionId: string): ContextLevel {
		return this.bands.get(sessionId) ?? "ok";
	}
}
