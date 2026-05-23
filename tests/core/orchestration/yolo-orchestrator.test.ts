import { expect, test } from "bun:test";
import { YoloOrchestrator } from "../../../src/core/orchestration/yolo-orchestrator";

test("requires all gates open before allowing run", () => {
	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: false,
		workspaceAllowed: true,
		costCap: { maxUsd: 10 },
		rollbackPolicy: { maxFailures: 3 },
	});
	expect(orch.canStartRun()).toBe(false);
});

test("blocks new spend after cost cap exhausted", () => {
	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: true,
		workspaceAllowed: true,
		costCap: { maxUsd: 5 },
		rollbackPolicy: { maxFailures: 3 },
	});
	expect(orch.tryReserveSpend(3)).toBe(true);
	expect(orch.tryReserveSpend(3)).toBe(false); // 3+3=6 > 5
});

test("rollback decision flows through", () => {
	const orch = new YoloOrchestrator({
		env: { APOHARA_YOLO: "1" },
		uiToggle: true,
		workspaceAllowed: true,
		costCap: { maxUsd: 10 },
		rollbackPolicy: { maxFailures: 3 },
	});
	const decision = orch.shouldRollback({ passed: 50, failed: 10, errors: 0 });
	expect(decision.rollback).toBe(true);
});
