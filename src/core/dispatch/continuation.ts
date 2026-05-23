/**
 * Continuation turns — symphony §10.3 + §16.5 + T3.9 (G5.B.4).
 *
 * Token-economy primitive. A "thread" starts with one system prompt +
 * one user turn (the full system prompt is expensive); subsequent
 * turns within the same thread carry only the new user message. The
 * provider holds the system prompt in its own context (session-id
 * passthrough or local cache), so we don't pay for it again.
 *
 * Net effect: one expensive "ignition" turn + N cheap follow-ups, vs.
 * N×ignition cost when issuing each turn as a fresh request.
 *
 * Pure module: no I/O, no syscalls. Provider drivers consume the
 * `ContinuationRequest` returned by `nextTurn()` and decide how to
 * stream it (via session-id reuse for Claude Code, format=json+id for
 * OpenCode, etc).
 *
 * Termination:
 *   - explicit `markDone(thread)` (caller decides the agent answered)
 *   - hitting `maxTurns` (defense in depth — caller should
 *     short-circuit on success, but the cap stops runaway loops).
 *
 * The module is deliberately minimal: no retry, no auto-prompting.
 * Higher layers (retry-semantics.ts G5.B.8, executor-action.ts) wrap
 * this with retry policy. Keeping `continuation.ts` value-pure makes
 * the chain trivially testable.
 */

export type MessageRole = "system" | "user" | "assistant";

export interface Message {
	role: MessageRole;
	content: string;
}

export interface ContinuationThread {
	/** Total assistant turns produced so far (matches `markAssistant`
	 * count). Turn 0 = the initial ignition turn before any answer. */
	turn: number;
	/** Hard ceiling — `nextTurn` short-circuits to "done" once `turn`
	 * reaches this. */
	maxTurns: number;
	/** Set to true after the FIRST `nextTurn` issues the system
	 * prompt. Drives `includeSystemPrompt` in subsequent requests. */
	systemPromptIssued: boolean;
	/** Explicit done flag — once set, `nextTurn` returns "done". */
	done: boolean;
	/** Full message history — symmetry with the LLMMessage shape the
	 * driver layer expects. Includes the system prompt as the first
	 * entry. */
	messages: Message[];
}

export interface NewThreadOptions {
	systemPrompt: string;
	initialUserPrompt: string;
	maxTurns?: number;
}

export function newContinuationThread(
	opts: NewThreadOptions,
): ContinuationThread {
	return {
		turn: 0,
		maxTurns: opts.maxTurns ?? 10,
		systemPromptIssued: false,
		done: false,
		messages: [
			{ role: "system", content: opts.systemPrompt },
			{ role: "user", content: opts.initialUserPrompt },
		],
	};
}

export interface ContinuationRequest {
	/** Whether the driver should include the system prompt in its
	 * outbound payload. `true` only on turn 0 (the ignition turn) —
	 * `false` on every continuation so we save the system tokens. */
	includeSystemPrompt: boolean;
	/** Materialized message list for the driver. When
	 * `includeSystemPrompt === false`, the system entry is stripped. */
	messages: Message[];
}

export interface NextTurnInput {
	/** Optional new user message to append before issuing. Skipped for
	 * the very first `nextTurn` call (the ignition turn already has
	 * the initial user prompt). */
	userPrompt?: string;
}

export type NextTurnResult =
	| { thread: ContinuationThread; request: ContinuationRequest }
	| "done";

/**
 * Advance the thread by one turn. On the first call (turn 0) returns
 * the full system + initial-user request; on subsequent calls returns
 * the system-prompt-stripped request with the new user message
 * appended.
 *
 * If `thread.done` is true OR `thread.turn >= thread.maxTurns`, returns
 * the sentinel `"done"`.
 *
 * Note: the returned `thread` carries `systemPromptIssued: true` after
 * the first call but is otherwise unchanged — `markAssistant` is what
 * the caller invokes once the agent's response arrives.
 */
export function nextTurn(
	thread: ContinuationThread,
	input: NextTurnInput = {},
): NextTurnResult {
	if (thread.done) return "done";
	if (thread.turn >= thread.maxTurns) return "done";

	const isIgnition = !thread.systemPromptIssued;

	// Append new user prompt if provided. The ignition turn already
	// has its initial-user message from `newContinuationThread`.
	let messages = thread.messages;
	if (input.userPrompt && !isIgnition) {
		messages = [...messages, { role: "user", content: input.userPrompt }];
	}

	const request: ContinuationRequest = {
		includeSystemPrompt: isIgnition,
		messages: isIgnition
			? messages
			: messages.filter((m) => m.role !== "system"),
	};

	return {
		thread: { ...thread, messages, systemPromptIssued: true },
		request,
	};
}

/**
 * Record the assistant's response in the message history and advance
 * the turn counter. Caller invokes this once the driver yields the
 * assistant content for the current turn.
 */
export function markAssistant(
	thread: ContinuationThread,
	content: string,
): ContinuationThread {
	return {
		...thread,
		turn: thread.turn + 1,
		messages: [...thread.messages, { role: "assistant", content }],
	};
}

/**
 * Caller signals the thread is logically finished (the agent answered
 * the original ask, or higher-level criteria are met). Subsequent
 * `nextTurn` calls short-circuit to "done".
 */
export function markDone(thread: ContinuationThread): ContinuationThread {
	return { ...thread, done: true };
}
