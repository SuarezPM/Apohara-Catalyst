/**
 * Symphony §3 / §7.1 state machine — claim states + phase states + helpers.
 *
 * Covers:
 *   - `isClaimable(state)` returns true only for `unclaimed` and
 *     `released` (these are the two states the scheduler should
 *     consider work waiting to be picked).
 *   - `canTransition(from, to)` enforces the legal claim-state DAG so a
 *     stale call site can't accidentally turn a `released` row back to
 *     `running` without going through `claimed` first.
 *   - `isTerminalPhase` recognises the 5 terminal phases.
 *   - `phaseImpliesSuccess` distinguishes "success ≠ done" — the
 *     continuation pattern from symphony §10.3 requires we tell apart
 *     `succeeded` (this turn ended cleanly) from `failed`/`timed_out`/
 *     `stalled` (this turn ended dirtily) AND from `done` (the parent
 *     intent reached its terminal state across N continuations).
 *   - `freshClaimToken()` returns a RFC 4122 UUID so the orchestrator
 *     can attach it to a claim row and reject release attempts coming
 *     from another worker that doesn't know the token.
 */
import { expect, test } from "bun:test";
import {
	canTransition,
	freshClaimToken,
	isClaimable,
	isTerminalPhase,
	phaseImpliesSuccess,
	type RunPhase,
	type RunState,
} from "../../../src/core/dispatch/state";

test("isClaimable only matches unclaimed + released", () => {
	expect(isClaimable("unclaimed")).toBe(true);
	expect(isClaimable("released")).toBe(true);
	expect(isClaimable("claimed")).toBe(false);
	expect(isClaimable("running")).toBe(false);
	expect(isClaimable("retry_queued")).toBe(false);
});

test("canTransition enforces the symphony §7.1 claim-state DAG", () => {
	// happy path
	expect(canTransition("unclaimed", "claimed")).toBe(true);
	expect(canTransition("claimed", "running")).toBe(true);
	expect(canTransition("running", "retry_queued")).toBe(true);
	expect(canTransition("retry_queued", "released")).toBe(true);
	expect(canTransition("released", "unclaimed")).toBe(true); // re-pool

	// running → released directly is fine (success without retry)
	expect(canTransition("running", "released")).toBe(true);

	// illegal: skipping claimed
	expect(canTransition("unclaimed", "running")).toBe(false);
	// illegal: re-running a released row without re-claim
	expect(canTransition("released", "running")).toBe(false);
	// illegal: jumping straight to retry_queued from unclaimed
	expect(canTransition("unclaimed", "retry_queued")).toBe(false);
});

test("isTerminalPhase recognises the 5 terminal phases (closed set)", () => {
	const terminals: RunPhase[] = [
		"succeeded",
		"failed",
		"timed_out",
		"stalled",
		"canceled_by_reconciliation",
	];
	for (const t of terminals) expect(isTerminalPhase(t)).toBe(true);
	expect(isTerminalPhase("streaming_turn")).toBe(false);
	expect(isTerminalPhase("preparing_workspace")).toBe(false);
});

test("phaseImpliesSuccess marks `succeeded` only — failure flavours map false", () => {
	expect(phaseImpliesSuccess("succeeded")).toBe(true);
	expect(phaseImpliesSuccess("failed")).toBe(false);
	expect(phaseImpliesSuccess("timed_out")).toBe(false);
	expect(phaseImpliesSuccess("stalled")).toBe(false);
	expect(phaseImpliesSuccess("canceled_by_reconciliation")).toBe(false);
	// non-terminal returns false (no opinion)
	expect(phaseImpliesSuccess("streaming_turn")).toBe(false);
});

test("freshClaimToken returns a UUIDv4 distinct per call", () => {
	const a = freshClaimToken();
	const b = freshClaimToken();
	expect(a).not.toBe(b);
	const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
	expect(a).toMatch(uuidRe);
	expect(b).toMatch(uuidRe);
});

// Spot-check the closed RunState set against the type itself by
// asserting the public list (used by callers wanting to iterate every
// legal state) is what we expect.
test("RUN_STATES exposes exactly the 5 symphony §7.1 claim states", async () => {
	const { RUN_STATES } = await import("../../../src/core/dispatch/state");
	expect(new Set<RunState>([...RUN_STATES])).toEqual(
		new Set<RunState>([
			"unclaimed",
			"claimed",
			"running",
			"retry_queued",
			"released",
		]),
	);
});
