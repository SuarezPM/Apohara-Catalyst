/**
 * Symphony §10.3 + §16.5 — Continuation turns / "live thread"
 * (T3.9, G5.B.4).
 *
 * Token-economy primitive: a thread starts with one system prompt + one
 * user turn, and continues for N cheap follow-up turns that carry
 * only the new user input. The provider holds the system prompt in
 * its own context (either via session-id passthrough or local
 * cache); we never re-send it. Net effect: N×cheaper continuation
 * vs. N full system-prompt re-issues.
 *
 * The module is a pure state machine over a `ContinuationThread`
 * value; no I/O. Provider drivers consume it to decide whether to
 * include the system prompt in the next request.
 *
 *   newContinuationThread({ systemPrompt, initialUserPrompt, maxTurns })
 *   nextTurn(thread, userPrompt) → { thread', request } | "done"
 *   markAssistant(thread, content) → thread'
 *
 * Termination conditions:
 *   - explicit `markDone(thread)` (caller decides the agent answered)
 *   - hitting `maxTurns` (defense in depth)
 */
import { expect, test } from "bun:test";
import {
	markAssistant,
	markDone,
	newContinuationThread,
	nextTurn,
	type ContinuationThread,
} from "../../../src/core/dispatch/continuation";

test("newContinuationThread starts at turn 0, primed with system + initial user", () => {
	const t = newContinuationThread({
		systemPrompt: "you are a helper",
		initialUserPrompt: "hi",
		maxTurns: 5,
	});
	expect(t.turn).toBe(0);
	expect(t.done).toBe(false);
	expect(t.systemPromptIssued).toBe(false);
	expect(t.messages).toEqual([
		{ role: "system", content: "you are a helper" },
		{ role: "user", content: "hi" },
	]);
});

test("nextTurn at turn 0 returns the FULL request with system prompt", () => {
	const t = newContinuationThread({
		systemPrompt: "you are a helper",
		initialUserPrompt: "hi",
		maxTurns: 5,
	});
	const result = nextTurn(t);
	if (result === "done") throw new Error("unexpected done at turn 0");
	expect(result.request.includeSystemPrompt).toBe(true);
	expect(result.request.messages).toEqual([
		{ role: "system", content: "you are a helper" },
		{ role: "user", content: "hi" },
	]);
	expect(result.thread.systemPromptIssued).toBe(true);
});

test("subsequent nextTurn calls EXCLUDE the system prompt (token saving)", () => {
	let t = newContinuationThread({
		systemPrompt: "you are a helper",
		initialUserPrompt: "hi",
		maxTurns: 5,
	});
	let r = nextTurn(t);
	if (r === "done") throw new Error("unexpected");
	t = markAssistant(r.thread, "hello back");
	t = { ...t, messages: [...t.messages, { role: "user", content: "follow-up" }] };

	const r2 = nextTurn(t, { userPrompt: "follow-up" });
	if (r2 === "done") throw new Error("unexpected done on turn 1");
	expect(r2.request.includeSystemPrompt).toBe(false);
	expect(r2.request.messages.find((m) => m.role === "system")).toBeUndefined();
});

test("nextTurn auto-appends a user message when userPrompt is provided", () => {
	let t = newContinuationThread({
		systemPrompt: "sys",
		initialUserPrompt: "hi",
		maxTurns: 5,
	});
	let r = nextTurn(t);
	if (r === "done") throw new Error("unexpected");
	t = markAssistant(r.thread, "hello");
	const r2 = nextTurn(t, { userPrompt: "more" });
	if (r2 === "done") throw new Error("unexpected");
	// The new user prompt should be the LAST message.
	const lastUser = r2.request.messages.findLast((m) => m.role === "user");
	expect(lastUser?.content).toBe("more");
});

test("markDone short-circuits subsequent nextTurn to 'done'", () => {
	let t = newContinuationThread({
		systemPrompt: "sys",
		initialUserPrompt: "hi",
		maxTurns: 5,
	});
	t = markDone(t);
	expect(nextTurn(t)).toBe("done");
});

test("hitting maxTurns yields 'done'", () => {
	let t: ContinuationThread = newContinuationThread({
		systemPrompt: "sys",
		initialUserPrompt: "u0",
		maxTurns: 2,
	});
	// Turn 0
	let r = nextTurn(t);
	if (r === "done") throw new Error("unexpected");
	t = markAssistant(r.thread, "a0");
	// Turn 1
	const r2 = nextTurn(t, { userPrompt: "u1" });
	if (r2 === "done") throw new Error("unexpected");
	t = markAssistant(r2.thread, "a1");
	// Turn 2 — equal to maxTurns, no more cheap continuations
	expect(nextTurn(t, { userPrompt: "u2" })).toBe("done");
});

test("markAssistant appends assistant message and increments turn counter", () => {
	let t = newContinuationThread({
		systemPrompt: "sys",
		initialUserPrompt: "hi",
		maxTurns: 5,
	});
	const r = nextTurn(t);
	if (r === "done") throw new Error("unexpected");
	t = markAssistant(r.thread, "hello");
	expect(t.turn).toBe(1);
	expect(t.messages.at(-1)).toEqual({ role: "assistant", content: "hello" });
});
