/**
 * Scheduler lanes — agentrail hallazgo 6 (G5.B.5).
 *
 * The scheduler currently picks tasks ordered by `ts ASC` (insertion
 * order). agentrail introduces *lanes* — semantic priority classes
 * the scheduler considers before timestamp:
 *
 *   1. resume_in_progress    — a worker died mid-task, somebody must
 *                              pick it back up before starting new work
 *   2. retry_after_feedback  — a paused / blocked task got fresh user
 *                              input and should re-enter ahead of new
 *                              starts
 *   3. start_new             — the default for a freshly-decomposed task
 *   4. setup_verification    — the LOCAL-SETUP-001 lane (G5.B.6). Runs
 *                              only when no normal-runnable work is
 *                              available — see audit agentrail #5.
 *
 * The composite sort key is (lane, priority, due_at, updated_at, id).
 * Within a lane, ties break by user-supplied priority then deadline
 * then mtime then id — exactly the agentrail ordering.
 */
import { expect, test } from "bun:test";
import {
	SCHEDULER_LANES,
	classifyLane,
	compareTasksByLane,
	pickNextTask,
	type LaneCandidate,
} from "../../../src/core/orchestration/scheduler-lanes";

test("SCHEDULER_LANES exposes the 4 lanes in priority order", () => {
	expect(SCHEDULER_LANES).toEqual([
		"resume_in_progress",
		"retry_after_feedback",
		"start_new",
		"setup_verification",
	]);
});

test("classifyLane: resume_in_progress for a row mid-running orphaned by a dead worker", () => {
	const r = classifyLane({
		id: "t1",
		status: "dispatched",
		hadWorkerDeath: true,
		isSetupVerification: false,
		receivedUserInputAfterBlock: false,
	});
	expect(r).toBe("resume_in_progress");
});

test("classifyLane: retry_after_feedback when fresh user input arrived on a blocked task", () => {
	const r = classifyLane({
		id: "t2",
		status: "blocked",
		hadWorkerDeath: false,
		isSetupVerification: false,
		receivedUserInputAfterBlock: true,
	});
	expect(r).toBe("retry_after_feedback");
});

test("classifyLane: setup_verification for LOCAL-SETUP-* identifiers", () => {
	const r = classifyLane({
		id: "LOCAL-SETUP-001",
		status: "pending",
		hadWorkerDeath: false,
		isSetupVerification: true,
		receivedUserInputAfterBlock: false,
	});
	expect(r).toBe("setup_verification");
});

test("classifyLane: start_new is the default for a plain pending task", () => {
	const r = classifyLane({
		id: "t-plain",
		status: "pending",
		hadWorkerDeath: false,
		isSetupVerification: false,
		receivedUserInputAfterBlock: false,
	});
	expect(r).toBe("start_new");
});

test("compareTasksByLane: resume_in_progress wins against setup_verification", () => {
	const a: LaneCandidate = {
		id: "a",
		lane: "resume_in_progress",
		priority: "normal",
		dueAt: null,
		updatedAt: 100,
	};
	const b: LaneCandidate = {
		id: "b",
		lane: "setup_verification",
		priority: "urgent",
		dueAt: 50,
		updatedAt: 50,
	};
	// even though b has higher priority + earlier due, lane trumps.
	expect(compareTasksByLane(a, b) < 0).toBe(true);
});

test("compareTasksByLane: within same lane, priority order is urgent>high>normal>low", () => {
	const a: LaneCandidate = {
		id: "a",
		lane: "start_new",
		priority: "low",
		dueAt: null,
		updatedAt: 100,
	};
	const b: LaneCandidate = {
		id: "b",
		lane: "start_new",
		priority: "urgent",
		dueAt: null,
		updatedAt: 200,
	};
	expect(compareTasksByLane(b, a) < 0).toBe(true);
});

test("compareTasksByLane: ties break to dueAt earlier", () => {
	const a: LaneCandidate = {
		id: "a",
		lane: "start_new",
		priority: "normal",
		dueAt: 100,
		updatedAt: 500,
	};
	const b: LaneCandidate = {
		id: "b",
		lane: "start_new",
		priority: "normal",
		dueAt: 200,
		updatedAt: 100,
	};
	expect(compareTasksByLane(a, b) < 0).toBe(true);
});

test("compareTasksByLane: full tie breaks by updatedAt ascending then id ascending", () => {
	const a: LaneCandidate = {
		id: "task-b",
		lane: "start_new",
		priority: "normal",
		dueAt: null,
		updatedAt: 100,
	};
	const b: LaneCandidate = {
		id: "task-a",
		lane: "start_new",
		priority: "normal",
		dueAt: null,
		updatedAt: 100,
	};
	expect(compareTasksByLane(b, a) < 0).toBe(true); // task-a id wins
});

test("pickNextTask returns the lane-winner from a mixed-lane pool", () => {
	const pool: LaneCandidate[] = [
		{
			id: "setup",
			lane: "setup_verification",
			priority: "urgent",
			dueAt: 0,
			updatedAt: 0,
		},
		{
			id: "new-1",
			lane: "start_new",
			priority: "normal",
			dueAt: null,
			updatedAt: 500,
		},
		{
			id: "resume",
			lane: "resume_in_progress",
			priority: "low",
			dueAt: null,
			updatedAt: 1000,
		},
	];
	expect(pickNextTask(pool)?.id).toBe("resume");
});

test("pickNextTask returns null on empty pool", () => {
	expect(pickNextTask([])).toBeNull();
});
