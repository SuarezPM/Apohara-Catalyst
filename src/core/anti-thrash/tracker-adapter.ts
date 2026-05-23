/**
 * Strategy-tracker adapter (symphony #15, G5.G.9).
 *
 * The persistent `FailureTracker` in `strategyRotation.ts` writes to a
 * tmpdir on every recordFailure / recordSuccess. That is correct in
 * production (state survives crashes) but wrong in tests (slow,
 * polluting). This adapter:
 *
 *   1. Defines `StrategyTracker` — the interface every consumer
 *      (Coordinator, Verifier, decision gates) reads against.
 *
 *   2. Ships an `InMemoryStrategyTracker` — zero-IO implementation
 *      used by unit tests and ephemeral runs. Pure memory; no tmpdir
 *      file is created.
 *
 *   3. Wraps the existing `FailureTracker` via `PersistentStrategyTracker`
 *      so production code keeps its on-disk durability without leaking
 *      a tmpdir constructor argument to every caller.
 *
 *   4. Adds a `peek(tool)` method that reads the current failure count
 *      WITHOUT bumping it. The dashboard humanizer and coordinator
 *      heuristics need this — recording a failure to read the count
 *      would itself trip the threshold.
 */

import type { FailureCounts, RotationAlert, ToolKind } from "./strategyRotation";
import { FailureTracker } from "./strategyRotation";

export type { FailureCounts, RotationAlert, ToolKind };

export interface StrategyTracker {
	recordFailure(tool: ToolKind): Promise<RotationAlert>;
	recordSuccess(tool: ToolKind): Promise<void>;
	currentCounts(): Promise<FailureCounts>;
	/** Read the count for `tool` without modifying state. */
	peek(tool: ToolKind): Promise<number>;
	/** Clear all state (file deletion for persistent, reset for in-memory). */
	dispose(): Promise<void>;
}

// ---------------------------------------------------------------------
// Pure in-memory implementation.
// ---------------------------------------------------------------------

function emptyCounts(): FailureCounts {
	return {
		bash_failures: 0,
		edit_failures: 0,
		write_failures: 0,
		web_failures: 0,
		last_failure_at: 0,
	};
}

function getByTool(c: FailureCounts, tool: ToolKind): number {
	switch (tool) {
		case "bash":
			return c.bash_failures;
		case "edit":
			return c.edit_failures;
		case "write":
			return c.write_failures;
		case "web":
			return c.web_failures;
		default:
			return 0;
	}
}

function bumpByTool(c: FailureCounts, tool: ToolKind, delta: number): void {
	switch (tool) {
		case "bash":
			c.bash_failures += delta;
			break;
		case "edit":
			c.edit_failures += delta;
			break;
		case "write":
			c.write_failures += delta;
			break;
		case "web":
			c.web_failures += delta;
			break;
		default:
			// "other" is currently untracked by the FailureCounts shape;
			// keeping the switch exhaustive here so a future enum
			// extension lights up the compiler.
			break;
	}
}

function rotationDirective(tool: ToolKind, count: number): string {
	return (
		`STRATEGY ROTATION ALERT: ${tool} tool has failed ${count} consecutive times. ` +
		`Stop and reflect: the current approach is not working. ` +
		`Consider: (a) read the related files first to understand the actual state, ` +
		`(b) try a different tool kind, ` +
		`(c) ask the coordinator if the task spec needs revision. ` +
		`Do NOT retry the same approach without changing something.`
	);
}

export class InMemoryStrategyTracker implements StrategyTracker {
	private counts: FailureCounts = emptyCounts();
	constructor(private threshold = 2) {}

	async recordFailure(tool: ToolKind): Promise<RotationAlert> {
		bumpByTool(this.counts, tool, 1);
		this.counts.last_failure_at = Date.now();
		const failure_count = getByTool(this.counts, tool);
		const triggered = failure_count >= this.threshold;
		return {
			triggered,
			tool,
			failure_count,
			additionalContext: triggered ? rotationDirective(tool, failure_count) : "",
		};
	}

	async recordSuccess(tool: ToolKind): Promise<void> {
		if (getByTool(this.counts, tool) === 0) return;
		switch (tool) {
			case "bash":
				this.counts.bash_failures = 0;
				break;
			case "edit":
				this.counts.edit_failures = 0;
				break;
			case "write":
				this.counts.write_failures = 0;
				break;
			case "web":
				this.counts.web_failures = 0;
				break;
		}
	}

	async currentCounts(): Promise<FailureCounts> {
		// Defensive copy — callers must not mutate our internal state.
		return { ...this.counts };
	}

	async peek(tool: ToolKind): Promise<number> {
		return getByTool(this.counts, tool);
	}

	async dispose(): Promise<void> {
		this.counts = emptyCounts();
	}
}

// ---------------------------------------------------------------------
// Persistent wrapper around the on-disk FailureTracker.
// ---------------------------------------------------------------------

export class PersistentStrategyTracker implements StrategyTracker {
	private inner: FailureTracker;
	constructor(taskId: string, threshold = 2, basePath?: string) {
		this.inner = new FailureTracker(taskId, threshold, basePath);
	}

	recordFailure(tool: ToolKind): Promise<RotationAlert> {
		return this.inner.recordFailure(tool);
	}

	recordSuccess(tool: ToolKind): Promise<void> {
		return this.inner.recordSuccess(tool);
	}

	currentCounts(): Promise<FailureCounts> {
		return this.inner.currentCounts();
	}

	async peek(tool: ToolKind): Promise<number> {
		const c = await this.inner.currentCounts();
		return getByTool(c, tool);
	}

	dispose(): Promise<void> {
		return this.inner.dispose();
	}
}
