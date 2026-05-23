/**
 * yolo cost cap — accumulating spend with hard limit. tryReserve
 * is atomic: either the increment is applied AND returns true, or
 * no state change AND returns false. Caller must check return before
 * committing the underlying expense (LLM call, tool exec, etc.).
 */
export interface CostCapOptions {
	maxUsd: number;
}

export class CostCap {
	private spentUsd = 0;
	private readonly maxUsd: number;

	constructor(opts: CostCapOptions) {
		this.maxUsd = opts.maxUsd;
	}

	tryReserve(amountUsd: number): boolean {
		if (this.spentUsd + amountUsd > this.maxUsd) return false;
		this.spentUsd += amountUsd;
		return true;
	}

	totalSpentUsd(): number {
		return this.spentUsd;
	}

	remainingUsd(): number {
		return Math.max(0, this.maxUsd - this.spentUsd);
	}
}
