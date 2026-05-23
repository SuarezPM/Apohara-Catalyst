/**
 * Continuation vs Failure retry semantics — symphony §3.8 (G5.B.8).
 *
 * Two retry FLAVOURS exist; treating them the same is the bug:
 *
 *   Continuation retry   — the previous turn ended SUCCESSFULLY but
 *                          the higher-level intent says "more work
 *                          needed" (see continuation.ts). Context is
 *                          PRESERVED (same system prompt, same
 *                          history). Delay is FIXED 1 s — we're
 *                          inside the user's expected wall-clock.
 *   Failure retry        — the previous turn ended FAILED (transient
 *                          network, rate-limit, provider 5xx, stall).
 *                          Context is RESET (fresh thread). Delay is
 *                          EXPONENTIAL backoff capped at 5 min.
 *
 * Why this matters: applying a 30-second exponential backoff to a
 * continuation chain wrecks UX (the user is watching the agent type);
 * applying a fixed 1-second delay to a rate-limited transient
 * hammers the provider and gets us blocklisted faster. Mixing the
 * semantics produces both failure modes.
 *
 * Pure value module — no I/O, no clocks. Schedulers call `nextDelay`
 * to compute the deadline; `setTimeout` lives in the caller.
 */

export type RetryReason =
	| "continuation"     // success-but-more-work; preserve context
	| "transient"        // network / timeout / rate-limit; fresh context
	| "stall"            // worker died mid-flight; fresh context
	| "provider_error"   // 5xx / driver-internal; fresh context
	| "none";            // hard failure or unknown; do NOT retry

const CAP_MS = 5 * 60 * 1000; // 5 min hard cap on backoff

export interface NextDelayInput {
	reason: RetryReason;
	attempt: number;
}

/**
 * Compute the milliseconds to wait before the next retry.
 *
 *   continuation: 1000 (fixed)
 *   transient / stall / provider_error: 1000 × 2^attempt, capped CAP_MS
 *   none: 0 (caller MUST NOT schedule a retry)
 */
export function nextDelay(input: NextDelayInput): number {
	switch (input.reason) {
		case "continuation":
			return 1000;
		case "transient":
		case "stall":
		case "provider_error": {
			const raw = 1000 * 2 ** input.attempt;
			return Math.min(raw, CAP_MS);
		}
		case "none":
			return 0;
	}
}

/**
 * Heuristic classifier — maps an Error message to a RetryReason.
 * Errors we don't recognise return `"none"` (default deny: don't
 * retry unknown failures, surface them).
 */
export function classifyRetryReason(err: Error): RetryReason {
	const msg = err.message;
	// Order matters — stall first (it might contain "timeout"-shaped
	// substrings) then timeout, rate-limit, network.
	if (/\bstall|stalled\b/i.test(msg)) return "stall";
	if (/timed out|timeout|ETIMEDOUT/i.test(msg)) return "transient";
	if (/\b429\b|rate.?limit/i.test(msg)) return "transient";
	if (/ECONN|EAI|EADDR|network/i.test(msg)) return "transient";
	if (/\b5\d{2}\b|bad gateway|service unavailable|provider returned/i.test(msg)) {
		return "provider_error";
	}
	return "none";
}

/**
 * Whether the retry should preserve context (same system prompt +
 * history) or start fresh. Only the continuation reason preserves
 * context — every failure flavour resets the thread so we don't
 * accumulate broken state.
 */
export function shouldPreserveContext(reason: RetryReason): boolean {
	return reason === "continuation";
}

/**
 * Whether the caller should retry given the reason and attempt count.
 *   `none` reason: never retry.
 *   else: retry while `attempt < maxAttempts`.
 *
 * Note `attempt` is 0-indexed — the first retry uses attempt=0.
 */
export function shouldRetry(
	reason: RetryReason,
	attempt: number,
	maxAttempts: number,
): boolean {
	if (reason === "none") return false;
	return attempt < maxAttempts;
}
