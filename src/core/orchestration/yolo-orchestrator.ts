import { isYoloEnabled, type YoloGateContext } from "./yolo-mode";
import { CostCap, type CostCapOptions } from "./yolo-cost-cap";
import {
	evaluateRollback,
	type RollbackPolicy,
	type RollbackDecision,
	type TestRunResult,
} from "./yolo-rollback";

export interface YoloOrchestratorOptions extends YoloGateContext {
	costCap: CostCapOptions;
	rollbackPolicy: RollbackPolicy;
}

export class YoloOrchestrator {
	private cap: CostCap;
	private rollback: RollbackPolicy;
	private gateCtx: YoloGateContext;

	constructor(opts: YoloOrchestratorOptions) {
		this.cap = new CostCap(opts.costCap);
		this.rollback = opts.rollbackPolicy;
		this.gateCtx = {
			env: opts.env,
			uiToggle: opts.uiToggle,
			workspaceAllowed: opts.workspaceAllowed,
		};
	}

	canStartRun(): boolean {
		return isYoloEnabled(this.gateCtx);
	}

	tryReserveSpend(amountUsd: number): boolean {
		if (!this.canStartRun()) return false;
		return this.cap.tryReserve(amountUsd);
	}

	shouldRollback(result: TestRunResult): RollbackDecision {
		return evaluateRollback(result, this.rollback);
	}

	totalSpentUsd(): number {
		return this.cap.totalSpentUsd();
	}
}
