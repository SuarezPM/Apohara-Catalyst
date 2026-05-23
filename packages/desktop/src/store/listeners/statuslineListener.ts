/**
 * Statusline listener — G5.C.2.
 *
 * Maps hook events (`apohara://hook-event`), context-warning events
 * (`apohara://context-warning`), and run/session events to patches of
 * `statusAtom`. Centralized per §0.1 — registered once at boot, never
 * per component.
 */
import type { ListenerDeps, RegistrationHandle } from "./index.js";
import {
	patchStatusAtom,
	resetStatusAtom,
	type ContextLevel,
} from "../statusStore.js";

interface HookEventPayload {
	type?: string;
	tool_name?: string;
	duration_ms?: number;
	[k: string]: unknown;
}

interface ContextWarningPayload {
	level?: ContextLevel;
	tokensUsed?: number;
	tokensLimit?: number;
	percent?: number;
}

interface RunStartedPayload {
	sessionId?: string;
}

export function registerStatuslineListener(
	deps: ListenerDeps,
): RegistrationHandle {
	// `deps.store.set` accepts our jotai write-only atoms via the `unknown`
	// indirection in the store interface. Cast through unknown to satisfy
	// the runtime store signature without lying to TS in the listener.
	const set = (atomRef: unknown, value: unknown) =>
		deps.store.set(atomRef, value);

	let activeToolCount = 0;

	const onHook = (raw: unknown) => {
		const ev = (raw ?? {}) as HookEventPayload;
		if (typeof ev.type !== "string") return;
		switch (ev.type) {
			case "pre_tool_use":
				activeToolCount += 1;
				set(patchStatusAtom, {
					activeToolCount,
					lastHook: `pre_tool_use${ev.tool_name ? ` ${ev.tool_name}` : ""}`,
				});
				break;
			case "post_tool_use":
				activeToolCount = Math.max(0, activeToolCount - 1);
				set(patchStatusAtom, {
					activeToolCount,
					lastHook: `post_tool_use${ev.tool_name ? ` ${ev.tool_name}` : ""}`,
					lastToolLatencyMs:
						typeof ev.duration_ms === "number" ? ev.duration_ms : null,
				});
				break;
			case "post_tool_use_failure":
				activeToolCount = Math.max(0, activeToolCount - 1);
				set(patchStatusAtom, {
					activeToolCount,
					lastHook: `tool_failed${ev.tool_name ? ` ${ev.tool_name}` : ""}`,
				});
				break;
			case "stop":
				set(patchStatusAtom, {
					lastHook: "stopped",
					bannerMessage: null,
				});
				break;
			case "user_prompt_submit":
				set(patchStatusAtom, { lastHook: "prompt_submit" });
				break;
		}
	};

	const onWarn = (raw: unknown) => {
		const ev = (raw ?? {}) as ContextWarningPayload;
		const patch: Record<string, unknown> = {};
		if (ev.level) patch.contextLevel = ev.level;
		if (typeof ev.tokensUsed === "number") patch.tokensUsed = ev.tokensUsed;
		if (typeof ev.tokensLimit === "number") patch.tokensLimit = ev.tokensLimit;
		if (ev.level === "critical") {
			patch.bannerMessage = "Context near limit — compaction expected soon";
		} else if (ev.level === "warning") {
			patch.bannerMessage = "Context filling — summarize/compact soon";
		} else {
			patch.bannerMessage = null;
		}
		set(patchStatusAtom, patch);
	};

	const onRunStart = (raw: unknown) => {
		const ev = (raw ?? {}) as RunStartedPayload;
		// New session: reset counters AND mark the session label.
		activeToolCount = 0;
		set(resetStatusAtom, undefined);
		set(patchStatusAtom, { session: ev.sessionId ?? null });
	};

	deps.bus.on("apohara://hook-event", onHook);
	deps.bus.on("apohara://context-warning", onWarn);
	deps.bus.on("apohara://run-started", onRunStart);

	return {
		dispose() {
			deps.bus.off("apohara://hook-event", onHook);
			deps.bus.off("apohara://context-warning", onWarn);
			deps.bus.off("apohara://run-started", onRunStart);
		},
	};
}
