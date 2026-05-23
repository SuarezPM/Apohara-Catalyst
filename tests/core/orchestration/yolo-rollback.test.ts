import { expect, test } from "bun:test";
import { evaluateRollback, type TestRunResult } from "../../../src/core/orchestration/yolo-rollback";

test("no rollback when all tests pass", () => {
	const r: TestRunResult = { passed: 100, failed: 0, errors: 0 };
	expect(evaluateRollback(r, { maxFailures: 3 })).toEqual({ rollback: false });
});

test("rollback when failures exceed threshold", () => {
	const r: TestRunResult = { passed: 90, failed: 5, errors: 0 };
	const decision = evaluateRollback(r, { maxFailures: 3 });
	expect(decision.rollback).toBe(true);
	expect(decision.reason).toContain("5 failed");
});

test("rollback on any error regardless of threshold", () => {
	const r: TestRunResult = { passed: 100, failed: 0, errors: 1 };
	const decision = evaluateRollback(r, { maxFailures: 3 });
	expect(decision.rollback).toBe(true);
	expect(decision.reason).toContain("errors");
});

test("no rollback at exactly threshold (inclusive boundary)", () => {
	const r: TestRunResult = { passed: 90, failed: 3, errors: 0 };
	expect(evaluateRollback(r, { maxFailures: 3 })).toEqual({ rollback: false });
});
