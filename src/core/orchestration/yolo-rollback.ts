/**
 * yolo rollback decision — given test results post-implementation,
 * decide whether to revert the changes. Errors (panic / setup / etc.)
 * always trigger rollback; failures trigger if exceeding threshold.
 */

export interface TestRunResult {
	passed: number;
	failed: number;
	errors: number;
}

export interface RollbackPolicy {
	maxFailures: number;
}

export interface RollbackDecision {
	rollback: boolean;
	reason?: string;
}

export function evaluateRollback(result: TestRunResult, policy: RollbackPolicy): RollbackDecision {
	if (result.errors > 0) {
		return { rollback: true, reason: `${result.errors} errors detected (rollback always on error)` };
	}
	if (result.failed > policy.maxFailures) {
		return { rollback: true, reason: `${result.failed} failed exceeds threshold ${policy.maxFailures}` };
	}
	return { rollback: false };
}
