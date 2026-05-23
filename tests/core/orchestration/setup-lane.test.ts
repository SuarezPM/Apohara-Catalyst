/**
 * Setup task lane integration — agentrail hallazgo 5 PARCIAL → COMPLETO
 * (G5.B.6).
 *
 * G5.B.5 already declared the `setup_verification` lane in the
 * SchedulerLane enum. G5.B.6 wires the existing `SETUP_TASK_ID`
 * prefix (`LOCAL-SETUP-`) into the lane classifier so the scheduler
 * sees setup-verification work at the BOTTOM of the priority list —
 * runs only when no normal-runnable work is queued, exactly per
 * agentrail's "low-priority lane" contract.
 *
 * The plumbing:
 *   isSetupVerificationId(id)  — pure predicate by prefix.
 *   classifySetupLaneFor(row)  — high-level helper that maps a
 *                                 minimal task row into a
 *                                 LaneClassification.
 */
import { expect, test } from "bun:test";
import {
	classifySetupLaneFor,
	isSetupVerificationId,
} from "../../../src/core/orchestration/scheduler-lanes";
import { SETUP_TASK_ID } from "../../../src/core/orchestration/setup-verification";

test("isSetupVerificationId recognises LOCAL-SETUP- prefix only", () => {
	expect(isSetupVerificationId("LOCAL-SETUP-001")).toBe(true);
	expect(isSetupVerificationId("LOCAL-SETUP-005-cli")).toBe(true);
	expect(isSetupVerificationId(SETUP_TASK_ID)).toBe(true);
	expect(isSetupVerificationId("normal-task")).toBe(false);
	expect(isSetupVerificationId("local-setup-001")).toBe(false); // case sensitive
	expect(isSetupVerificationId("")).toBe(false);
});

test("classifySetupLaneFor: setup row → setup_verification lane", () => {
	const classification = classifySetupLaneFor({
		id: SETUP_TASK_ID,
		status: "pending",
		hadWorkerDeath: false,
		receivedUserInputAfterBlock: false,
	});
	expect(classification.lane).toBe("setup_verification");
	expect(classification.isSetupVerification).toBe(true);
});

test("classifySetupLaneFor: normal row → start_new (preserves classifyLane)", () => {
	const c = classifySetupLaneFor({
		id: "task-real-work",
		status: "pending",
		hadWorkerDeath: false,
		receivedUserInputAfterBlock: false,
	});
	expect(c.lane).toBe("start_new");
	expect(c.isSetupVerification).toBe(false);
});

test("classifySetupLaneFor: setup row that had worker death prefers resume_in_progress", () => {
	const c = classifySetupLaneFor({
		id: SETUP_TASK_ID,
		status: "dispatched",
		hadWorkerDeath: true,
		receivedUserInputAfterBlock: false,
	});
	// resume_in_progress wins over setup_verification — even setup
	// tasks deserve recovery before new work.
	expect(c.lane).toBe("resume_in_progress");
});
