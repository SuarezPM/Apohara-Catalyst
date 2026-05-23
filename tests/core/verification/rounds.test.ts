/**
 * chorus hallazgo 15 — maxRounds + escalation explícita (G5.B.7).
 *
 * Verification pipelines today run "to completion" — there's no
 * cap on the number of critic/judge rounds. A verification loop
 * that never converges burns provider tokens forever. Chorus solves
 * this with an explicit `max_verify_rounds` per DAG node + an
 * `ESCALATED` terminal state that surfaces the unfinished work to
 * the operator without blocking descendants that don't depend on
 * its output.
 *
 *   newVerificationRound(maxRounds=3) → tracker
 *   advanceRound(tracker)             → tracker'
 *   isExhausted(tracker)              → bool
 *   markEscalated(tracker)            → tracker'
 *   roundOutcome(tracker)             → "in_progress" | "exhausted" | "escalated"
 *
 * Pure value module — no DB, no I/O. The orchestration migrations
 * will store `tracker.round` + `tracker.maxRounds` per task and use
 * `roundOutcome` to decide whether to publish to descendants.
 */
import { expect, test } from "bun:test";
import {
	advanceRound,
	isExhausted,
	markEscalated,
	newVerificationRound,
	roundOutcome,
} from "../../../src/core/verification/verificationRounds";

test("newVerificationRound starts at round 0 with the requested max", () => {
	const t = newVerificationRound({ maxRounds: 3 });
	expect(t.round).toBe(0);
	expect(t.maxRounds).toBe(3);
	expect(t.escalated).toBe(false);
});

test("advanceRound increments round counter", () => {
	let t = newVerificationRound({ maxRounds: 3 });
	t = advanceRound(t);
	expect(t.round).toBe(1);
	t = advanceRound(t);
	expect(t.round).toBe(2);
});

test("isExhausted true when round reaches maxRounds", () => {
	let t = newVerificationRound({ maxRounds: 2 });
	expect(isExhausted(t)).toBe(false);
	t = advanceRound(t);
	expect(isExhausted(t)).toBe(false);
	t = advanceRound(t);
	expect(isExhausted(t)).toBe(true);
});

test("advanceRound past exhaustion does NOT silently grow round", () => {
	let t = newVerificationRound({ maxRounds: 2 });
	t = advanceRound(t); // 1
	t = advanceRound(t); // 2 = exhausted
	t = advanceRound(t); // attempted to advance past exhaustion
	// Once exhausted, callers should escalate or stop — the tracker
	// refuses to keep counting (defensive; symptom of a bug).
	expect(t.round).toBe(2);
});

test("markEscalated sets the escalated flag without resetting round counter", () => {
	let t = newVerificationRound({ maxRounds: 5 });
	t = advanceRound(t);
	t = markEscalated(t);
	expect(t.escalated).toBe(true);
	expect(t.round).toBe(1);
});

test("roundOutcome: in_progress when not exhausted and not escalated", () => {
	const t = newVerificationRound({ maxRounds: 3 });
	expect(roundOutcome(t)).toBe("in_progress");
});

test("roundOutcome: exhausted when round hits max without escalation", () => {
	let t = newVerificationRound({ maxRounds: 2 });
	t = advanceRound(t);
	t = advanceRound(t);
	expect(roundOutcome(t)).toBe("exhausted");
});

test("roundOutcome: escalated has highest precedence", () => {
	let t = newVerificationRound({ maxRounds: 2 });
	t = advanceRound(t);
	t = advanceRound(t);
	t = markEscalated(t);
	expect(roundOutcome(t)).toBe("escalated");
});

test("default maxRounds is 3 when unspecified", () => {
	const t = newVerificationRound({});
	expect(t.maxRounds).toBe(3);
});

test("maxRounds=0 means a single ignition turn cannot be advanced", () => {
	const t = newVerificationRound({ maxRounds: 0 });
	expect(isExhausted(t)).toBe(true);
});
