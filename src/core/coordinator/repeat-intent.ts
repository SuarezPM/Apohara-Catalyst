/**
 * Repeat-intent detection (G6.D.4).
 *
 * Rolling window per intent — if the SAME intent fires 3 times within a
 * 5-minute window, emit `repeat-intent-detected` so the auto-spawn
 * integration (G6.D.5) can spin up a dedicated provider session for the
 * user instead of making them re-route manually each turn.
 *
 * Independent of `APOHARA_SMART_ROUTER`: the smart router decides which
 * intent each prompt has; this module asks "have we seen this same
 * intent three times recently?". Detectors are cheap — one per session
 * is fine.
 *
 * Pure data structure + emitter — no IO, no timers. The caller advances
 * time by passing a `now` (or relying on the default `Date.now`); tests
 * inject a fake clock.
 */
import type { Intent } from "./intent-types";

export const REPEAT_WINDOW_MS_DEFAULT = 5 * 60 * 1000;
export const REPEAT_THRESHOLD_DEFAULT = 3;

export interface RepeatIntentEvent {
	type: "repeat-intent-detected";
	intent: Intent;
	count: number;
	firstSeenAt: number;
	lastSeenAt: number;
}

export type RepeatIntentListener = (evt: RepeatIntentEvent) => void;

export interface RepeatIntentDetectorOpts {
	windowMs?: number;
	threshold?: number;
	clock?: () => number;
}

export interface RepeatIntentDetector {
	record: (intent: Intent, now?: number) => RepeatIntentEvent | null;
	onRepeat: (listener: RepeatIntentListener) => () => void;
	currentCount: (intent: Intent, now?: number) => number;
	resetForTests: () => void;
}

export function createRepeatIntentDetector(
	opts: RepeatIntentDetectorOpts = {},
): RepeatIntentDetector {
	const windowMs = opts.windowMs ?? REPEAT_WINDOW_MS_DEFAULT;
	const threshold = opts.threshold ?? REPEAT_THRESHOLD_DEFAULT;
	const clock = opts.clock ?? Date.now;

	const buckets = new Map<Intent, number[]>();
	const listeners = new Set<RepeatIntentListener>();
	// Counts how many records have arrived since the last fire (cleared
	// to 0 each time we fire). Prevents per-prompt event storm: the
	// spike must be sustained — `threshold` MORE recordings before
	// the detector re-emits.
	const sinceLastFire = new Map<Intent, number>();
	const everFired = new Set<Intent>();

	function purge(intent: Intent, now: number): number[] {
		const arr = buckets.get(intent) ?? [];
		const fresh = arr.filter((t) => now - t < windowMs);
		buckets.set(intent, fresh);
		return fresh;
	}

	function record(intent: Intent, now: number = clock()): RepeatIntentEvent | null {
		const fresh = purge(intent, now);
		fresh.push(now);
		buckets.set(intent, fresh);
		sinceLastFire.set(intent, (sinceLastFire.get(intent) ?? 0) + 1);

		if (fresh.length < threshold) {
			return null;
		}
		if (everFired.has(intent) && (sinceLastFire.get(intent) ?? 0) < threshold) {
			return null;
		}
		everFired.add(intent);
		sinceLastFire.set(intent, 0);
		const evt: RepeatIntentEvent = {
			type: "repeat-intent-detected",
			intent,
			count: fresh.length,
			firstSeenAt: fresh[0] ?? now,
			lastSeenAt: now,
		};
		for (const l of listeners) l(evt);
		return evt;
	}

	return {
		record,
		onRepeat(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		currentCount(intent, now = clock()) {
			return purge(intent, now).length;
		},
		resetForTests() {
			buckets.clear();
			listeners.clear();
			sinceLastFire.clear();
			everFired.clear();
		},
	};
}
